import { Injectable } from '@nestjs/common';
import { CustomerConsentStatus, Prisma, SofiaMemoryConsentState, type WhatsappDeliveryStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { AuditService } from '../../../../audit/audit.service';
import type { ConsentDecision, DeliveryStatusUpdate, ProviderAccountObservation } from '../whatsapp-production.types';
import type { WhatsappProductionRepository } from '../whatsapp-production.repository';

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

  async claimInbound(input: Parameters<WhatsappProductionRepository['claimInbound']>[0]) {
    try {
      const created = await this.prisma.whatsappInboundEvent.create({
        data: {
          accountId: input.accountId,
          provider: input.provider,
          providerEventId: input.eventId,
          providerMessageId: input.messageId,
          phone: input.phone,
          eventHash: input.eventHash,
          normalizedPayloadHash: input.normalizedPayloadHash,
          eventKind: input.eventKind,
          rawPayload: { redacted: true },
          processingStatus: 'CLAIMED',
        },
        select: { id: true, processingStatus: true, deterministicResult: true },
      });
      return { ...created, created: true };
    } catch (error) {
      if (!this.unique(error)) throw error;
      const existing = await this.prisma.whatsappInboundEvent.findFirstOrThrow({
        where: { accountId: input.accountId, providerEventId: input.eventId },
        select: { id: true, processingStatus: true, deterministicResult: true },
      });
      return { ...existing, created: false };
    }
  }

  async completeInbound(id: string, processingStatus: string, result: unknown, errorCode: string | null = null) {
    await this.prisma.whatsappInboundEvent.update({
      where: { id },
      data: {
        processingStatus,
        processedAt: new Date(),
        errorMessage: errorCode,
        deterministicResult: this.safeJson(result),
      },
    });
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
      return { state: input.nextState, version, assignedActorId: input.assignedToUserId };
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
