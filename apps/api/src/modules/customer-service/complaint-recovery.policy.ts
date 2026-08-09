import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  FORBIDDEN_RECOVERY_AUTHORITIES,
  RECOVERY_ACTIONS,
  type ComplaintCategory,
  type ComplaintCategoryPolicy,
  type ComplaintStatus,
  type RecoveryActionDecision,
  type RecoveryAuthority,
} from './complaint-recovery.types';

const CATEGORY_POLICIES: Readonly<Record<ComplaintCategory, ComplaintCategoryPolicy>> = Object.freeze({
  ORDER_ACCURACY: Object.freeze({ priority: 'NORMAL', humanReviewRequired: false, immediateEscalationRequired: false }),
  PRODUCT_QUALITY: Object.freeze({ priority: 'HIGH', humanReviewRequired: true, immediateEscalationRequired: false }),
  DELIVERY_EXPERIENCE: Object.freeze({ priority: 'NORMAL', humanReviewRequired: false, immediateEscalationRequired: false }),
  SERVICE_EXPERIENCE: Object.freeze({ priority: 'NORMAL', humanReviewRequired: false, immediateEscalationRequired: false }),
  FOOD_SAFETY: Object.freeze({ priority: 'CRITICAL', humanReviewRequired: true, immediateEscalationRequired: true }),
  PAYMENT_CONCERN: Object.freeze({ priority: 'HIGH', humanReviewRequired: true, immediateEscalationRequired: true }),
  OTHER: Object.freeze({ priority: 'NORMAL', humanReviewRequired: true, immediateEscalationRequired: false }),
});

const STATUS_TRANSITIONS = Object.freeze<Record<ComplaintStatus, readonly ComplaintStatus[]>>({
  RECEIVED: ['TRIAGED', 'HUMAN_REVIEW', 'CLOSED'],
  TRIAGED: ['AWAITING_INFORMATION', 'HUMAN_REVIEW', 'RESOLVED', 'CLOSED'],
  AWAITING_INFORMATION: ['TRIAGED', 'HUMAN_REVIEW', 'CLOSED'],
  HUMAN_REVIEW: ['AWAITING_INFORMATION', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'HUMAN_REVIEW'],
  CLOSED: [],
});

export const NO_RECOVERY_AUTHORITY: RecoveryAuthority = Object.freeze({
  canIssueRefund: false,
  canApplyDiscount: false,
  canAuthorizeReplacement: false,
  canGrantCompensation: false,
});

export class ComplaintPolicyError extends Error {
  constructor(readonly code: 'COMPLAINT_CATEGORY_INVALID' | 'COMPLAINT_STATUS_TRANSITION_BLOCKED') {
    super(code);
    this.name = 'ComplaintPolicyError';
  }
}

export function complaintCategoryPolicy(category: ComplaintCategory): ComplaintCategoryPolicy {
  if (!COMPLAINT_CATEGORIES.includes(category)) throw new ComplaintPolicyError('COMPLAINT_CATEGORY_INVALID');
  return CATEGORY_POLICIES[category];
}

export function canTransitionComplaint(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return COMPLAINT_STATUSES.includes(from) && COMPLAINT_STATUSES.includes(to) && STATUS_TRANSITIONS[from].includes(to);
}

export function assertComplaintTransition(from: ComplaintStatus, to: ComplaintStatus): void {
  if (!canTransitionComplaint(from, to)) throw new ComplaintPolicyError('COMPLAINT_STATUS_TRANSITION_BLOCKED');
}

export function evaluateRecoveryAction(action: string): RecoveryActionDecision {
  if ((FORBIDDEN_RECOVERY_AUTHORITIES as readonly string[]).includes(action)) {
    return Object.freeze({ allowed: false, requiresHuman: true, reasonCode: 'RECOVERY_REMEDY_REQUIRES_HUMAN' });
  }
  if ((RECOVERY_ACTIONS as readonly string[]).includes(action)) {
    return Object.freeze({ allowed: true, requiresHuman: action === 'ESCALATE_TO_HUMAN', reasonCode: 'RECOVERY_ACTION_ALLOWED' });
  }
  return Object.freeze({ allowed: false, requiresHuman: true, reasonCode: 'RECOVERY_ACTION_UNSUPPORTED' });
}
