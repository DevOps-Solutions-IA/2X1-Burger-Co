import { z } from 'zod';

export const paymentIntentStatuses = [
  'CREATED',
  'LINK_READY',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'UNKNOWN_RESULT',
  'FINANCIAL_REVIEW_REQUIRED',
] as const;

export const paymentLinkStatuses = ['ACTIVE', 'OPENED', 'REVOKED', 'EXPIRED'] as const;
export const paymentProviders = ['BOLD', 'CASH'] as const;

const dateValue = z.string();
const nullableDate = dateValue.nullable();
const moneyValue = z.union([z.number(), z.string()]);

export const paymentTransitionSchema = z.object({
  id: z.string(),
  paymentIntentId: z.string(),
  fromStatus: z.enum(paymentIntentStatuses).nullable(),
  toStatus: z.enum(paymentIntentStatuses),
  reasonCode: z.string(),
  actorId: z.string().nullable().optional(),
  webhookEventId: z.string().nullable().optional(),
  sanitizedMetadata: z.unknown().nullable().optional(),
  createdAt: dateValue,
}).passthrough();

export const paymentWebhookSchema = z.object({
  id: z.string(),
  paymentIntentId: z.string().nullable(),
  provider: z.string(),
  eventId: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  providerReference: z.string().nullable(),
  eventType: z.string().nullable(),
  status: z.string().nullable(),
  amount: moneyValue.nullable(),
  currency: z.string().nullable(),
  signatureValid: z.boolean(),
  processedStatus: z.string(),
  processingAttempts: z.number(),
  resultCode: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  retryable: z.boolean(),
  receivedAt: dateValue,
  processedAt: nullableDate,
  payloadEvidencePresent: z.boolean(),
  providerAccountBound: z.boolean(),
  paymentTransition: paymentTransitionSchema.pick({
    id: true,
    fromStatus: true,
    toStatus: true,
    reasonCode: true,
    createdAt: true,
  }).nullable().optional(),
}).passthrough();

const paymentLinkSummarySchema = z.object({
  id: z.string(),
  status: z.enum(paymentLinkStatuses),
  expiresAt: dateValue,
  openedAt: nullableDate,
  revokedAt: nullableDate,
  createdAt: dateValue,
  updatedAt: dateValue,
}).passthrough();

const checkoutSummarySchema = z.object({
  source: z.string(),
  sourceReference: z.string(),
  status: z.string(),
  fulfillment: z.string(),
  paymentPreference: z.string(),
  orderTicketId: z.string().nullable(),
  total: moneyValue,
  currency: z.string(),
}).passthrough();

export const paymentIntentSchema = z.object({
  id: z.string(),
  checkoutId: z.string(),
  attemptNumber: z.number(),
  provider: z.enum(paymentProviders),
  amount: moneyValue,
  currency: z.string(),
  status: z.enum(paymentIntentStatuses),
  providerPaymentId: z.string().nullable(),
  providerReference: z.string().nullable(),
  providerAccountBound: z.boolean(),
  failureCode: z.string().nullable(),
  expiresAt: nullableDate,
  completedAt: nullableDate,
  version: z.number(),
  createdAt: dateValue,
  updatedAt: dateValue,
  checkout: checkoutSummarySchema,
  links: z.array(paymentLinkSummarySchema),
  transitions: z.array(paymentTransitionSchema).optional(),
  webhookEvents: z.array(paymentWebhookSchema).optional(),
  salePayment: z.object({
    id: z.string(),
    saleId: z.string(),
    amount: moneyValue,
    receivedAmount: moneyValue,
    changeAmount: moneyValue,
    createdAt: dateValue,
  }).nullable().optional(),
}).passthrough();

export const paymentLinkSchema = paymentLinkSummarySchema.extend({
  paymentIntentId: z.string(),
  paymentIntent: z.object({
    id: z.string().optional(),
    checkoutId: z.string(),
    status: z.enum(paymentIntentStatuses),
    provider: z.enum(paymentProviders).optional(),
    amount: moneyValue,
    currency: z.string(),
    expiresAt: nullableDate.optional(),
  }).passthrough(),
}).passthrough();

function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number(),
    limit: z.number(),
    total: z.number(),
  });
}

export const paymentIntentPageSchema = pageSchema(paymentIntentSchema);
export const paymentLinkPageSchema = pageSchema(paymentLinkSchema);
export const paymentTransitionPageSchema = pageSchema(paymentTransitionSchema);
export const paymentWebhookPageSchema = pageSchema(paymentWebhookSchema);

export type PaymentIntent = z.infer<typeof paymentIntentSchema>;
export type PaymentLink = z.infer<typeof paymentLinkSchema>;
export type PaymentTransition = z.infer<typeof paymentTransitionSchema>;
export type PaymentWebhook = z.infer<typeof paymentWebhookSchema>;
export type PaymentIntentStatus = (typeof paymentIntentStatuses)[number];

export function isFinancialSuccess(status: PaymentIntentStatus) {
  return status === 'SUCCEEDED';
}

export function requiresFinancialReview(status: PaymentIntentStatus) {
  return status === 'UNKNOWN_RESULT' || status === 'FINANCIAL_REVIEW_REQUIRED';
}
