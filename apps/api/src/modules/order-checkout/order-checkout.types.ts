import type {
  OrderCheckoutSource,
  OrderCheckoutStatus,
  OrderTicketType,
  PaymentIntentProvider,
  PaymentIntentStatus,
  SofiaPaymentPreference,
} from '@prisma/client';

export type CheckoutItemSnapshot = {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string | null;
  modifiers: Array<{
    kind: 'REMOVE' | 'ADD' | 'NOTE';
    ingredientId?: string | null;
    ingredient?: string | null;
    additionProductId?: string | null;
    quantity?: number | null;
  }>;
};

export type CheckoutCustomerSnapshot = {
  name: string | null;
  phoneMasked: string | null;
  deliveryAddress: string | null;
  deliveryNeighborhood: string | null;
  deliveryNotes: string | null;
  deliveryQuoteAuditId: string | null;
  deliveryQuoteVersion: number | null;
};

export type CreateSofiaCheckoutCommand = {
  draftId: string;
  expectedDraftVersion: number;
  expectedDraftHash: string;
  confirmationHash: string;
  idempotencyKey: string;
  actorId: string;
};

export type CheckoutView = {
  id: string;
  source: OrderCheckoutSource;
  sourceReference: string;
  status: OrderCheckoutStatus;
  version: number;
  fulfillment: OrderTicketType;
  paymentPreference: SofiaPaymentPreference;
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  orderTicketId: string | null;
  expiresAt: Date | null;
  items: CheckoutItemSnapshot[];
  customer: CheckoutCustomerSnapshot | null;
};

export type CreateOnlinePaymentCommand = {
  checkoutId: string;
  idempotencyKey: string;
  actorId: string;
};

/**
 * PK5 TOCTOU remediation (see
 * .engineering/sofia-production/remediation/payment-toctou/00-design.md) — contract only,
 * scaffolding for P1. The repository's `createPaymentIntent` transaction must invoke this
 * callback immediately after taking the `order_checkouts` row lock and re-reading fresh
 * checkout + PaymentIntent state under that lock, and before any create — never against a
 * pre-transaction read. Implementation of the call site and of the fresh re-read is P1's,
 * not scaffolded here.
 */
export type PaymentIntentRelinkPolicy = (
  checkout: { status: OrderCheckoutStatus; expiresAt: Date | null },
  paymentIntents: readonly {
    idempotencyKey: string;
    status: PaymentIntentStatus;
    expiresAt: Date | null;
  }[],
) => void;

export type PaymentIntentView = {
  id: string;
  checkoutId: string;
  attemptNumber: number;
  provider: PaymentIntentProvider;
  status: PaymentIntentStatus;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerReference: string | null;
  expiresAt: Date | null;
};

export type CanonicalWebhookResult = {
  processedStatus:
    | 'PROCESSED'
    | 'DUPLICATE_REPLAY'
    | 'SIGNATURE_INVALID'
    | 'REFERENCE_UNKNOWN'
    | 'AMOUNT_MISMATCH'
    | 'CURRENCY_MISMATCH'
    | 'ACCOUNT_MISMATCH'
    | 'FINANCIAL_REVIEW_REQUIRED';
  paymentIntentId: string | null;
  paymentStatus: PaymentIntentStatus | null;
};

