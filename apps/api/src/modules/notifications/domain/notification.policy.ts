import type {
  NotificationClaimDecision,
  NotificationClaimInput,
  NotificationStatus,
  NotificationTransitionContext,
  UnknownNotificationResultPolicy,
} from './notification.types';

const TRANSITIONS = Object.freeze<Record<NotificationStatus, readonly NotificationStatus[]>>({
  PENDING: ['CLAIMED', 'CANCELLED', 'EXPIRED'],
  CLAIMED: ['PENDING', 'DISPATCHING', 'FAILED', 'CANCELLED', 'EXPIRED'],
  DISPATCHING: ['ACCEPTED', 'FAILED', 'UNKNOWN_RESULT'],
  ACCEPTED: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['CLAIMED'],
  UNKNOWN_RESULT: ['ACCEPTED', 'FAILED'],
  CANCELLED: [],
  EXPIRED: [],
});

export const UNKNOWN_NOTIFICATION_RESULT_POLICY: UnknownNotificationResultPolicy = Object.freeze({
  automaticRetryAllowed: false,
  automaticResendAllowed: false,
  claimAllowed: false,
  assumeDelivered: false,
  assumeNotDelivered: false,
  requiresHumanReconciliation: true,
});

export class NotificationPolicyError extends Error {
  constructor(readonly code: 'NOTIFICATION_STATUS_TRANSITION_BLOCKED') {
    super(code);
    this.name = 'NotificationPolicyError';
  }
}

function decision(
  allowed: boolean,
  reasonCode: NotificationClaimDecision['reasonCode'],
  requiresHumanReconciliation = false,
): NotificationClaimDecision {
  return Object.freeze({ allowed, reasonCode, requiresHumanReconciliation });
}

export function evaluateNotificationClaim(input: NotificationClaimInput): NotificationClaimDecision {
  if (input.status === 'UNKNOWN_RESULT' || input.resultCertainty === 'UNKNOWN') {
    return decision(false, 'NOTIFICATION_UNKNOWN_RESULT_RECONCILIATION_REQUIRED', true);
  }
  if (input.status === 'PENDING') return decision(true, 'NOTIFICATION_CLAIM_ALLOWED');
  if (input.status === 'FAILED' && input.retryable && input.resultCertainty === 'NOT_ACCEPTED') {
    return decision(true, 'NOTIFICATION_RETRY_CLAIM_ALLOWED');
  }
  if (input.status === 'CLAIMED') {
    const leaseExpired = input.leaseExpiresAt !== null && input.leaseExpiresAt.getTime() <= input.now.getTime();
    if (!leaseExpired) return decision(false, 'NOTIFICATION_CLAIM_ACTIVE');
    if (input.dispatchStartedAt === null && input.resultCertainty === 'NOT_ATTEMPTED') {
      return decision(true, 'NOTIFICATION_PRE_DISPATCH_LEASE_RECLAIM_ALLOWED');
    }
    return decision(false, 'NOTIFICATION_UNKNOWN_RESULT_RECONCILIATION_REQUIRED', true);
  }
  if (input.status === 'DISPATCHING') {
    return decision(false, 'NOTIFICATION_UNKNOWN_RESULT_RECONCILIATION_REQUIRED', true);
  }
  return decision(false, 'NOTIFICATION_STATUS_NOT_CLAIMABLE');
}

export function canTransitionNotification(
  from: NotificationStatus,
  to: NotificationStatus,
  context: NotificationTransitionContext = {},
): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (from === 'FAILED') return context.retryable === true && context.resultCertainty === 'NOT_ACCEPTED';
  if (from === 'DISPATCHING') {
    if (to === 'ACCEPTED') return context.resultCertainty === 'ACCEPTED';
    if (to === 'FAILED') return context.resultCertainty === 'NOT_ACCEPTED';
    return to === 'UNKNOWN_RESULT' && context.resultCertainty === 'UNKNOWN';
  }
  if (from === 'UNKNOWN_RESULT') {
    if (context.manualReconciliation !== true) return false;
    return (to === 'ACCEPTED' && context.resultCertainty === 'ACCEPTED')
      || (to === 'FAILED' && context.resultCertainty === 'NOT_ACCEPTED');
  }
  if (from === 'CLAIMED' && to === 'PENDING') {
    return context.resultCertainty === 'NOT_ATTEMPTED';
  }
  return true;
}

export function assertNotificationTransition(
  from: NotificationStatus,
  to: NotificationStatus,
  context: NotificationTransitionContext = {},
): void {
  if (!canTransitionNotification(from, to, context)) {
    throw new NotificationPolicyError('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
  }
}
