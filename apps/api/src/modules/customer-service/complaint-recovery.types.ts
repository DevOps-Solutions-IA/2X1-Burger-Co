export const COMPLAINT_CATEGORIES = [
  'ORDER_ACCURACY',
  'PRODUCT_QUALITY',
  'DELIVERY_EXPERIENCE',
  'SERVICE_EXPERIENCE',
  'FOOD_SAFETY',
  'PAYMENT_CONCERN',
  'OTHER',
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_STATUSES = [
  'RECEIVED',
  'TRIAGED',
  'AWAITING_INFORMATION',
  'HUMAN_REVIEW',
  'RESOLVED',
  'CLOSED',
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export type ComplaintPriority = 'NORMAL' | 'HIGH' | 'CRITICAL';

export type ComplaintCategoryPolicy = Readonly<{
  priority: ComplaintPriority;
  humanReviewRequired: boolean;
  immediateEscalationRequired: boolean;
}>;

export const RECOVERY_ACTIONS = [
  'ACKNOWLEDGE',
  'APOLOGIZE',
  'REQUEST_INFORMATION',
  'ESCALATE_TO_HUMAN',
  'SHARE_CASE_REFERENCE',
] as const;

export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export const FORBIDDEN_RECOVERY_AUTHORITIES = [
  'ISSUE_REFUND',
  'APPLY_DISCOUNT',
  'AUTHORIZE_REPLACEMENT',
  'GRANT_COMPENSATION',
] as const;

export type ForbiddenRecoveryAuthority = (typeof FORBIDDEN_RECOVERY_AUTHORITIES)[number];

export type RecoveryAuthority = Readonly<{
  canIssueRefund: false;
  canApplyDiscount: false;
  canAuthorizeReplacement: false;
  canGrantCompensation: false;
}>;

export type RecoveryActionDecision = Readonly<{
  allowed: boolean;
  requiresHuman: boolean;
  reasonCode: 'RECOVERY_ACTION_ALLOWED' | 'RECOVERY_REMEDY_REQUIRES_HUMAN' | 'RECOVERY_ACTION_UNSUPPORTED';
}>;

export const COMPLAINT_FACT_KINDS = [
  'CUSTOMER_STATEMENT',
  'ORDER_REFERENCE_HASH',
  'INCIDENT_AT',
  'CHANNEL',
  'PRODUCT_REFERENCE',
  'EVIDENCE_REFERENCE_HASH',
] as const;

export type ComplaintFactKind = (typeof COMPLAINT_FACT_KINDS)[number];
export const COMPLAINT_FACT_SOURCES = ['CUSTOMER', 'OPERATOR', 'SYSTEM'] as const;
export type ComplaintFactSource = (typeof COMPLAINT_FACT_SOURCES)[number];

export type ComplaintFact = Readonly<{
  id: string;
  kind: ComplaintFactKind;
  value: string;
  source: ComplaintFactSource;
  recordedAt: string;
  supersedesFactId: string | null;
  sanitizationVersion: 1;
}>;

export type NewComplaintFact = Readonly<{
  kind: ComplaintFactKind;
  value: string;
  source: ComplaintFactSource;
  recordedAt: Date | string;
  supersedesFactId?: string | null;
}>;

export type ComplaintRecord = Readonly<{
  id: string;
  category: ComplaintCategory;
  status: ComplaintStatus;
  facts: readonly ComplaintFact[];
}>;
