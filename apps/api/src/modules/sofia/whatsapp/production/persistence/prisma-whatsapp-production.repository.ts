import { Injectable } from '@nestjs/common';
import { CustomerConsentStatus, Prisma, SofiaMemoryConsentState, type WhatsappDeliveryStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { AuditService } from '../../../../audit/audit.service';
import { normalizeWhatsappInboundClaimInput } from '../whatsapp-inbound-contracts';
import type { ConsentDecision, DeliveryStatusUpdate, ProviderAccountObservation } from '../whatsapp-production.types';
import type { ClaimedInbound, WhatsappProductionRepository } from '../whatsapp-production.repository';

const INBOUND_LEASE_MS = 2 * 60 * 1_000;
const INBOUND_MAX_ATTEMPTS = 3;
type InboundClaimMetadata = {
  claimToken: string;
  attempt: number;
  leaseExpiresAt: Date;
};

@Injectable()
export class PrismaWhatsappProductionRepository implements WhatsappProductionRepository {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async resolveAccount(observation: ProviderAccountObservation) {
    const externalAccountHash = this.hash(observation.externalAccountId);
    const where = { provider_externalAccountHash: { provider: observation.provider, externalAccountHash } };
    const existing = await this.prisma.whatsappProviderAccount.findUnique({
      where,
      select: { id: true, status: true },
    });
    if (existing) return existing;
    try {
      return await this.prisma.whatsappProviderAccount.create({
        data: {
        provider: observation.provider,
        externalAccountHash,
        businessIdentityHash: this.hash(observation.businessIdentity),
        businessIdentityMask: this.mask(observation.businessIdentity),
        sessionOwnerHash: this.hash(observation.sessionOwner),
        status: 'VERIFIED_RECEIVE_ONLY',
        lastVerifiedAt: new Date(),
      },
        select: { id: true, status: true },
      });
    } catch (error) {
      if (!this.unique(error)) throw error;
      return this.prisma.whatsappProviderAccount.findUniqueOrThrow({ where, select: { id: true, status: true } });
    }
  }

  async claimInbound(
    input: Parameters<WhatsappProductionRepository['claimInbound']>[0],
  ): Promise<ClaimedInbound> {
    const normalized = normalizeWhatsappInboundClaimInput(input);
    const now = new Date();
    const initialClaim = this.claimMetadata(1, now);
    try {
      const created = await this.prisma.whatsappInboundEvent.create({
        data: {
          accountId: normalized.accountId,
          provider: normalized.provider,
          providerEventId: normalized.eventId,
          providerMessageId: normalized.messageId,
          phone: normalized.phone,
          eventHash: normalized.eventHash,
          normalizedPayloadHash: normalized.normalizedPayloadHash,
          eventKind: normalized.eventKind,
          rawPayload: { redacted: true },
          processingStatus: 'CLAIMED',
          processingAttempts: 1,
          processingLeaseOwnerHash: this.hash(initialClaim.claimToken),
          processingLeaseExpiresAt: initialClaim.leaseExpiresAt,
          retryable: true,
        },
        select: { id: true, processingStatus: true },
      });
      return this.acquiredClaim(created.id, created.processingStatus, initialClaim, true);
    } catch (error) {
      if (!this.unique(error)) throw error;
    }

    for (let contentionAttempt = 0; contentionAttempt < 4; contentionAttempt += 1) {
      const existing = await this.prisma.whatsappInboundEvent.findFirst({
        where: {
          OR: [
            { providerEventId: normalized.eventId },
            { provider: normalized.provider, eventHash: normalized.eventHash },
          ],
        },
        select: {
          id: true,
          accountId: true,
          provider: true,
          providerEventId: true,
          eventHash: true,
          processingStatus: true,
          processingAttempts: true,
          processingLeaseExpiresAt: true,
          nextRetryAt: true,
          retryable: true,
          deterministicResult: true,
        },
      });
      if (!existing) continue;
      this.assertSameInbound(existing, normalized);

      const failedReadyForRetry = existing.processingStatus === 'FAILED'
        && existing.retryable
        && (!existing.nextRetryAt || existing.nextRetryAt.getTime() <= now.getTime());
      if (existing.processingStatus !== 'CLAIMED' && !failedReadyForRetry) {
        return {
          id: existing.id,
          created: false,
          disposition: existing.processingStatus === 'ATTEMPTS_EXHAUSTED'
            ? 'ATTEMPTS_EXHAUSTED'
            : 'DETERMINISTIC_REPLAY',
          attempt: existing.processingAttempts,
          claimToken: null,
          leaseExpiresAt: null,
          processingStatus: existing.processingStatus,
          deterministicResult: existing.deterministicResult,
        };
      }

      const attempt = existing.processingAttempts;
      if (
        existing.processingStatus === 'CLAIMED'
        && existing.processingLeaseExpiresAt
        && existing.processingLeaseExpiresAt.getTime() > now.getTime()
      ) {
        return {
          id: existing.id,
          created: false,
          disposition: 'IN_PROGRESS',
          attempt,
          claimToken: null,
          leaseExpiresAt: existing.processingLeaseExpiresAt,
          processingStatus: existing.processingStatus,
          deterministicResult: null,
        };
      }

      if (attempt >= INBOUND_MAX_ATTEMPTS) {
        const terminalResult = {
          processingStatus: 'ATTEMPTS_EXHAUSTED',
          reasonCode: 'WHATSAPP_INBOUND_ATTEMPTS_EXHAUSTED',
          attempts: attempt,
        };
        const exhausted = await this.prisma.whatsappInboundEvent.updateMany({
          where: {
            id: existing.id,
            processingStatus: existing.processingStatus,
            processingAttempts: attempt,
            processingLeaseExpiresAt: existing.processingLeaseExpiresAt,
          },
          data: {
            processingStatus: 'ATTEMPTS_EXHAUSTED',
            processedAt: now,
            errorMessage: 'WHATSAPP_INBOUND_ATTEMPTS_EXHAUSTED',
            deterministicResult: terminalResult,
            processingLeaseOwnerHash: null,
            processingLeaseExpiresAt: null,
            nextRetryAt: null,
            lastErrorCode: 'WHATSAPP_INBOUND_ATTEMPTS_EXHAUSTED',
            retryable: false,
          },
        });
        if (exhausted.count === 1) {
          return {
            id: existing.id,
            created: false,
            disposition: 'ATTEMPTS_EXHAUSTED',
            attempt,
            claimToken: null,
            leaseExpiresAt: null,
            processingStatus: 'ATTEMPTS_EXHAUSTED',
            deterministicResult: terminalResult,
          };
        }
        continue;
      }

      const recoveredClaim = this.claimMetadata(attempt + 1, now);
      const recovered = await this.prisma.whatsappInboundEvent.updateMany({
        where: {
          id: existing.id,
          processingStatus: existing.processingStatus,
          processingAttempts: attempt,
          processingLeaseExpiresAt: existing.processingLeaseExpiresAt,
        },
        data: {
          processingStatus: 'CLAIMED',
          processingAttempts: { increment: 1 },
          processingLeaseOwnerHash: this.hash(recoveredClaim.claimToken),
          processingLeaseExpiresAt: recoveredClaim.leaseExpiresAt,
          nextRetryAt: null,
          errorMessage: null,
          lastErrorCode: null,
          retryable: true,
        },
      });
      if (recovered.count === 1) {
        return this.acquiredClaim(
          existing.id,
          'CLAIMED',
          recoveredClaim,
          false,
          existing.deterministicResult,
        );
      }
    }

    throw new Error('WHATSAPP_INBOUND_CLAIM_CONTENTION');
  }

  async checkpointInbound(id: string, checkpoint: unknown, claimToken: string) {
    const normalizedId = this.requiredBounded(id, 191, 'WHATSAPP_INBOUND_ID_INVALID');
    const normalizedToken = this.requiredBounded(claimToken, 191, 'WHATSAPP_INBOUND_CLAIM_TOKEN_REQUIRED');
    const checkpointed = await this.prisma.whatsappInboundEvent.updateMany({
      where: {
        id: normalizedId,
        processingStatus: 'CLAIMED',
        processingLeaseOwnerHash: this.hash(normalizedToken),
        processingLeaseExpiresAt: { gt: new Date() },
      },
      data: {
        deterministicResult: this.safeJson(checkpoint),
      },
    });
    if (checkpointed.count === 1) return;

    const existing = await this.prisma.whatsappInboundEvent.findUnique({
      where: { id: normalizedId },
      select: { processingStatus: true },
    });
    if (!existing) throw new Error('WHATSAPP_INBOUND_NOT_FOUND');
    throw new Error('WHATSAPP_INBOUND_LEASE_LOST');
  }

  async renewInboundLease(id: string, claimToken: string) {
    const normalizedId = this.requiredBounded(id, 191, 'WHATSAPP_INBOUND_ID_INVALID');
    const normalizedToken = this.requiredBounded(claimToken, 191, 'WHATSAPP_INBOUND_CLAIM_TOKEN_REQUIRED');
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + INBOUND_LEASE_MS);
    const renewed = await this.prisma.whatsappInboundEvent.updateMany({
      where: {
        id: normalizedId,
        processingStatus: 'CLAIMED',
        processingLeaseOwnerHash: this.hash(normalizedToken),
        processingLeaseExpiresAt: { gt: now },
      },
      data: { processingLeaseExpiresAt: leaseExpiresAt },
    });
    if (renewed.count === 1) return leaseExpiresAt;

    const existing = await this.prisma.whatsappInboundEvent.findUnique({
      where: { id: normalizedId },
      select: { processingStatus: true },
    });
    if (!existing) throw new Error('WHATSAPP_INBOUND_NOT_FOUND');
    throw new Error('WHATSAPP_INBOUND_LEASE_LOST');
  }

  async completeInbound(
    id: string,
    processingStatus: string,
    result: unknown,
    errorCode: string | null = null,
    claimToken: string | null = null,
  ) {
    const normalizedId = this.requiredBounded(id, 191, 'WHATSAPP_INBOUND_ID_INVALID');
    const normalizedStatus = this.requiredBounded(processingStatus, 64, 'WHATSAPP_PROCESSING_STATUS_INVALID');
    if (!claimToken) throw new Error('WHATSAPP_INBOUND_CLAIM_TOKEN_REQUIRED');
    const retryable = normalizedStatus === 'FAILED';
    const completed = await this.prisma.whatsappInboundEvent.updateMany({
      where: {
        id: normalizedId,
        processingStatus: 'CLAIMED',
        processingLeaseOwnerHash: this.hash(claimToken),
        processingLeaseExpiresAt: { gt: new Date() },
      },
      data: {
        processingStatus: normalizedStatus,
        processedAt: new Date(),
        errorMessage: errorCode,
        deterministicResult: retryable ? undefined : this.safeJson(result),
        processingLeaseOwnerHash: null,
        processingLeaseExpiresAt: null,
        nextRetryAt: retryable ? new Date(Date.now() + 5_000) : null,
        lastErrorCode: errorCode,
        retryable,
      },
    });
    if (completed.count === 1) return;

    const existing = await this.prisma.whatsappInboundEvent.findUnique({
      where: { id: normalizedId },
      select: { processingStatus: true },
    });
    if (!existing) throw new Error('WHATSAPP_INBOUND_NOT_FOUND');
    if (existing.processingStatus !== 'CLAIMED') return;
    throw new Error('WHATSAPP_INBOUND_LEASE_LOST');
  }

  async consentDecision(customerId: string | null, purpose: 'SERVICE' | 'MARKETING'): Promise<ConsentDecision> {
    const evaluatedAt = new Date();
    if (!customerId) {
      return { allowed: purpose === 'SERVICE', purpose, version: null, reasonCode: purpose === 'SERVICE' ? 'SERVICE_CONTEXT_ALLOWED' : 'MARKETING_CONSENT_REQUIRED', evaluatedAt };
    }
    const [latest, memory] = await Promise.all([
      this.prisma.customerConsent.findFirst({
        where: { customerId, purpose, channel: 'WHATSAPP' },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.sofiaCustomerMemory.findUnique({ where: { customerId }, select: { consentState: true } }),
    ]);
    if (memory?.consentState === SofiaMemoryConsentState.OPTED_OUT) {
      return { allowed: false, purpose, version: latest?.version ?? null, reasonCode: 'CUSTOMER_OPTED_OUT', evaluatedAt };
    }
    if (latest?.status === CustomerConsentStatus.REVOKED) {
      return { allowed: false, purpose, version: latest.version, reasonCode: 'CONSENT_REVOKED', evaluatedAt };
    }
    if (latest?.status === CustomerConsentStatus.GRANTED) {
      return { allowed: true, purpose, version: latest.version, reasonCode: 'CONSENT_GRANTED', evaluatedAt };
    }
    return { allowed: purpose === 'SERVICE', purpose, version: null, reasonCode: purpose === 'SERVICE' ? 'SERVICE_CONTEXT_ALLOWED' : 'MARKETING_CONSENT_REQUIRED', evaluatedAt };
  }

  async transitionHandoff(input: Parameters<WhatsappProductionRepository['transitionHandoff']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "whatsapp_conversations" WHERE "id" = ${input.conversationId} FOR UPDATE`;
      const current = await tx.whatsappConversation.findUnique({
        where: { id: input.conversationId },
        select: {
          status: true,
          humanStatus: true,
          sofiaEnabled: true,
          assignedToUserId: true,
          handoffVersion: true,
        },
      });
      if (!current) throw new Error('WHATSAPP_HANDOFF_VERSION_CONFLICT');

      const currentMatchesTarget = current.humanStatus === input.nextState
        && current.status === input.status
        && current.sofiaEnabled === input.sofiaEnabled
        && current.assignedToUserId === input.assignedToUserId;
      const replayVersion = current.handoffVersion;
      if (
        currentMatchesTarget
        && (replayVersion === input.expectedVersion || replayVersion === input.expectedVersion + 1)
      ) {
        const latestEvent = await tx.whatsappHandoffEvent.findUnique({
          where: {
            conversationId_version: {
              conversationId: input.conversationId,
              version: replayVersion,
            },
          },
          select: { actorId: true, nextState: true, reasonCode: true },
        });
        if (
          latestEvent?.actorId === input.actorId
          && latestEvent.nextState === input.nextState
          && latestEvent.reasonCode === input.reasonCode
        ) {
          return {
            state: current.humanStatus,
            version: current.handoffVersion,
            assignedActorId: current.assignedToUserId,
            replayed: true,
          };
        }
      }

      if (current.handoffVersion !== input.expectedVersion || current.humanStatus !== input.previousState) {
        throw new Error('WHATSAPP_HANDOFF_VERSION_CONFLICT');
      }
      const changed = await tx.whatsappConversation.updateMany({
        where: { id: input.conversationId, handoffVersion: input.expectedVersion, humanStatus: input.previousState },
        data: {
          status: input.status,
          humanStatus: input.nextState,
          sofiaEnabled: input.sofiaEnabled,
          assignedToUserId: input.assignedToUserId,
          lastHumanTakeoverAt: input.nextState === 'HUMAN_TAKEN' ? new Date() : undefined,
          handoffVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new Error('WHATSAPP_HANDOFF_VERSION_CONFLICT');
      const version = input.expectedVersion + 1;
      await tx.whatsappHandoffEvent.create({
        data: {
          conversationId: input.conversationId,
          actorId: input.actorId,
          previousState: input.previousState,
          nextState: input.nextState,
          reasonCode: input.reasonCode,
          version,
        },
      });
      await this.audit.log({
        userId: input.actorId,
        action: 'WHATSAPP_HANDOFF_TRANSITION',
        module: 'SofiaWhatsapp',
        entity: 'WhatsappConversation',
        entityId: input.conversationId,
        result: 'SUCCESS',
        reasonCode: input.reasonCode,
        oldValues: { state: input.previousState, version: input.expectedVersion },
        newValues: { state: input.nextState, version },
      }, tx);
      return { state: input.nextState, version, assignedActorId: input.assignedToUserId, replayed: false };
    });
  }

  conversationPolicyState(conversationId: string) {
    return this.prisma.whatsappConversation.findUnique({
      where: { id: conversationId },
      select: { customerId: true, status: true, humanStatus: true, sofiaEnabled: true, assignedToUserId: true, handoffVersion: true },
    });
  }

  async appendStatus(input: DeliveryStatusUpdate & { status: WhatsappDeliveryStatus }) {
    return this.prisma.$transaction(async (tx) => {
      const outbound = await tx.whatsappOutboundMessage.findFirst({
        where: { accountId: input.accountId, providerMessageId: input.providerMessageId, recipientIdentityHash: input.recipientIdentityHash },
        select: { id: true },
      });
      if (!outbound) throw new Error('WHATSAPP_STATUS_MESSAGE_NOT_FOUND');
      await tx.$queryRaw`SELECT "id" FROM "whatsapp_outbound_messages" WHERE "id" = ${outbound.id} FOR UPDATE`;
      const previous = await tx.whatsappMessageStatusEvent.findFirst({
        where: { accountId: input.accountId, providerMessageId: input.providerMessageId },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        select: { status: true },
      });
      if (previous && !this.statusAllowed(previous.status, input.status)) {
        throw new Error('WHATSAPP_STATUS_REGRESSION');
      }
      try {
        await tx.whatsappMessageStatusEvent.create({
        data: {
          accountId: input.accountId,
          outboundMessageId: outbound.id,
          providerStatusEventId: input.providerStatusEventId,
          providerMessageId: input.providerMessageId,
          status: input.status,
          occurredAt: input.occurredAt,
          payloadHash: input.payloadHash,
        },
      });
        return { duplicate: false, outboundMessageId: outbound.id };
      } catch (error) {
        if (!this.unique(error)) throw error;
        return { duplicate: true, outboundMessageId: outbound.id };
      }
    });
  }

  async latestStatus(accountId: string, providerMessageId: string) {
    const latest = await this.prisma.whatsappMessageStatusEvent.findFirst({
      where: { accountId, providerMessageId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { status: true },
    });
    return latest?.status ?? null;
  }

  async createMediaEnvelope(input: Parameters<WhatsappProductionRepository['createMediaEnvelope']>[0]) {
    await this.prisma.whatsappMediaEnvelope.upsert({
      where: { messageId: input.messageId },
      create: input,
      update: {},
    });
  }

  outboundForCommand(commandId: string, outboundMessageId: string) {
    return this.prisma.whatsappOutboundMessage.findFirst({
      where: { id: outboundMessageId, OR: [{ secureCommandId: commandId }, { secureCommandId: null }] },
      select: {
        id: true, conversationId: true, accountId: true, recipientIdentityHash: true, purpose: true, status: true,
        body: true, mediaUrl: true, idempotencyKey: true,
        account: { select: { provider: true, status: true } },
        conversation: { select: { phone: true, handoffVersion: true, customerId: true, sofiaEnabled: true, humanStatus: true } },
      },
    });
  }

  async bindOutboundCommand(outboundMessageId: string, commandId: string) {
    const changed = await this.prisma.whatsappOutboundMessage.updateMany({
      where: { id: outboundMessageId, OR: [{ secureCommandId: null }, { secureCommandId: commandId }] },
      data: { secureCommandId: commandId },
    });
    if (changed.count !== 1) throw new Error('WHATSAPP_OUTBOUND_COMMAND_CONFLICT');
  }

  async completeOutbound(input: Parameters<WhatsappProductionRepository['completeOutbound']>[0]) {
    await this.prisma.whatsappOutboundMessage.update({
      where: { id: input.outboundMessageId },
      data: {
        status: input.status,
        providerMessageId: input.providerMessageId,
        unknownResult: input.unknownResult,
        rawPayload: input.sanitizedPayload,
        lastError: input.errorCode,
        sentAt: input.status === 'SENT' ? new Date() : null,
        attempts: { increment: 1 },
      },
    });
  }

  private safeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private claimMetadata(attempt: number, now: Date): InboundClaimMetadata {
    return {
      claimToken: randomUUID(),
      attempt,
      leaseExpiresAt: new Date(now.getTime() + INBOUND_LEASE_MS),
    };
  }

  private acquiredClaim(
    id: string,
    processingStatus: string,
    metadata: InboundClaimMetadata,
    created: boolean,
    deterministicResult: unknown = null,
  ): ClaimedInbound {
    return {
      id,
      created,
      disposition: 'ACQUIRED',
      attempt: metadata.attempt,
      claimToken: metadata.claimToken,
      leaseExpiresAt: metadata.leaseExpiresAt,
      processingStatus,
      deterministicResult,
    };
  }

  private assertSameInbound(
    existing: {
      accountId: string | null;
      provider: string;
      providerEventId: string | null;
      eventHash: string;
    },
    input: Parameters<WhatsappProductionRepository['claimInbound']>[0],
  ) {
    if (
      existing.accountId !== input.accountId
      || existing.provider !== input.provider
      || existing.providerEventId !== input.eventId
      || existing.eventHash !== input.eventHash
    ) {
      throw new Error('WHATSAPP_INBOUND_IDEMPOTENCY_CONFLICT');
    }
  }

  private requiredBounded(value: unknown, maxLength: number, code: string) {
    if (typeof value !== 'string') throw new Error(code);
    const normalized = value.trim();
    const hasControlCharacters = Array.from(normalized).some((character) => {
      const characterCode = character.charCodeAt(0);
      return characterCode <= 31 || characterCode === 127;
    });
    if (!normalized || normalized.length > maxLength || hasControlCharacters) throw new Error(code);
    return normalized;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private mask(value: string) {
    const normalized = value.replace(/\s/g, '');
    return `${'*'.repeat(Math.max(3, normalized.length - 4))}${normalized.slice(-4)}`;
  }

  private unique(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
  }

  private statusAllowed(previous: WhatsappDeliveryStatus, next: WhatsappDeliveryStatus) {
    const rank: Record<WhatsappDeliveryStatus, number> = {
      UNKNOWN: 0,
      ACCEPTED: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
      FAILED: 5,
    };
    if (previous === next) return true;
    if (previous === 'FAILED' || previous === 'READ') return false;
    return next === 'FAILED' || rank[next] >= rank[previous];
  }
}
