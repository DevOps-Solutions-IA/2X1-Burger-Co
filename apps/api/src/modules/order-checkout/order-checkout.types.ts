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

/**
 * P4 lease-timezone remediation (see
 * .engineering/sofia-production/remediation/payment-lease-timezone/00-design.md) — contract
 * only, scaffolding for P5. Every write of `PaymentWebhookEvent.processingLeaseExpiresAt` (and
 * `nextRetryAt`, written alongside it in every affected statement) MUST go exclusively through
 * the typed Prisma Client — never a raw `$executeRaw`/`$queryRaw` bind parameter, never a
 * SQL-side `CURRENT_TIMESTAMP` comparison. This project's Prisma query engine serializes a bare
 * JS `Date` bound into raw SQL using the Postgres *session's* `TimeZone` setting when writing to
 * a "timestamp without time zone" column, while the typed Prisma Client always
 * serializes/compares `DateTime` values using a UTC-normalized, session-timezone-independent
 * representation — empirically verified (see design doc §1.1–§2) to be the only combination that
 * is correct under a non-UTC session across every read/write/compare path in
 * `prisma-order-checkout.repository.ts`. Implementation (wiring this into `claimWebhookEvidence`,
 * `claimRecoverableWebhook`, `advanceWebhookCheckpoint`, `completeWebhookClaim`,
 * `assertWebhookClaimOwned`, `renewWebhookClaim`, `failWebhookClaim`,
 * `findRecoverableWebhookIds`) is P5's job; this type is not imported/used anywhere yet.
 */
export type WebhookLeaseTypedWrite = {
  processingLeaseOwnerHash: string | null;
  processingLeaseExpiresAt: Date | null;
  nextRetryAt?: Date | null;
};

