# Migration assessment

## Decision

**Migration 36 is required. No migration was created. Owner authorization is required before implementation continues.**

Existing schema cannot safely satisfy the Phase 5 contract:

- no `OrderCheckout`, `PaymentIntent`, `PaymentLink` or append-only `PaymentTransition` exists;
- `OrderTicket` has no channel source, confirmed-draft binding, source idempotency key or checkout relation (`prisma/schema.prisma:908-981`);
- `WhatsappDeliveryOrder` combines WhatsApp order, link, provider identity and mutable payment state in one record (`:1129-1185`), allowing only one provider slot;
- webhook events bind only to that WhatsApp-specific record (`:1538-1561`);
- `SofiaOrderSource` does not represent POS, DOMICILIOS or AUTHORIZED_OPERATOR (`:267-272`);
- `OrderTicketItem` lacks structured modifiers (`:1674-1689`);
- `SalePayment` lacks a provider/payment-intent identity (`:768-780`).

## Minimal additive migration proposal

1. `OrderCheckout`: source enum, source reference/idempotency key, optional Sofia draft/version/hash/confirmation hash, immutable customer/items/totals snapshots, fulfillment, payment preference, state/version, kitchen eligibility and nullable unique ticket relation.
2. `PaymentIntent`: checkout, attempt/idempotency, provider, immutable amount/currency, provider IDs/account, expiry and states including `UNKNOWN_RESULT` and `FINANCIAL_REVIEW_REQUIRED`.
3. `PaymentLink`: intent, token hash (never plaintext token), provider URL, expiry/revocation/open state.
4. `PaymentTransition`: append-only from/to, reason, actor, webhook, idempotency and sanitized metadata.
5. Extend webhook event with intent, payload hash and provider-account hash; unique `(provider,eventId)`.
6. Add `OrderTicketItem.modifiersSnapshot JSONB NOT NULL DEFAULT []`.
7. Add nullable unique `SalePayment.paymentIntentId`.

All additions should be nullable/additive for historical data. Do not reinterpret `WhatsappDeliveryOrder`; do not backfill historical payments automatically. Before unique indexes, query production duplicates. Rollback is application-first: disable gates and revert code without dropping new financial evidence.

## Exact migration 36 contract proposed for owner authorization

The following is the bounded schema contract to review. Names follow the current Prisma conventions. This is a proposal only: migration 36 and runtime implementation have not been created.

### New enums

```prisma
enum OrderCheckoutSource {
  SOFIA
  POS
  DELIVERY
  AUTHORIZED_OPERATOR
}

enum OrderCheckoutStatus {
  CONFIRMED
  PAYMENT_SELECTION_REQUIRED
  PAYMENT_PENDING
  PAYMENT_VERIFIED
  KITCHEN_ELIGIBLE
  ORDER_CREATED
  CANCELLED
  EXPIRED
  FINANCIAL_REVIEW_REQUIRED
}

enum PaymentIntentProvider {
  BOLD
  CASH
}

enum PaymentIntentStatus {
  CREATED
  LINK_READY
  PENDING
  SUCCEEDED
  FAILED
  EXPIRED
  CANCELLED
  UNKNOWN_RESULT
  FINANCIAL_REVIEW_REQUIRED
}

enum PaymentLinkStatus {
  ACTIVE
  OPENED
  REVOKED
  EXPIRED
}
```

### New `OrderCheckout`

```prisma
model OrderCheckout {
  id                    String                 @id @default(cuid())
  source                OrderCheckoutSource
  sourceReference       String                 @map("source_reference")
  idempotencyKey        String                 @map("idempotency_key")
  sofiaDraftId          String?                @map("sofia_draft_id")
  sofiaDraftVersion     Int?                   @map("sofia_draft_version")
  sofiaDraftHash        String?                @map("sofia_draft_hash")
  confirmationHash      String?                @map("confirmation_hash")
  customerId            String?                @map("customer_id")
  customerSnapshot      Json?                  @map("customer_snapshot")
  itemsSnapshot         Json                   @map("items_snapshot")
  subtotal              Decimal                @db.Decimal(12, 2)
  deliveryFee           Decimal                @default(0) @map("delivery_fee") @db.Decimal(12, 2)
  total                 Decimal                @db.Decimal(12, 2)
  currency              String                 @default("COP")
  fulfillment           OrderTicketType
  paymentPreference     SofiaPaymentPreference @map("payment_preference")
  status                OrderCheckoutStatus    @default(CONFIRMED)
  version               Int                    @default(1)
  kitchenEligibleAt     DateTime?              @map("kitchen_eligible_at")
  orderTicketId         String?                @unique @map("order_ticket_id")
  expiresAt             DateTime?              @map("expires_at")
  createdAt             DateTime               @default(now()) @map("created_at")
  updatedAt             DateTime               @updatedAt @map("updated_at")

  sofiaDraft            SofiaOrderDraft?        @relation(fields: [sofiaDraftId], references: [id], onDelete: SetNull)
  customer              Customer?               @relation(fields: [customerId], references: [id], onDelete: SetNull)
  orderTicket           OrderTicket?            @relation(fields: [orderTicketId], references: [id], onDelete: SetNull)
  paymentIntents        PaymentIntent[]

  @@unique([source, idempotencyKey])
  @@unique([sofiaDraftId, sofiaDraftVersion])
  @@index([status, expiresAt])
  @@index([customerId, createdAt])
  @@index([source, sourceReference])
  @@map("order_checkouts")
}
```

The reverse relation arrays required by Prisma would be added minimally to `SofiaOrderDraft` and `Customer`, plus the optional singular reverse relation on `OrderTicket`. Historical rows in those tables are untouched.

### New payment records

```prisma
model PaymentIntent {
  id                    String                @id @default(cuid())
  checkoutId            String                @map("checkout_id")
  attemptNumber         Int                   @map("attempt_number")
  idempotencyKey        String                @map("idempotency_key")
  provider              PaymentIntentProvider
  amount                Decimal               @db.Decimal(12, 2)
  currency              String                @default("COP")
  status                PaymentIntentStatus   @default(CREATED)
  providerPaymentId     String?               @map("provider_payment_id")
  providerReference     String?               @map("provider_reference")
  providerAccountHash   String?               @map("provider_account_hash")
  failureCode           String?               @map("failure_code")
  expiresAt             DateTime?             @map("expires_at")
  completedAt           DateTime?             @map("completed_at")
  version               Int                   @default(1)
  createdAt             DateTime              @default(now()) @map("created_at")
  updatedAt             DateTime              @updatedAt @map("updated_at")

  checkout              OrderCheckout         @relation(fields: [checkoutId], references: [id], onDelete: Restrict)
  links                 PaymentLink[]
  transitions           PaymentTransition[]
  webhookEvents         PaymentWebhookEvent[]
  salePayment           SalePayment?

  @@unique([checkoutId, attemptNumber])
  @@unique([provider, idempotencyKey])
  @@unique([provider, providerPaymentId])
  @@index([checkoutId, status])
  @@index([status, expiresAt])
  @@index([provider, providerReference])
  @@map("payment_intents")
}

model PaymentLink {
  id                    String            @id @default(cuid())
  paymentIntentId       String            @map("payment_intent_id")
  tokenHash             String            @unique @map("token_hash")
  providerReference     String?           @map("provider_reference")
  status                PaymentLinkStatus @default(ACTIVE)
  expiresAt             DateTime          @map("expires_at")
  openedAt              DateTime?         @map("opened_at")
  revokedAt             DateTime?         @map("revoked_at")
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  paymentIntent         PaymentIntent     @relation(fields: [paymentIntentId], references: [id], onDelete: Restrict)

  @@index([paymentIntentId, status])
  @@index([status, expiresAt])
  @@map("payment_links")
}

model PaymentTransition {
  id                    String              @id @default(cuid())
  paymentIntentId       String              @map("payment_intent_id")
  fromStatus            PaymentIntentStatus? @map("from_status")
  toStatus              PaymentIntentStatus @map("to_status")
  reasonCode            String              @map("reason_code")
  actorId               String?             @map("actor_id")
  webhookEventId        String?             @map("webhook_event_id")
  idempotencyKey        String              @map("idempotency_key")
  sanitizedMetadata     Json?               @map("sanitized_metadata")
  createdAt             DateTime            @default(now()) @map("created_at")

  paymentIntent         PaymentIntent       @relation(fields: [paymentIntentId], references: [id], onDelete: Restrict)

  @@unique([paymentIntentId, idempotencyKey])
  @@index([paymentIntentId, createdAt])
  @@index([webhookEventId])
  @@map("payment_transitions")
}
```

`PaymentLink` deliberately stores only a token hash and a provider reference, not a plaintext public token or credential-bearing provider URL.

### Additive extensions

- `PaymentWebhookEvent`: add nullable `paymentIntentId`, `payloadHash`, and `providerAccountHash`; add the relation/index to `PaymentIntent`; replace the current global `eventId @unique` with scoped `@@unique([provider, eventId])` only after a duplicate preflight. This is the only proposed constraint replacement and requires review because dropping the old unique index is technically destructive DDL even though it does not delete data.
- `OrderTicketItem`: add `modifiersSnapshot Json @default("[]") @map("modifiers_snapshot")` so historical rows receive an empty immutable modifier list without backfill code.
- `SalePayment`: add nullable unique `paymentIntentId` plus an optional `PaymentIntent` relation with `onDelete: SetNull`.
- Add only Prisma-required reverse relation fields to `OrderTicket`, `SofiaOrderDraft`, `Customer`, and `PaymentWebhookEvent`.

### Safety and deployment preconditions

- Exactly one additive migration directory: proposed migration 36.
- No application table drop, column drop, row update, delete, truncate, or historical migration modification.
- Preflight `PaymentWebhookEvent` duplicates by `(provider, eventId)` and existing global `eventId` collisions before changing uniqueness. If any conflict exists, stop rather than rewrite evidence.
- Apply nullable fields/new tables first; deploy gated readers/writers afterward. Operational order, payment, inventory, cash, sale, kitchen and WhatsApp mutations remain disabled until separately authorized.
- Rollback is application-first. New financial evidence tables are retained; rollback must not drop captured attempts, results, or webhook evidence.
