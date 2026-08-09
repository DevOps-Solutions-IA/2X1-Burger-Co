import type {
  NotificationClaimDecision,
  NotificationClaimInput,
  NotificationReconciliationDecision,
  NotificationReconciliationInput,
  NotificationStatus,
  NotificationTransitionContext,
  UnknownNotificationResultPolicy,
} from './notification.types';

const TRANSITIONS = Object.freeze<Record<NotificationStatus, readonly NotificationStatus[]>>({
  PENDING: ['SUPPRESSED', 'CLAIMED', 'EXPIRED'],
  SUPPRESSED: [],
  CLAIMED: ['PENDING', 'COMMAND_PENDING', 'FAILED', 'EXPIRED'],
  COMMAND_PENDING: ['DISPATCHED', 'SUCCEEDED', 'FAILED', 'UNKNOWN_RESULT'],
  DISPATCHED: ['SUCCEEDED', 'FAILED', 'UNKNOWN_RESULT'],
  SUCCEEDED: [],
  FAILED: [],
  UNKNOWN_RESULT: ['SUCCEEDED', 'FAILED'],
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
  if (input.status === 'CLAIMED') {
    const leaseExpired = input.leaseExpiresAt !== null && input.leaseExpiresAt.getTime() <= input.now.getTime();
    if (!leaseExpired) return decision(false, 'NOTIFICATION_CLAIM_ACTIVE');
    if (input.dispatchStartedAt === null && input.resultCertainty === 'NOT_ATTEMPTED') {
      return decision(true, 'NOTIFICATION_PRE_DISPATCH_LEASE_RECLAIM_ALLOWED');
    }
    return decision(false, 'NOTIFICATION_UNKNOWN_RESULT_RECONCILIATION_REQUIRED', true);
  }
  if (input.status === 'COMMAND_PENDING' || input.status === 'DISPATCHED') {
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
  if (from === 'COMMAND_PENDING' || from === 'DISPATCHED') {
    if (to === 'DISPATCHED' || to === 'SUCCEEDED') return context.resultCertainty === 'ACCEPTED';
    if (to === 'FAILED') return context.resultCertainty === 'NOT_ACCEPTED';
    return to === 'UNKNOWN_RESULT' && context.resultCertainty === 'UNKNOWN';
  }
  if (from === 'UNKNOWN_RESULT') {
    if (context.manualReconciliation !== true) return false;
    return (to === 'SUCCEEDED' && context.resultCertainty === 'ACCEPTED')
      || (to === 'FAILED' && context.resultCertainty === 'NOT_ACCEPTED');
  }
  if (from === 'CLAIMED' && to === 'PENDING') {
    return context.resultCertainty === 'NOT_ATTEMPTED';
  }
  return true;
}

export function decideNotificationReconciliation(
  input: NotificationReconciliationInput,
): NotificationReconciliationDecision {
  if (input.status === 'UNKNOWN_RESULT' && !input.explicitReconciliation) {
    throw new NotificationPolicyError('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
  }

  if (input.observation === 'COMMAND_PENDING' || input.observation === 'OUTBOUND_PENDING') {
    if (input.status === 'UNKNOWN_RESULT') {
      throw new NotificationPolicyError('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
    }
    if (input.observation === 'OUTBOUND_PENDING' && input.status === 'COMMAND_PENDING') {
      return Object.freeze({ action: 'TRANSITION', targetStatus: 'DISPATCHED', resultCertainty: 'ACCEPTED' });
    }
    return Object.freeze({ action: 'DEFER', targetStatus: null, resultCertainty: 'NOT_ATTEMPTED' });
  }

  const targetStatus = input.observation === 'OUTBOUND_SUCCEEDED'
    ? 'SUCCEEDED'
    : input.observation === 'RESULT_UNKNOWN'
      ? 'UNKNOWN_RESULT'
      : 'FAILED';
  const resultCertainty = input.observation === 'OUTBOUND_SUCCEEDED'
    ? 'ACCEPTED'
    : input.observation === 'RESULT_UNKNOWN'
      ? 'UNKNOWN'
      : 'NOT_ACCEPTED';

  if (input.observation === 'COMMAND_REJECTED' && input.status !== 'COMMAND_PENDING') {
    throw new NotificationPolicyError('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
  }
  assertNotificationTransition(input.status, targetStatus, {
    resultCertainty,
    manualReconciliation: input.explicitReconciliation,
  });
  return Object.freeze({ action: 'TRANSITION', targetStatus, resultCertainty });
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
