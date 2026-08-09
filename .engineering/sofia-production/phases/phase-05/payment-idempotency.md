# Payment idempotency

Secure Command provides scoped idempotency and leases (`prisma/schema.prisma:1907-1947`; `secure-command.service.ts:57-140`), but it is not a financial ledger. Its `UNKNOWN_RESULT` class belongs to command execution, not a durable payment attempt.

Phase 5 implementation:

- `@@unique([source,idempotencyKey])` plus exact Sofia binding gives one checkout;
- serializable transactions, row locks, scoped uniqueness and bounded retry handle concurrent creation;
- active intent/link requests replay without another plaintext token or provider call;
- `PaymentTransition` is append-only and unique per intent/idempotency key;
- webhook identity is unique per `(provider,eventId)` and transition replay is deterministic;
- provider timeout persists terminal `UNKNOWN_RESULT`, never blind-retried;
- multiple success routes to `FINANCIAL_REVIEW_REQUIRED`; no automatic refund exists.
