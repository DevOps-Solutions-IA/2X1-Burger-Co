export const CUSTOMER_SERVICE_CASE_REPOSITORY = Symbol('CUSTOMER_SERVICE_CASE_REPOSITORY');

export const CUSTOMER_SERVICE_CASE_CATEGORIES = [
  'LATE_ORDER',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'COLD_FOOD',
  'QUALITY',
  'PAYMENT_PROBLEM',
  'DELIVERY_PROBLEM',
  'OTHER',
] as const;

export type CustomerServiceCaseCategory = (typeof CUSTOMER_SERVICE_CASE_CATEGORIES)[number];

export const CUSTOMER_SERVICE_CASE_STATUSES = [
  'OPEN',
  'HUMAN_REQUIRED',
  'HUMAN_TAKEN',
  'RESOLVED',
  'CLOSED',
] as const;

export type CustomerServiceCaseStatus = (typeof CUSTOMER_SERVICE_CASE_STATUSES)[number];

export type CustomerServiceCaseRecord = Readonly<{
  id: string;
  category: CustomerServiceCaseCategory;
  status: CustomerServiceCaseStatus;
  source: string;
  sourceReference: string;
  evidenceHash: string;
  sanitizedSummary: string;
  customerId: string | null;
  conversationId: string | null;
  orderCheckoutId: string | null;
  orderTicketId: string | null;
  paymentIntentId: string | null;
  deliveryIssueId: string | null;
  assignedActorId: string | null;
  resolutionActorId: string | null;
  resolutionCode: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
}>;

export type CreateCustomerServiceCase = Readonly<{
  category: CustomerServiceCaseCategory;
  source: string;
  sourceReference: string;
  idempotencyKey: string;
  evidenceHash: string;
  sanitizedSummary: string;
  customerId?: string | null;
  conversationId?: string | null;
  orderCheckoutId?: string | null;
  orderTicketId?: string | null;
  paymentIntentId?: string | null;
  deliveryIssueId?: string | null;
  sanitizedMetadata?: Readonly<Record<string, string | number | boolean | null>> | null;
}>;

export type TransitionCustomerServiceCase = Readonly<{
  caseId: string;
  expectedVersion: number;
  idempotencyKey: string;
  fromStatus: CustomerServiceCaseStatus;
  toStatus: CustomerServiceCaseStatus;
  action: string;
  reasonCode: string;
  actorId?: string | null;
  resolutionCode?: string | null;
  sanitizedMetadata?: Readonly<Record<string, string | number | boolean | null>> | null;
}>;

export type CustomerServiceCaseWriteResult = Readonly<{
  state: 'CREATED' | 'UPDATED' | 'DETERMINISTIC_REPLAY';
  serviceCase: CustomerServiceCaseRecord;
}>;

export abstract class CustomerServiceCaseRepository {
  abstract createIdempotent(input: CreateCustomerServiceCase): Promise<CustomerServiceCaseWriteResult>;
  abstract transition(input: TransitionCustomerServiceCase): Promise<CustomerServiceCaseWriteResult>;
}

