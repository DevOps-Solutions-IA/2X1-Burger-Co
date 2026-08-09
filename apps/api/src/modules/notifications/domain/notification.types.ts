export const NOTIFICATION_STATUSES = [
  'PENDING',
  'CLAIMED',
  'DISPATCHING',
  'ACCEPTED',
  'DELIVERED',
  'FAILED',
  'UNKNOWN_RESULT',
  'CANCELLED',
  'EXPIRED',
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'IN_APP';
export type NotificationPurpose = 'CUSTOMER_SERVICE_CASE_UPDATE' | 'HUMAN_REVIEW_ALERT';
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
    | 'NOTIFICATION_RETRY_CLAIM_ALLOWED'
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
