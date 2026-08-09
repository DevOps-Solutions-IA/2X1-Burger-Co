# Phase 05 final review correction

Reviewed head: `5b1a21aca0af9ccbc9339251a34b87dc45c82751`.

Corrected runtime head: `f0c68558608d2f1d0c49d47c0a4da2ae27da3714`.

## Checkout mutation ordering

`assertCheckoutPaymentCombination` is the single pure combination policy. The Prisma persistence adapter calls it inside the serializable transaction after exact confirmed-draft binding and before snapshot construction or `OrderCheckout` insertion. The service no longer validates after mutation.

PostgreSQL tests prove unsupported delivery/pickup combinations, unknown payment preference and concurrent invalid requests leave the checkout count unchanged at zero.

## Recoverable public payment path

The application issues a deterministic stateless HMAC reference containing only the high-entropy payment-link identifier and exact expiry. The signature is domain-separated and uses the existing validated server secret; no new provider or secret stack was introduced.

Resolution requires:

- a valid canonical signature;
- exact signed/database expiry binding;
- an existing `PaymentLink` in `ACTIVE` or `OPENED` state;
- no revocation and a future expiry;
- the existing relation from link to intent and checkout.

The persisted `tokenHash` remains random and one-way for schema compatibility. Neither plaintext token material nor provider checkout URL is persisted. Replayed and concurrent create-link calls return the same owned `/pagos/<signed-reference>` path without calling Bold.

## Safety

Migration count remains 36/36 and migration 36 is unchanged. Production Phase 5 flags, real Bold and WhatsApp auto reply remain disabled. No production deployment or production data mutation occurred.
