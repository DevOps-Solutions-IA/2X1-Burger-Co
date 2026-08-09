import { Injectable } from '@nestjs/common';
import { NotificationIntentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  type ClaimNotificationIntentInput,
  type CreateNotificationIntentInput,
  type DeferNotificationReconciliationInput,
  type MarkNotificationCommandPendingInput,
  type MarkNotificationDispatchedInput,
  type MarkNotificationFailureInput,
  type MarkNotificationPreDispatchFailureInput,
  type NotificationClaimCandidate,
  type NotificationClaimResult,
  type NotificationMaintenanceCandidate,
  type NotificationReconciliationCandidate,
  NotificationIntentRepository,
  type ReconcileNotificationIntentInput,
  type SettleNotificationMaintenanceInput,
  type NotificationIntentVersionInput,
} from './notification-intent.repository';

const IDEMPOTENCY_CONFLICT = 'NOTIFICATION_INTENT_IDEMPOTENCY_CONFLICT';
const STALE_TRANSITION = 'STALE_NOTIFICATION_INTENT_VERSION';

@Injectable()
export class PrismaNotificationIntentRepository extends NotificationIntentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateNotificationIntentInput) {
    const identity = {
      aggregateType: input.aggregateType,
      sourceEventId: input.sourceEventId,
      channel: input.channel,
      purpose: input.purpose,
    };
    const status = input.policyOutcome === 'SUPPRESSED'
      ? NotificationIntentStatus.SUPPRESSED
      : NotificationIntentStatus.PENDING;

    let intent;
    try {
      intent = await this.prisma.notificationIntent.upsert({
        where: { aggregateType_sourceEventId_channel_purpose: identity },
        create: {
          eventType: input.eventType,
          sourceEventId: input.sourceEventId,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          aggregateVersion: input.aggregateVersion,
          customerId: input.customerId,
          conversationId: input.conversationId,
          channel: input.channel,
          purpose: input.purpose,
          factEnvelope: input.factEnvelope,
          factHash: input.factHash,
          policyOutcome: input.policyOutcome,
          policyReason: input.policyReason,
          consentVersion: input.consentVersion,
          handoffVersion: input.handoffVersion,
          status,
          expiresAt: input.expiresAt,
          completedAt: status === NotificationIntentStatus.SUPPRESSED ? input.now : null,
        },
        update: {},
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      intent = await this.prisma.notificationIntent.findUnique({
        where: { aggregateType_sourceEventId_channel_purpose: identity },
      });
      if (!intent) throw error;
    }

    const sameBinding =
      intent.eventType === input.eventType
      && intent.aggregateId === input.aggregateId
      && intent.aggregateVersion === input.aggregateVersion
      && intent.customerId === input.customerId
      && intent.conversationId === input.conversationId
      && intent.factHash === input.factHash
      && intent.policyOutcome === input.policyOutcome
      && intent.policyReason === input.policyReason
      && intent.consentVersion === input.consentVersion
      && intent.handoffVersion === input.handoffVersion;
    if (!sameBinding) throw new Error(IDEMPOTENCY_CONFLICT);
    return intent;
  }

  findById(notificationIntentId: string) {
    return this.prisma.notificationIntent.findUnique({ where: { id: notificationIntentId } });
  }

  findClaimCandidates(now: Date, limit: number, maxAttempts: number): Promise<readonly NotificationClaimCandidate[]> {
    return this.prisma.notificationIntent.findMany({
      where: {
        attempts: { lt: maxAttempts },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
          {
            OR: [
              { status: NotificationIntentStatus.PENDING },
              {
                status: NotificationIntentStatus.CLAIMED,
                leaseExpiresAt: { lte: now },
              },
            ],
          },
        ],
      },
      select: { id: true, status: true },
      orderBy: [{ nextRetryAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
  }

  findReconciliationCandidates(
    now: Date,
    limit: number,
    maxAttempts: number,
    includeUnknownResult: boolean,
  ): Promise<readonly NotificationReconciliationCandidate[]> {
    return this.prisma.notificationIntent.findMany({
      where: {
        OR: [
          {
            status: { in: [NotificationIntentStatus.COMMAND_PENDING, NotificationIntentStatus.DISPATCHED] },
            attempts: { lt: maxAttempts },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          },
          ...(includeUnknownResult ? [{ status: NotificationIntentStatus.UNKNOWN_RESULT }] : []),
        ],
      },
      select: {
        id: true,
        status: true,
        version: true,
        attempts: true,
        secureCommandId: true,
        outboundMessageId: true,
      },
      orderBy: [{ nextRetryAt: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
    }) as Promise<readonly NotificationReconciliationCandidate[]>;
  }

  findMaintenanceCandidates(
    now: Date,
    limit: number,
    maxAttempts: number,
  ): Promise<readonly NotificationMaintenanceCandidate[]> {
    return this.prisma.notificationIntent.findMany({
      where: {
        OR: [
          {
            status: { in: [NotificationIntentStatus.PENDING, NotificationIntentStatus.CLAIMED] },
            expiresAt: { lte: now },
          },
          { status: NotificationIntentStatus.PENDING, attempts: { gte: maxAttempts } },
          {
            status: NotificationIntentStatus.CLAIMED,
            attempts: { gte: maxAttempts },
            leaseExpiresAt: { lte: now },
          },
          {
            status: { in: [NotificationIntentStatus.COMMAND_PENDING, NotificationIntentStatus.DISPATCHED] },
            attempts: { gte: maxAttempts },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          },
        ],
      },
      select: {
        id: true,
        status: true,
        version: true,
        attempts: true,
        expiresAt: true,
        leaseExpiresAt: true,
      },
      orderBy: [{ expiresAt: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
    }) as Promise<readonly NotificationMaintenanceCandidate[]>;
  }

  async claim(input: ClaimNotificationIntentInput): Promise<NotificationClaimResult> {
    await this.prisma.notificationIntent.updateMany({
      where: {
        id: input.notificationIntentId,
        status: { in: [NotificationIntentStatus.PENDING, NotificationIntentStatus.CLAIMED] },
        expiresAt: { lte: input.now },
      },
      data: {
        status: NotificationIntentStatus.EXPIRED,
        completedAt: input.now,
        claimOwnerHash: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });

    const claimed = await this.prisma.notificationIntent.updateMany({
      where: {
        id: input.notificationIntentId,
        attempts: { lt: input.maxAttempts },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }] },
          { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: input.now } }] },
          {
            OR: [
              { status: NotificationIntentStatus.PENDING },
              {
                status: NotificationIntentStatus.CLAIMED,
                leaseExpiresAt: { lte: input.now },
              },
            ],
          },
        ],
      },
      data: {
        status: NotificationIntentStatus.CLAIMED,
        claimOwnerHash: input.claimOwnerHash,
        leaseExpiresAt: input.leaseExpiresAt,
        nextRetryAt: null,
        lastErrorCode: null,
        attempts: { increment: 1 },
        version: { increment: 1 },
      },
    });
    const intent = await this.findById(input.notificationIntentId);
    if (!intent) return { state: 'NOT_FOUND', intent: null };
    if (claimed.count === 1) return { state: 'CLAIMED', intent };

    if (
      intent.attempts >= input.maxAttempts
      && (intent.status === NotificationIntentStatus.PENDING || intent.status === NotificationIntentStatus.CLAIMED)
    ) {
      const exhausted = await this.prisma.notificationIntent.updateMany({
        where: {
          id: intent.id,
          version: intent.version,
          OR: [
            { status: NotificationIntentStatus.PENDING },
            { status: NotificationIntentStatus.CLAIMED, leaseExpiresAt: { lte: input.now } },
          ],
        },
        data: {
          status: NotificationIntentStatus.FAILED,
          completedAt: input.now,
          claimOwnerHash: null,
          leaseExpiresAt: null,
          lastErrorCode: 'NOTIFICATION_ATTEMPTS_EXHAUSTED',
          version: { increment: 1 },
        },
      });
      if (exhausted.count === 1) {
        const finalIntent = await this.findById(intent.id);
        return { state: 'ATTEMPTS_EXHAUSTED', intent: finalIntent ?? intent };
      }
    }
    if (intent.status === NotificationIntentStatus.UNKNOWN_RESULT) return { state: 'UNKNOWN_RESULT', intent };
    if (intent.status === NotificationIntentStatus.EXPIRED) return { state: 'EXPIRED', intent };
    if (intent.status === NotificationIntentStatus.CLAIMED) return { state: 'ACTIVE', intent };
    return { state: 'NOT_CLAIMABLE', intent };
  }

  async markCommandPending(input: MarkNotificationCommandPendingInput) {
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: NotificationIntentStatus.CLAIMED,
        claimOwnerHash: input.claimOwnerHash,
        leaseExpiresAt: { gt: input.now },
      },
      {
        status: NotificationIntentStatus.COMMAND_PENDING,
        secureCommandId: input.secureCommandId,
        claimOwnerHash: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    );
  }

  async markDispatched(input: MarkNotificationDispatchedInput) {
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: NotificationIntentStatus.COMMAND_PENDING,
      },
      {
        status: NotificationIntentStatus.DISPATCHED,
        outboundMessageId: input.outboundMessageId,
        version: { increment: 1 },
      },
    );
  }

  async markSucceeded(input: NotificationIntentVersionInput & Readonly<{ now: Date }>) {
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: NotificationIntentStatus.DISPATCHED,
      },
      {
        status: NotificationIntentStatus.SUCCEEDED,
        completedAt: input.now,
        version: { increment: 1 },
      },
    );
  }

  markUnknownResult(input: MarkNotificationFailureInput) {
    return this.markPostDispatchTerminal(input, NotificationIntentStatus.UNKNOWN_RESULT);
  }

  markFailedAfterDispatch(input: MarkNotificationFailureInput) {
    return this.markPostDispatchTerminal(input, NotificationIntentStatus.FAILED);
  }

  async markPreDispatchFailure(input: MarkNotificationPreDispatchFailureInput) {
    const retry = await this.prisma.notificationIntent.updateMany({
      where: {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: NotificationIntentStatus.CLAIMED,
        claimOwnerHash: input.claimOwnerHash,
        leaseExpiresAt: { gt: input.now },
        attempts: { lt: input.maxAttempts },
      },
      data: {
        status: NotificationIntentStatus.PENDING,
        claimOwnerHash: null,
        leaseExpiresAt: null,
        nextRetryAt: input.nextRetryAt,
        lastErrorCode: input.errorCode,
        version: { increment: 1 },
      },
    });
    if (retry.count === 1) return this.required(input.notificationIntentId);
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: NotificationIntentStatus.CLAIMED,
        claimOwnerHash: input.claimOwnerHash,
        leaseExpiresAt: { gt: input.now },
      },
      {
        status: NotificationIntentStatus.FAILED,
        claimOwnerHash: null,
        leaseExpiresAt: null,
        completedAt: input.now,
        lastErrorCode: input.errorCode,
        version: { increment: 1 },
      },
    );
  }

  reconcile(input: ReconcileNotificationIntentInput) {
    const terminal = input.targetStatus === NotificationIntentStatus.SUCCEEDED
      || input.targetStatus === NotificationIntentStatus.FAILED
      || input.targetStatus === NotificationIntentStatus.UNKNOWN_RESULT;
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: input.expectedStatus,
        secureCommandId: input.secureCommandId,
        ...(input.expectedStatus === NotificationIntentStatus.COMMAND_PENDING
          ? {}
          : { outboundMessageId: input.outboundMessageId }),
      },
      {
        status: input.targetStatus,
        ...(input.outboundMessageId === null ? {} : { outboundMessageId: input.outboundMessageId }),
        completedAt: terminal ? input.completedAt : null,
        nextRetryAt: input.nextRetryAt,
        lastErrorCode: input.errorCode,
        claimOwnerHash: null,
        leaseExpiresAt: null,
        ...(input.incrementAttempts ? { attempts: { increment: 1 } } : {}),
        version: { increment: 1 },
      },
    );
  }

  deferReconciliation(input: DeferNotificationReconciliationInput) {
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: input.expectedStatus,
        secureCommandId: input.secureCommandId,
        ...(input.expectedStatus === NotificationIntentStatus.COMMAND_PENDING
          ? {}
          : { outboundMessageId: input.outboundMessageId }),
      },
      {
        nextRetryAt: input.nextRetryAt,
        attempts: { increment: 1 },
        version: { increment: 1 },
      },
    );
  }

  settleMaintenance(input: SettleNotificationMaintenanceInput) {
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: input.expectedStatus,
        ...(input.expectedStatus === NotificationIntentStatus.CLAIMED
          ? { leaseExpiresAt: { lte: input.now } }
          : {}),
      },
      {
        status: input.targetStatus,
        completedAt: input.now,
        claimOwnerHash: null,
        leaseExpiresAt: null,
        nextRetryAt: null,
        lastErrorCode: input.errorCode,
        version: { increment: 1 },
      },
    );
  }

  private async markPostDispatchTerminal(input: MarkNotificationFailureInput, status: NotificationIntentStatus) {
    return this.transition(
      {
        id: input.notificationIntentId,
        version: input.expectedVersion,
        status: { in: [NotificationIntentStatus.COMMAND_PENDING, NotificationIntentStatus.DISPATCHED] },
      },
      {
        status,
        completedAt: input.now,
        lastErrorCode: input.errorCode,
        nextRetryAt: null,
        claimOwnerHash: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    );
  }

  private async transition(where: Prisma.NotificationIntentWhereInput, data: Prisma.NotificationIntentUncheckedUpdateManyInput) {
    const id = typeof where.id === 'string' ? where.id : null;
    if (!id) throw new Error(STALE_TRANSITION);
    const updated = await this.prisma.notificationIntent.updateMany({ where, data });
    if (updated.count !== 1) throw new Error(STALE_TRANSITION);
    return this.required(id);
  }

  private async required(notificationIntentId: string) {
    const intent = await this.findById(notificationIntentId);
    if (!intent) throw new Error('NOTIFICATION_INTENT_NOT_FOUND');
    return intent;
  }
}
