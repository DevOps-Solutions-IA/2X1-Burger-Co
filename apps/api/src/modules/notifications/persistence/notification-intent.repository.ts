import type {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  NotificationIntent,
  NotificationIntentStatus,
  Prisma,
} from '@prisma/client';

export type CreateNotificationIntentInput = Readonly<{
  eventType: string;
  sourceEventId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  customerId: string | null;
  conversationId: string | null;
  channel: CustomerConsentChannel;
  purpose: CustomerConsentPurpose;
  factEnvelope: Prisma.InputJsonObject;
  factHash: string;
  policyOutcome: 'ALLOWED' | 'SUPPRESSED';
  policyReason: string | null;
  consentVersion: number | null;
  handoffVersion: number | null;
  expiresAt: Date | null;
  now: Date;
}>;

export type ClaimNotificationIntentInput = Readonly<{
  notificationIntentId: string;
  claimOwnerHash: string;
  leaseExpiresAt: Date;
  maxAttempts: number;
  now: Date;
}>;

export type RenewNotificationIntentClaimInput = Readonly<{
  notificationIntentId: string;
  expectedVersion: number;
  claimOwnerHash: string;
  leaseExpiresAt: Date;
  now: Date;
}>;

export type NotificationClaimResult =
  | Readonly<{ state: 'CLAIMED'; intent: NotificationIntent }>
  | Readonly<{
      state: 'ACTIVE' | 'EXPIRED' | 'ATTEMPTS_EXHAUSTED' | 'UNKNOWN_RESULT' | 'NOT_CLAIMABLE';
      intent: NotificationIntent;
    }>
  | Readonly<{ state: 'NOT_FOUND'; intent: null }>;

export type NotificationIntentVersionInput = Readonly<{
  notificationIntentId: string;
  expectedVersion: number;
}>;

export type ClaimedNotificationIntentVersionInput = NotificationIntentVersionInput & Readonly<{
  claimOwnerHash: string;
  now: Date;
}>;

export type MarkNotificationCommandPendingInput = ClaimedNotificationIntentVersionInput & Readonly<{
  secureCommandId: string;
  outboundMessageId: string;
}>;

export type MarkNotificationSuppressedInput = ClaimedNotificationIntentVersionInput & Readonly<{
  reasonCode: string;
  consentVersion: number | null;
  handoffVersion: number | null;
}>;

export type MarkNotificationDispatchedInput = NotificationIntentVersionInput & Readonly<{
  outboundMessageId: string;
}>;

export type MarkNotificationFailureInput = NotificationIntentVersionInput & Readonly<{
  errorCode: string;
  now: Date;
}>;

export type MarkNotificationPreDispatchFailureInput = ClaimedNotificationIntentVersionInput & Readonly<{
  errorCode: string;
  maxAttempts: number;
  nextRetryAt: Date;
}>;

export type NotificationClaimCandidate = Readonly<{
  id: string;
  status: NotificationIntentStatus;
}>;

export type NotificationReconciliationCandidate = Readonly<{
  id: string;
  status: Extract<NotificationIntentStatus, 'COMMAND_PENDING' | 'DISPATCHED' | 'UNKNOWN_RESULT'>;
  version: number;
  attempts: number;
  secureCommandId: string | null;
  outboundMessageId: string | null;
}>;

export type ReconcileNotificationIntentInput = NotificationIntentVersionInput & Readonly<{
  expectedStatus: Extract<NotificationIntentStatus, 'COMMAND_PENDING' | 'DISPATCHED' | 'UNKNOWN_RESULT'>;
  targetStatus: Extract<NotificationIntentStatus, 'DISPATCHED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN_RESULT'>;
  secureCommandId: string;
  outboundMessageId: string | null;
  errorCode: string | null;
  completedAt: Date | null;
  nextRetryAt: Date | null;
  incrementAttempts: boolean;
}>;

export type DeferNotificationReconciliationInput = NotificationIntentVersionInput & Readonly<{
  expectedStatus: Extract<NotificationIntentStatus, 'COMMAND_PENDING' | 'DISPATCHED'>;
  secureCommandId: string;
  outboundMessageId: string | null;
  nextRetryAt: Date;
}>;

export type NotificationMaintenanceCandidate = Readonly<{
  id: string;
  status: Extract<NotificationIntentStatus, 'PENDING' | 'CLAIMED' | 'COMMAND_PENDING' | 'DISPATCHED'>;
  version: number;
  attempts: number;
  expiresAt: Date | null;
  leaseExpiresAt: Date | null;
}>;

export type SettleNotificationMaintenanceInput = NotificationIntentVersionInput & Readonly<{
  expectedStatus: NotificationMaintenanceCandidate['status'];
  targetStatus: Extract<NotificationIntentStatus, 'FAILED' | 'UNKNOWN_RESULT' | 'EXPIRED'>;
  errorCode: string;
  now: Date;
}>;

export abstract class NotificationIntentRepository {
  abstract create(input: CreateNotificationIntentInput): Promise<NotificationIntent>;
  abstract findById(notificationIntentId: string): Promise<NotificationIntent | null>;
  abstract findClaimCandidates(now: Date, limit: number, maxAttempts: number): Promise<readonly NotificationClaimCandidate[]>;
  abstract findReconciliationCandidates(
    now: Date,
    limit: number,
    maxAttempts: number,
    includeUnknownResult: boolean,
  ): Promise<readonly NotificationReconciliationCandidate[]>;
  abstract findMaintenanceCandidates(
    now: Date,
    limit: number,
    maxAttempts: number,
  ): Promise<readonly NotificationMaintenanceCandidate[]>;
  abstract claim(input: ClaimNotificationIntentInput): Promise<NotificationClaimResult>;
  abstract renewClaim(input: RenewNotificationIntentClaimInput): Promise<boolean>;
  abstract markSuppressed(input: MarkNotificationSuppressedInput): Promise<NotificationIntent>;
  abstract markCommandPending(input: MarkNotificationCommandPendingInput): Promise<NotificationIntent>;
  abstract markDispatched(input: MarkNotificationDispatchedInput): Promise<NotificationIntent>;
  abstract markSucceeded(input: NotificationIntentVersionInput & Readonly<{ now: Date }>): Promise<NotificationIntent>;
  abstract markUnknownResult(input: MarkNotificationFailureInput): Promise<NotificationIntent>;
  abstract markFailedAfterDispatch(input: MarkNotificationFailureInput): Promise<NotificationIntent>;
  abstract markPreDispatchFailure(input: MarkNotificationPreDispatchFailureInput): Promise<NotificationIntent>;
  abstract reconcile(input: ReconcileNotificationIntentInput): Promise<NotificationIntent>;
  abstract deferReconciliation(input: DeferNotificationReconciliationInput): Promise<NotificationIntent>;
  abstract settleMaintenance(input: SettleNotificationMaintenanceInput): Promise<NotificationIntent>;
}
