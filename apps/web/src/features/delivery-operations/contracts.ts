import { z } from 'zod';

export const deliveryWorkflowStatusSchema = z.enum([
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'IN_TRANSIT',
  'DELIVERED',
  'ISSUE',
]);

export const deliveryIssueTypeSchema = z.enum([
  'CUSTOMER_UNREACHABLE',
  'INCOMPLETE_ADDRESS',
  'LOCATION_MISMATCH',
  'PAYMENT_PENDING',
  'DELIVERY_REJECTED',
  'ROUTE_INCIDENT',
  'OTHER',
]);

const numericSchema = z.union([z.number(), z.string()]);

const paymentEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  paymentMethod: z.string().nullable(),
  previousStatus: z.string().nullable(),
  newStatus: z.string(),
  message: z.string().nullable(),
  createdAt: z.string(),
  actor: z.object({ id: z.string(), fullName: z.string(), accessName: z.string().nullable() }).nullable(),
});

const historicalWhatsappOrderSchema = z.object({
  id: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  paymentMethod: z.string().nullable(),
  publicPaymentTokenExpiresAt: z.string().nullable(),
  paymentLinkCreatedAt: z.string().nullable(),
  paymentLinkLastOpenedAt: z.string().nullable(),
  paymentLinkOpenCount: z.number().int().nonnegative(),
  paymentMethodSelectedAt: z.string().nullable(),
  manuallyVerifiedAt: z.string().nullable(),
  manuallyVerifiedById: z.string().nullable(),
  orderReference: z.string().nullable(),
  onlinePaymentProvider: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  providerReference: z.string().nullable(),
  providerCheckoutUrl: z.string().nullable(),
  providerStatus: z.string().nullable(),
  onlinePaymentCreatedAt: z.string().nullable(),
  onlinePaymentExpiresAt: z.string().nullable(),
  onlinePaymentPaidAt: z.string().nullable(),
  webhookLastEventAt: z.string().nullable(),
  webhookEventCount: z.number().int().nonnegative(),
  paymentFailureReason: z.string().nullable(),
  paymentReviewReason: z.string().nullable(),
  source: z.string(),
  createdByAgentNameSnapshot: z.string(),
  customerNameSnapshot: z.string().nullable(),
  customerPhoneSnapshot: z.string().nullable(),
  manuallyVerifiedBy: z.object({ id: z.string(), fullName: z.string(), accessName: z.string().nullable() }).nullable(),
  paymentEvents: z.array(paymentEventSchema),
});

export const deliveryOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  deliveryReference: z.string().nullable(),
  deliveryLatitude: numericSchema.nullable(),
  deliveryLongitude: numericSchema.nullable(),
  deliveryDistanceKm: numericSchema.nullable(),
  deliveryZoneLabel: z.string().nullable(),
  deliveryFee: numericSchema,
  deliveryLocationReceivedAt: z.string().nullable(),
  assignedRiderId: z.string().nullable(),
  assignedRider: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  deliveryWorkflowStatus: deliveryWorkflowStatusSchema.nullable(),
  deliveryIssues: z.array(
    z.object({
      id: z.string(),
      issueType: deliveryIssueTypeSchema,
      summary: z.string(),
      details: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  whatsappDeliveryOrder: historicalWhatsappOrderSchema.nullable().optional(),
  subtotal: numericSchema,
  updatedAt: z.string(),
});

export const deliveryOrdersSchema = z.array(deliveryOrderSchema);

export const locationInboxItemSchema = z.object({
  id: z.string(),
  matchStatus: z.enum(['PENDING', 'APPLIED', 'REQUIRES_REVIEW', 'IGNORED']),
  matchedRule: z.string().nullable(),
  processingNotes: z.string().nullable(),
  receivedAt: z.string(),
  candidateOrders: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      customerName: z.string().nullable(),
      customerPhone: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
});

export const locationInboxSchema = z.array(locationInboxItemSchema);

export const operationalAlertSchema = z.object({
  id: z.string(),
  type: z.string(),
  module: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']),
  title: z.string(),
  message: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  createdAt: z.string(),
});

export const operationalAlertsSchema = z.array(operationalAlertSchema);

export const deliveryRidersSchema = z.array(
  z.object({
    id: z.string(),
    fullName: z.string(),
    isActive: z.boolean(),
    roles: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
);

export const deliveryReceiptStatusSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  version: z.number().int().positive(),
  status: z.literal('ACTIVE'),
  total: z.number(),
  deliveryFee: z.number(),
  lastGeneratedAt: z.string(),
  sendStatus: z.enum([
    'NOT_REQUESTED',
    'PENDING',
    'SENT',
    'FAILED',
    'SKIPPED_NO_PHONE',
    'SKIPPED_CHANNEL_BLOCKED',
  ]),
  sentAt: z.string().nullable(),
});

export const deliveryReceiptHistorySchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  currentVersion: z.number().int().positive(),
  versions: z.array(
    z.object({
      version: z.number().int().positive(),
      receiptType: z.enum(['INITIAL', 'UPDATED']),
      status: z.enum(['ACTIVE', 'REPLACED']),
      generatedAt: z.string(),
      summary: z.string(),
      previousTotal: z.number().nullable(),
      newTotal: z.number().nullable(),
    }),
  ),
});

export type DeliveryWorkflowStatus = z.infer<typeof deliveryWorkflowStatusSchema>;
export type DeliveryIssueType = z.infer<typeof deliveryIssueTypeSchema>;
export type DeliveryOrder = z.infer<typeof deliveryOrderSchema>;
export type DeliveryLocationInboxItem = z.infer<typeof locationInboxItemSchema>;
export type OperationalAlert = z.infer<typeof operationalAlertSchema>;
export type DeliveryRider = z.infer<typeof deliveryRidersSchema>[number];
export type DeliveryReceiptStatus = z.infer<typeof deliveryReceiptStatusSchema>;
export type DeliveryReceiptHistory = z.infer<typeof deliveryReceiptHistorySchema>;
