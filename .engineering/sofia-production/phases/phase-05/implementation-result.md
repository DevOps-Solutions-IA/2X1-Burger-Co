# Phase 05 implementation result

Status: `IMPLEMENTED_PENDING_FINAL_REVIEW`.

- Base SHA: `c079a0666297336609c0ef0486436371a8d8ec47`.
- Final-review runtime SHA before evidence: `f0c68558608d2f1d0c49d47c0a4da2ae27da3714`.
- Migration: `20260808180000_sofia_order_payment_kitchen_core`, additive, 36/36 on fresh PostgreSQL.
- Canonical persistence: `OrderCheckout`, `PaymentIntent`, `PaymentLink`, and append-only `PaymentTransition`.
- Confirmed Sofia drafts require exact draft ID/version/hash/confirmation/expiry binding. Scoped source idempotency and bounded serialization retries produce one logical checkout.
- Checkout payment combinations are validated by one pure policy inside the serializable repository transaction before `OrderCheckout` insertion. Invalid or concurrent-invalid requests persist zero checkout rows.
- `PaymentOrchestrationService` reuses `BoldPaymentProvider`; random token material is hashed and discarded, and plaintext tokens or provider URLs are never stored. A stateless HMAC reference binds the high-entropy `PaymentLink.id` and exact expiry so an active link replay returns the same usable 2X1-owned path.
- Public lookup requires a valid signature, exact database expiry, active/opened state, and no revocation. Wrong, tampered, expired, revoked, or cross-bound references fail closed.
- Verified Bold events require signature, raw body, provider reference/payment identity, merchant hash, exact amount and COP currency. Duplicate events replay deterministically.
- `UNKNOWN_RESULT` blocks blind retry. Multiple successful intents or payment after terminal checkout require financial review.
- `CheckoutPolicyService` is the sole kitchen eligibility authority: verified online success, explicit COD, or explicit pay-at-pickup.
- `OrdersService.createFromCanonicalCheckout` creates one structured ticket under test-only gates and persists modifier JSON; it does not decrement inventory.
- Existing authoritative sale checkout performs stock/cash mutation only at actual sale close. A verified canonical online intent is linked internally to its `SalePayment`; no client DTO controls that binding.
- The owned `/pagos/[token]` frontend first resolves the canonical endpoint and retains legacy compatibility. Canonical provider start remains blocked outside explicitly authorized tests.

Production flags remain false. Phase 2 operational handlers remain disabled. No production migration, deployment, Bold call, real WhatsApp send, automatic reply, order, sale, stock, or cash mutation was executed.
