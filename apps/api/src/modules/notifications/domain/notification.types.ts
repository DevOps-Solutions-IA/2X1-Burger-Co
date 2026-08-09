export const NOTIFICATION_STATUSES = [
  'PENDING',
  'SUPPRESSED',
  'CLAIMED',
  'COMMAND_PENDING',
  'DISPATCHED',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN_RESULT',
  'EXPIRED',
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export type NotificationChannel = 'WHATSAPP' | 'SMS' | 'PHONE';
export type NotificationPurpose = 'SERVICE' | 'MARKETING';
export type NotificationResultCertainty = 'NOT_ATTEMPTED' | 'NOT_ACCEPTED' | 'ACCEPTED' | 'UNKNOWN';

export type NotificationClaimInput = Readonly<{
  status: NotificationStatus;
  now: Date;
  leaseExpiresAt: Date | null;
  dispatchStartedAt: Date | null;
  retryable: boolean;
  resultCertainty: NotificationResultCertainty;
}>;

export type NotificationClaimDecision = Readonly<{
  allowed: boolean;
  reasonCode:
    | 'NOTIFICATION_CLAIM_ALLOWED'
    | 'NOTIFICATION_PRE_DISPATCH_LEASE_RECLAIM_ALLOWED'
    | 'NOTIFICATION_CLAIM_ACTIVE'
    | 'NOTIFICATION_UNKNOWN_RESULT_RECONCILIATION_REQUIRED'
    | 'NOTIFICATION_STATUS_NOT_CLAIMABLE';
  requiresHumanReconciliation: boolean;
}>;

export type NotificationTransitionContext = Readonly<{
  retryable?: boolean;
  resultCertainty?: NotificationResultCertainty;
  manualReconciliation?: boolean;
}>;

export type NotificationReconciliationObservation =
  | 'COMMAND_PENDING'
  | 'COMMAND_REJECTED'
  | 'OUTBOUND_PENDING'
  | 'OUTBOUND_SUCCEEDED'
  | 'OUTBOUND_FAILED'
  | 'RESULT_UNKNOWN';

export type NotificationReconciliationInput = Readonly<{
  status: Extract<NotificationStatus, 'COMMAND_PENDING' | 'DISPATCHED' | 'UNKNOWN_RESULT'>;
  observation: NotificationReconciliationObservation;
  explicitReconciliation: boolean;
}>;

export type NotificationReconciliationDecision = Readonly<{
  action: 'DEFER' | 'TRANSITION';
  targetStatus: Extract<NotificationStatus, 'DISPATCHED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN_RESULT'> | null;
  resultCertainty: NotificationResultCertainty;
}>;

export type UnknownNotificationResultPolicy = Readonly<{
  automaticRetryAllowed: false;
  automaticResendAllowed: false;
  claimAllowed: false;
  assumeDelivered: false;
  assumeNotDelivered: false;
  requiresHumanReconciliation: true;
}>;

export type NotificationIdempotencyBinding = Readonly<{
  scope: string;
  complaintId: string;
  eventId: string;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  recipientIdentityHash: string;
  templateVersion: string;
  factsHash: string;
}>;
