import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'OPEN',
  'IN_PREPARATION',
  'SERVED',
  'PAYMENT_PENDING',
  'PAID',
  'CANCELLED',
]);

export const orderTypeSchema = z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'COUNTER']);

export const paymentIntentStatusSchema = z.enum([
  'CREATED',
  'LINK_READY',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'UNKNOWN_RESULT',
  'FINANCIAL_REVIEW_REQUIRED',
]);

const numericSchema = z.union([z.number(), z.string()]);
const nullableDateSchema = z.string().nullable().optional();

const operatorSchema = z
  .object({
    id: z.string(),
    fullName: z.string(),
    accessName: z.string().nullable().optional(),
  })
  .passthrough();

const paymentIntentSummarySchema = z.object({
  id: z.string(),
  status: paymentIntentStatusSchema,
  provider: z.string(),
});

const paymentIntentDetailSchema = paymentIntentSummarySchema.extend({
  attemptNumber: z.number().int().positive(),
  amount: numericSchema,
  currency: z.string(),
  failureCode: z.string().nullable(),
  completedAt: nullableDateSchema,
  updatedAt: z.string(),
});

export const checkoutSummarySchema = z
  .object({
    id: z.string(),
    status: z.string(),
    paymentPreference: z.string(),
    paymentIntents: z.array(paymentIntentSummarySchema).max(1),
  })
  .nullable();

export const operationalOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  revision: z.number().int().nonnegative(),
  status: orderStatusSchema,
  type: orderTypeSchema,
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  subtotal: numericSchema,
  deliveryFee: numericSchema,
  deliveryWorkflowStatus: z.string().nullable(),
  deliveryStatusUpdatedAt: nullableDateSchema,
  openedAt: z.string(),
  updatedAt: z.string(),
  assignedWaiter: operatorSchema.nullable(),
  assignedRider: operatorSchema.nullable(),
  orderCheckout: checkoutSummarySchema,
  _count: z.object({
    items: z.number().int().nonnegative(),
    customerServiceCases: z.number().int().nonnegative(),
  }),
});

export const operationalOrdersPageSchema = z.object({
  items: z.array(operationalOrderSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

const kitchenModifierSchema = z.record(z.string(), z.unknown());

export const kitchenOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  revision: z.number().int().nonnegative(),
  status: orderStatusSchema,
  type: orderTypeSchema,
  customerName: z.string().nullable(),
  notes: z.string().nullable(),
  openedAt: z.string(),
  updatedAt: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      productId: z.string(),
      quantity: numericSchema,
      notes: z.string().nullable(),
      modifiersSnapshot: z.array(kitchenModifierSchema),
      product: z.object({ name: z.string(), code: z.string() }),
    }),
  ),
  orderCheckout: checkoutSummarySchema,
});

export const kitchenQueuePageSchema = z.object({
  items: z.array(kitchenOrderSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

const orderItemSchema = z
  .object({
    id: z.string(),
    productId: z.string(),
    quantity: numericSchema,
    unitPrice: numericSchema,
    totalPrice: numericSchema,
    notes: z.string().nullable(),
    modifiersSnapshot: z.array(kitchenModifierSchema),
    product: z
      .object({
        name: z.string(),
        code: z.string(),
        category: z.object({ name: z.string() }).nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const paymentEventSchema = z
  .object({
    id: z.string(),
    eventType: z.string(),
    previousStatus: z.string().nullable(),
    newStatus: z.string(),
    message: z.string().nullable(),
    createdAt: z.string(),
    actor: operatorSchema.nullable(),
  })
  .passthrough();

export const orderDetailSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    revision: z.number().int().nonnegative(),
    status: orderStatusSchema,
    type: orderTypeSchema,
    customerName: z.string().nullable(),
    customerPhone: z.string().nullable(),
    notes: z.string().nullable(),
    subtotal: numericSchema,
    deliveryFee: numericSchema,
    deliveryReference: z.string().nullable(),
    deliveryAddressNormalized: z.string().nullable().optional(),
    deliveryZoneLabel: z.string().nullable().optional(),
    deliveryDistanceKm: numericSchema.nullable().optional(),
    deliveryWorkflowStatus: z.string().nullable(),
    deliveryStatusUpdatedAt: nullableDateSchema,
    deliveryDispatchedAt: nullableDateSchema,
    deliveryDeliveredAt: nullableDateSchema,
    deliveryIssueAt: nullableDateSchema,
    openedAt: z.string(),
    servedAt: nullableDateSchema,
    paidAt: nullableDateSchema,
    cancelledAt: nullableDateSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    table: z.object({ id: z.string(), label: z.string() }).passthrough().nullable(),
    createdBy: operatorSchema,
    assignedWaiter: operatorSchema.nullable(),
    assignedRider: operatorSchema.nullable(),
    items: z.array(orderItemSchema),
    orderCheckout: z
      .object({
        id: z.string(),
        status: z.string(),
        paymentPreference: z.string(),
        total: numericSchema,
        currency: z.string(),
        paymentIntents: z.array(paymentIntentDetailSchema).max(10),
      })
      .nullable(),
    sale: z
      .object({
        id: z.string(),
        status: z.string(),
        total: numericSchema,
        payments: z.array(
          z
            .object({
              id: z.string(),
              amount: numericSchema,
              createdAt: z.string(),
              paymentMethod: z.object({ name: z.string() }).passthrough().nullable(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .nullable(),
    whatsappDeliveryOrder: z
      .object({
        id: z.string(),
        status: z.string(),
        paymentStatus: z.string(),
        paymentMethod: z.string().nullable(),
        paymentReviewReason: z.string().nullable(),
        paymentFailureReason: z.string().nullable(),
        paymentEvents: z.array(paymentEventSchema),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderType = z.infer<typeof orderTypeSchema>;
export type PaymentIntentStatus = z.infer<typeof paymentIntentStatusSchema>;
export type CheckoutSummary = z.infer<typeof checkoutSummarySchema>;
export type OperationalOrder = z.infer<typeof operationalOrderSchema>;
export type OperationalOrdersPage = z.infer<typeof operationalOrdersPageSchema>;
export type KitchenOrder = z.infer<typeof kitchenOrderSchema>;
export type KitchenQueuePage = z.infer<typeof kitchenQueuePageSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type KitchenAction = 'START_PREPARATION' | 'MARK_READY';
