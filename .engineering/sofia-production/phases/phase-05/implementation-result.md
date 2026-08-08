# Phase 05 implementation result

Status: `IMPLEMENTED_GATED_PENDING_PR_REVIEW`.

- Base SHA: `c079a0666297336609c0ef0486436371a8d8ec47`.
- Runtime SHA before evidence: `bb362fafa9c03e649ff8a979b531ffbd9e0e07fa`.
- Migration: `20260808180000_sofia_order_payment_kitchen_core`, additive, 36/36 on fresh PostgreSQL.
- Canonical persistence: `OrderCheckout`, `PaymentIntent`, `PaymentLink`, and append-only `PaymentTransition`.
- Confirmed Sofia drafts require exact draft ID/version/hash/confirmation/expiry binding. Scoped source idempotency and bounded serialization retries produce one logical checkout.
- `PaymentOrchestrationService` reuses `BoldPaymentProvider`; token hashes are persisted, plaintext tokens are returned once, and provider URLs are never stored in `PaymentLink`.
- Verified Bold events require signature, raw body, provider reference/payment identity, merchant hash, exact amount and COP currency. Duplicate events replay deterministically.
- `UNKNOWN_RESULT` blocks blind retry. Multiple successful intents or payment after terminal checkout require financial review.
- `CheckoutPolicyService` is the sole kitchen eligibility authority: verified online success, explicit COD, or explicit pay-at-pickup.
- `OrdersService.createFromCanonicalCheckout` creates one structured ticket under test-only gates and persists modifier JSON; it does not decrement inventory.
- Existing authoritative sale checkout performs stock/cash mutation only at actual sale close. A verified canonical online intent is linked internally to its `SalePayment`; no client DTO controls that binding.
- The owned `/pagos/[token]` frontend first resolves the canonical endpoint and retains legacy compatibility. Canonical provider start remains blocked outside explicitly authorized tests.

Production flags remain false. Phase 2 operational handlers remain disabled. No production migration, deployment, Bold call, real WhatsApp send, automatic reply, order, sale, stock, or cash mutation was executed.
