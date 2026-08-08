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
