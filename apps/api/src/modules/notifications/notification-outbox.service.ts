import { Injectable } from '@nestjs/common';
import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  type NotificationIntent,
  NotificationIntentStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuditResult } from '../audit/audit.types';
import { decideNotificationReconciliation, deterministicNotificationHash } from './domain';
import type { NotificationReconciliationObservation } from './domain/notification.types';
import {
  type CreateNotificationIntentInput,
  type NotificationClaimResult,
} from './persistence/notification-intent.repository';
import { NotificationIntentRepository } from './persistence/notification-intent.repository';

const AUDIT_ACTOR_ID = 'notification-outbox';
const AUDIT_SOURCE = 'notification_outbox';
const AUDIT_MODULE = 'notifications';
const AUDIT_ENTITY = 'notification_intent';

const MAX_FACT_BYTES = 32 * 1024;
const MAX_FACT_DEPTH = 8;
const MAX_ARRAY_ENTRIES = 100;
const MAX_STRING_LENGTH = 2_000;
const SAFE_COMPONENT = /^[A-Za-z0-9._:-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const FORBIDDEN_FACT_KEY = /(authorization|cookie|credential|hiddenreasoning|privatekey|providerpayload|rawpayload|secret|systemprompt|token)/i;

export type EnqueueNotificationIntentInput = Readonly<{
  eventType: string;
  sourceEventId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  customerId?: string | null;
  conversationId?: string | null;
  channel: CustomerConsentChannel;
  purpose: CustomerConsentPurpose;
  factEnvelope: Readonly<Record<string, unknown>>;
  policyOutcome: 'ALLOWED' | 'SUPPRESSED';
  policyReason?: string | null;
  consentVersion?: number | null;
  handoffVersion?: number | null;
  expiresAt?: Date | null;
}>;

export type NotificationOutboxOptions = Readonly<{
  maxAttempts: number;
  leaseMs: number;
  retryDelayMs: number;
}>;

export type ReconcileNotificationInput = Readonly<{
  notificationIntentId: string;
  expectedVersion: number;
  currentStatus: Extract<NotificationIntentStatus, 'COMMAND_PENDING' | 'DISPATCHED' | 'UNKNOWN_RESULT'>;
  secureCommandId: string;
  outboundMessageId?: string | null;
  observation: NotificationReconciliationObservation;
  explicitReconciliation?: boolean;
  errorCode?: string | null;
  now?: Date;
}>;

@Injectable()
export class NotificationOutboxService {
  private static readonly OPTIONS: NotificationOutboxOptions = Object.freeze({
    maxAttempts: 3,
    leaseMs: 30_000,
    retryDelayMs: 5_000,
  });

  constructor(
    private readonly repository: NotificationIntentRepository,
    private readonly audit: AuditService,
  ) {}

  enqueue(input: EnqueueNotificationIntentInput, now = new Date()): Promise<NotificationIntent> {
    this.assertIdentity(input);
    const factEnvelope = this.sanitizeFactEnvelope(input.factEnvelope);
    const factHash = deterministicNotificationHash(factEnvelope);
    const createInput: CreateNotificationIntentInput = {
      eventType: input.eventType,
      sourceEventId: input.sourceEventId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      customerId: input.customerId ?? null,
      conversationId: input.conversationId ?? null,
      channel: input.channel,
      purpose: input.purpose,
      factEnvelope,
      factHash,
      policyOutcome: input.policyOutcome,
      policyReason: input.policyReason ?? null,
      consentVersion: input.consentVersion ?? null,
      handoffVersion: input.handoffVersion ?? null,
      expiresAt: input.expiresAt ?? null,
      now,
    };
    return this.repository.create(createInput).then(async (intent) => {
      const suppressedAtCreation = intent.status === NotificationIntentStatus.SUPPRESSED;
      await this.auditTransition({
        action: suppressedAtCreation ? 'NOTIFICATION_INTENT_SUPPRESSED_AT_ENQUEUE' : 'NOTIFICATION_INTENT_ENQUEUED',
        notificationIntentId: intent.id,
        result: suppressedAtCreation ? 'BLOCKED' : 'SUCCESS',
        reasonCode: intent.policyReason,
        metadata: {
          eventType: intent.eventType,
          sourceEventId: intent.sourceEventId,
          aggregateType: intent.aggregateType,
          aggregateId: intent.aggregateId,
          aggregateVersion: intent.aggregateVersion,
          channel: intent.channel,
          purpose: intent.purpose,
          status: intent.status,
        },
      });
      return intent;
    });
  }

  findClaimCandidates(now = new Date(), limit = 25) {
    this.assertBatchLimit(limit);
    return this.repository.findClaimCandidates(now, limit, NotificationOutboxService.OPTIONS.maxAttempts);
  }

  findReconciliationCandidates(now = new Date(), limit = 25, includeUnknownResult = false) {
    this.assertBatchLimit(limit);
    return this.repository.findReconciliationCandidates(
      now,
      limit,
      NotificationOutboxService.OPTIONS.maxAttempts,
      includeUnknownResult,
    );
  }

  findMaintenanceCandidates(now = new Date(), limit = 25) {
    this.assertBatchLimit(limit);
    return this.repository.findMaintenanceCandidates(now, limit, NotificationOutboxService.OPTIONS.maxAttempts);
  }

  claim(notificationIntentId: string, workerIdentity: string, now = new Date()): Promise<NotificationClaimResult> {
    return this.repository.claim({
      notificationIntentId,
      claimOwnerHash: this.workerHash(workerIdentity),
      leaseExpiresAt: new Date(now.getTime() + NotificationOutboxService.OPTIONS.leaseMs),
      maxAttempts: NotificationOutboxService.OPTIONS.maxAttempts,
      now,
    });
  }

  renewClaim(notificationIntentId: string, expectedVersion: number, workerIdentity: string, now = new Date()) {
    return this.repository.renewClaim({
      notificationIntentId,
      expectedVersion,
      claimOwnerHash: this.workerHash(workerIdentity),
      leaseExpiresAt: new Date(now.getTime() + NotificationOutboxService.OPTIONS.leaseMs),
      now,
    });
  }

  markCommandPending(input: Readonly<{
    notificationIntentId: string;
    expectedVersion: number;
    workerIdentity: string;
    secureCommandId: string;
    outboundMessageId: string;
    now?: Date;
  }>) {
    return this.repository.markCommandPending({
      notificationIntentId: input.notificationIntentId,
      expectedVersion: input.expectedVersion,
      claimOwnerHash: this.workerHash(input.workerIdentity),
      secureCommandId: input.secureCommandId,
      outboundMessageId: input.outboundMessageId,
      now: input.now ?? new Date(),
    }).then(async (intent) => {
      await this.auditTransition({
        action: 'NOTIFICATION_COMMAND_PENDING',
        notificationIntentId: intent.id,
        result: 'SUCCESS',
        reasonCode: null,
        metadata: { secureCommandId: input.secureCommandId, outboundMessageId: input.outboundMessageId },
      });
      return intent;
    });
  }

  markSuppressed(input: Readonly<{
    notificationIntentId: string;
    expectedVersion: number;
    workerIdentity: string;
    reasonCode: string;
    consentVersion: number | null;
    handoffVersion: number | null;
    now?: Date;
  }>) {
    const now = input.now ?? new Date();
    if (!SAFE_COMPONENT.test(input.reasonCode)) throw new Error('NOTIFICATION_POLICY_REASON_INVALID');
    return this.repository.markSuppressed({
      notificationIntentId: input.notificationIntentId,
      expectedVersion: input.expectedVersion,
      claimOwnerHash: this.workerHash(input.workerIdentity),
      reasonCode: input.reasonCode,
      consentVersion: input.consentVersion,
      handoffVersion: input.handoffVersion,
      now,
    }).then(async (intent) => {
      await this.auditTransition({
        action: 'NOTIFICATION_SUPPRESSED',
        notificationIntentId: intent.id,
        result: 'BLOCKED',
        reasonCode: input.reasonCode,
        metadata: { consentVersion: input.consentVersion, handoffVersion: input.handoffVersion },
      });
      return intent;
    });
  }

  markDispatched(input: Readonly<{
    notificationIntentId: string;
    expectedVersion: number;
    outboundMessageId: string;
  }>) {
    return this.repository.markDispatched(input).then(async (intent) => {
      await this.auditTransition({
        action: 'NOTIFICATION_DISPATCHED',
        notificationIntentId: intent.id,
        result: 'SUCCESS',
        reasonCode: null,
        metadata: { outboundMessageId: input.outboundMessageId },
      });
      return intent;
    });
  }

  markSucceeded(notificationIntentId: string, expectedVersion: number, now = new Date()) {
    return this.repository.markSucceeded({ notificationIntentId, expectedVersion, now }).then(async (intent) => {
      await this.auditTransition({
        action: 'NOTIFICATION_SUCCEEDED',
        notificationIntentId: intent.id,
        result: 'SUCCESS',
        reasonCode: null,
      });
      return intent;
    });
  }

  markUnknownResult(notificationIntentId: string, expectedVersion: number, errorCode: string, now = new Date()) {
    return this.repository.markUnknownResult({ notificationIntentId, expectedVersion, errorCode, now }).then(async (intent) => {
      await this.auditTransition({
        action: 'NOTIFICATION_UNKNOWN_RESULT',
        notificationIntentId: intent.id,
        result: 'BLOCKED',
        reasonCode: errorCode,
        metadata: { requiresHumanReconciliation: true },
      });
      return intent;
    });
  }

  markFailedAfterDispatch(notificationIntentId: string, expectedVersion: number, errorCode: string, now = new Date()) {
    return this.repository.markFailedAfterDispatch({ notificationIntentId, expectedVersion, errorCode, now }).then(async (intent) => {
      await this.auditTransition({
        action: 'NOTIFICATION_FAILED_AFTER_DISPATCH',
        notificationIntentId: intent.id,
        result: 'FAILED',
        reasonCode: errorCode,
      });
      return intent;
    });
  }

  markPreDispatchFailure(input: Readonly<{
    notificationIntentId: string;
    expectedVersion: number;
    workerIdentity: string;
    errorCode: string;
    now?: Date;
  }>) {
    const now = input.now ?? new Date();
    return this.repository.markPreDispatchFailure({
      notificationIntentId: input.notificationIntentId,
      expectedVersion: input.expectedVersion,
      claimOwnerHash: this.workerHash(input.workerIdentity),
      errorCode: input.errorCode,
      maxAttempts: NotificationOutboxService.OPTIONS.maxAttempts,
      nextRetryAt: new Date(now.getTime() + NotificationOutboxService.OPTIONS.retryDelayMs),
      now,
    }).then(async (intent) => {
      const exhausted = intent.status === NotificationIntentStatus.FAILED;
      await this.auditTransition({
        action: exhausted ? 'NOTIFICATION_PRE_DISPATCH_EXHAUSTED' : 'NOTIFICATION_PRE_DISPATCH_RETRY_SCHEDULED',
        notificationIntentId: intent.id,
        result: 'FAILED',
        reasonCode: input.errorCode,
        metadata: { attempts: intent.attempts },
      });
      return intent;
    });
  }

  reconcile(input: ReconcileNotificationInput) {
    const now = input.now ?? new Date();
    this.assertReconciliationBinding(input);
    const decision = decideNotificationReconciliation({
      status: input.currentStatus,
      observation: input.observation,
      explicitReconciliation: input.explicitReconciliation === true,
    });
    const outboundMessageId = input.outboundMessageId ?? null;

    if (decision.action === 'DEFER') {
      if (input.currentStatus === NotificationIntentStatus.UNKNOWN_RESULT) {
        throw new Error('NOTIFICATION_RECONCILIATION_INVALID');
      }
      return this.repository.deferReconciliation({
        notificationIntentId: input.notificationIntentId,
        expectedVersion: input.expectedVersion,
        expectedStatus: input.currentStatus,
        secureCommandId: input.secureCommandId,
        outboundMessageId,
        nextRetryAt: new Date(now.getTime() + NotificationOutboxService.OPTIONS.retryDelayMs),
      }).then(async (intent) => {
        await this.auditTransition({
          action: 'NOTIFICATION_RECONCILIATION_DEFERRED',
          notificationIntentId: intent.id,
          result: 'NO_OP',
          reasonCode: input.observation,
          metadata: { secureCommandId: input.secureCommandId },
        });
        return intent;
      });
    }

    if (decision.targetStatus === null) throw new Error('NOTIFICATION_RECONCILIATION_INVALID');
    const targetStatus = NotificationIntentStatus[decision.targetStatus];
    const terminal = targetStatus === NotificationIntentStatus.SUCCEEDED
      || targetStatus === NotificationIntentStatus.FAILED
      || targetStatus === NotificationIntentStatus.UNKNOWN_RESULT;
    const reconciliationErrorCode = targetStatus === NotificationIntentStatus.SUCCEEDED
      ? null
      : (input.errorCode ?? this.defaultError(input.observation));
    return this.repository.reconcile({
      notificationIntentId: input.notificationIntentId,
      expectedVersion: input.expectedVersion,
      expectedStatus: input.currentStatus,
      targetStatus,
      secureCommandId: input.secureCommandId,
      outboundMessageId,
      errorCode: reconciliationErrorCode,
      completedAt: terminal ? now : null,
      nextRetryAt: terminal ? null : new Date(now.getTime() + NotificationOutboxService.OPTIONS.retryDelayMs),
      incrementAttempts: !terminal,
    }).then(async (intent) => {
      await this.auditTransition({
        action: `NOTIFICATION_RECONCILIATION_${targetStatus}`,
        notificationIntentId: intent.id,
        result: this.reconciliationResult(targetStatus),
        reasonCode: reconciliationErrorCode ?? input.observation,
        metadata: { observation: input.observation, secureCommandId: input.secureCommandId },
      });
      return intent;
    });
  }

  async sweepMaintenance(now = new Date(), limit = 25) {
    const candidates = await this.findMaintenanceCandidates(now, limit);
    const settled: NotificationIntent[] = [];
    for (const candidate of candidates) {
      const expired = candidate.expiresAt !== null && candidate.expiresAt.getTime() <= now.getTime();
      const postDispatch = candidate.status === NotificationIntentStatus.COMMAND_PENDING
        || candidate.status === NotificationIntentStatus.DISPATCHED;
      const errorCode = expired
        ? 'NOTIFICATION_EXPIRED'
        : postDispatch
          ? 'NOTIFICATION_RECONCILIATION_ATTEMPTS_EXHAUSTED'
          : 'NOTIFICATION_ATTEMPTS_EXHAUSTED';
      const settledIntent = await this.repository.settleMaintenance({
        notificationIntentId: candidate.id,
        expectedVersion: candidate.version,
        expectedStatus: candidate.status,
        targetStatus: expired
          ? NotificationIntentStatus.EXPIRED
          : postDispatch
            ? NotificationIntentStatus.UNKNOWN_RESULT
            : NotificationIntentStatus.FAILED,
        errorCode,
        now,
      });
      await this.auditTransition({
        action: 'NOTIFICATION_MAINTENANCE_SETTLED',
        notificationIntentId: settledIntent.id,
        result: settledIntent.status === NotificationIntentStatus.UNKNOWN_RESULT ? 'BLOCKED' : 'FAILED',
        reasonCode: errorCode,
        metadata: { targetStatus: settledIntent.status, previousStatus: candidate.status },
      });
      settled.push(settledIntent);
    }
    return settled;
  }

  private async auditTransition(input: Readonly<{
    action: string;
    notificationIntentId: string;
    result: AuditResult;
    reasonCode: string | null;
    metadata?: Readonly<Record<string, unknown>>;
  }>): Promise<void> {
    await this.audit.log({
      actorId: AUDIT_ACTOR_ID,
      actorType: 'SYSTEM',
      action: input.action,
      module: AUDIT_MODULE,
      entity: AUDIT_ENTITY,
      entityId: input.notificationIntentId,
      result: input.result,
      reasonCode: input.reasonCode,
      metadata: input.metadata,
      source: AUDIT_SOURCE,
    });
  }

  private reconciliationResult(targetStatus: NotificationIntentStatus): AuditResult {
    if (targetStatus === NotificationIntentStatus.SUCCEEDED) return 'SUCCESS';
    if (targetStatus === NotificationIntentStatus.FAILED) return 'FAILED';
    if (targetStatus === NotificationIntentStatus.UNKNOWN_RESULT) return 'BLOCKED';
    return 'SUCCESS';
  }

  private assertIdentity(input: EnqueueNotificationIntentInput): void {
    if (
      !SAFE_COMPONENT.test(input.eventType)
      || !SAFE_COMPONENT.test(input.aggregateType)
      || !this.validOpaqueId(input.sourceEventId)
      || !this.validOpaqueId(input.aggregateId)
      || !Number.isInteger(input.aggregateVersion)
      || input.aggregateVersion < 0
      || !Object.values(CustomerConsentChannel).includes(input.channel)
      || !Object.values(CustomerConsentPurpose).includes(input.purpose)
      || (input.expiresAt !== undefined && input.expiresAt !== null && Number.isNaN(input.expiresAt.getTime()))
    ) {
      throw new Error('NOTIFICATION_INTENT_INPUT_INVALID');
    }
  }

  private assertBatchLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('NOTIFICATION_BATCH_LIMIT_INVALID');
  }

  private assertReconciliationBinding(input: ReconcileNotificationInput): void {
    const outboundEvidence = input.observation.startsWith('OUTBOUND_');
    if (
      !this.validOpaqueId(input.notificationIntentId)
      || !Number.isInteger(input.expectedVersion)
      || input.expectedVersion < 0
      || !this.validOpaqueId(input.secureCommandId)
      || (outboundEvidence && !this.validOpaqueId(input.outboundMessageId ?? ''))
      || (input.outboundMessageId !== undefined
        && input.outboundMessageId !== null
        && !this.validOpaqueId(input.outboundMessageId))
      || (input.errorCode !== undefined
        && input.errorCode !== null
        && !SAFE_COMPONENT.test(input.errorCode))
    ) {
      throw new Error('NOTIFICATION_RECONCILIATION_BINDING_INVALID');
    }
  }

  private defaultError(observation: NotificationReconciliationObservation): string {
    if (observation === 'RESULT_UNKNOWN') return 'NOTIFICATION_RESULT_UNKNOWN';
    if (observation === 'COMMAND_REJECTED') return 'NOTIFICATION_COMMAND_REJECTED';
    return 'NOTIFICATION_OUTBOUND_FAILED';
  }

  private sanitizeFactEnvelope(envelope: Readonly<Record<string, unknown>>): Prisma.InputJsonObject {
    if (!this.isPlainObject(envelope)) throw new Error('NOTIFICATION_FACT_ENVELOPE_INVALID');
    const sanitized = this.sanitizeValue(envelope, 0) as Prisma.InputJsonObject;
    if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > MAX_FACT_BYTES) {
      throw new Error('NOTIFICATION_FACT_ENVELOPE_TOO_LARGE');
    }
    return sanitized;
  }

  private sanitizeValue(value: unknown, depth: number): Prisma.InputJsonValue | null {
    if (depth > MAX_FACT_DEPTH) throw new Error('NOTIFICATION_FACT_ENVELOPE_TOO_DEEP');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('NOTIFICATION_FACT_ENVELOPE_INVALID');
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) throw new Error('NOTIFICATION_FACT_VALUE_TOO_LONG');
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ENTRIES) throw new Error('NOTIFICATION_FACT_ARRAY_TOO_LARGE');
      return value.map((entry) => this.sanitizeValue(entry, depth + 1));
    }
    if (!this.isPlainObject(value)) throw new Error('NOTIFICATION_FACT_ENVELOPE_INVALID');
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => {
          if (FORBIDDEN_FACT_KEY.test(key)) throw new Error('NOTIFICATION_FACT_KEY_FORBIDDEN');
          return [key, this.sanitizeValue(entry, depth + 1)];
        }),
    );
  }

  private isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private validOpaqueId(value: string): boolean {
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= 256 && Array.from(normalized).every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    });
  }

  private workerHash(workerIdentity: string): string {
    const normalized = workerIdentity.normalize('NFKC').trim();
    if (!normalized || normalized.length > 256) throw new Error('NOTIFICATION_WORKER_IDENTITY_INVALID');
    const hash = createHash('sha256').update(`notification-outbox-worker:v1\0${normalized}`, 'utf8').digest('hex');
    if (!HASH.test(hash)) throw new Error('NOTIFICATION_WORKER_HASH_INVALID');
    return hash;
  }
}
