import { z } from 'zod';

export const serviceCaseStatuses = ['OPEN', 'HUMAN_REQUIRED', 'HUMAN_TAKEN', 'RESOLVED', 'CLOSED'] as const;
export const serviceCaseCategories = [
  'LATE_ORDER',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'COLD_FOOD',
  'QUALITY',
  'PAYMENT_PROBLEM',
  'DELIVERY_PROBLEM',
  'OTHER',
] as const;

const dateValue = z.string();
const nullableDate = dateValue.nullable();
const moneyValue = z.union([z.number(), z.string()]);

export const serviceCaseEventSchema = z.object({
  id: z.string(),
  version: z.number(),
  action: z.string(),
  fromStatus: z.enum(serviceCaseStatuses).nullable(),
  toStatus: z.enum(serviceCaseStatuses),
  actorId: z.string().nullable(),
  reasonCode: z.string(),
  sanitizedMetadata: z.unknown().nullable(),
  createdAt: dateValue,
}).passthrough();

export const serviceCaseSchema = z.object({
  id: z.string(),
  category: z.enum(serviceCaseCategories),
  status: z.enum(serviceCaseStatuses),
  source: z.string(),
  sanitizedSummary: z.string(),
  customerId: z.string().nullable(),
  conversationId: z.string().nullable(),
  orderCheckoutId: z.string().nullable(),
  orderTicketId: z.string().nullable(),
  paymentIntentId: z.string().nullable(),
  deliveryIssueId: z.string().nullable(),
  assignedActorId: z.string().nullable(),
  resolutionActorId: z.string().nullable(),
  resolutionCode: z.string().nullable(),
  version: z.number(),
  createdAt: dateValue,
  updatedAt: dateValue,
  resolvedAt: nullableDate,
  closedAt: nullableDate,
  customer: z.object({
    id: z.string(),
    displayName: z.string().nullable(),
    status: z.string(),
  }).nullable(),
  assignedActor: z.object({
    id: z.string(),
    fullName: z.string(),
    accessName: z.string(),
  }).nullable(),
  orderCheckout: z.object({
    id: z.string(),
    status: z.string(),
    fulfillment: z.string(),
    paymentPreference: z.string(),
    total: moneyValue,
    currency: z.string(),
  }).nullable().optional(),
  orderTicket: z.object({
    id: z.string(),
    number: z.union([z.string(), z.number()]),
    status: z.string(),
    type: z.string(),
  }).nullable().optional(),
  paymentIntent: z.object({
    id: z.string(),
    provider: z.string(),
    status: z.string(),
    amount: moneyValue,
    currency: z.string(),
  }).nullable().optional(),
  deliveryIssue: z.object({
    id: z.string(),
    issueType: z.string(),
    status: z.string(),
    summary: z.string().nullable(),
    createdAt: dateValue,
    resolvedAt: nullableDate,
  }).nullable().optional(),
  events: z.array(serviceCaseEventSchema).optional(),
}).passthrough();

export const serviceCasePageSchema = z.object({
  items: z.array(serviceCaseSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

export const serviceCaseTransitionResponseSchema = z.object({
  state: z.enum(['CREATED', 'UPDATED', 'DETERMINISTIC_REPLAY']),
  serviceCase: serviceCaseSchema.partial().extend({
    id: z.string(),
    status: z.enum(serviceCaseStatuses),
    version: z.number(),
  }).passthrough(),
});

export type ServiceCase = z.infer<typeof serviceCaseSchema>;
export type ServiceCaseStatus = (typeof serviceCaseStatuses)[number];
export type ServiceCaseCategory = (typeof serviceCaseCategories)[number];

export const nextServiceCaseStatus: Readonly<Record<ServiceCaseStatus, ServiceCaseStatus | null>> = {
  OPEN: 'HUMAN_REQUIRED',
  HUMAN_REQUIRED: 'HUMAN_TAKEN',
  HUMAN_TAKEN: 'RESOLVED',
  RESOLVED: 'CLOSED',
  CLOSED: null,
};
