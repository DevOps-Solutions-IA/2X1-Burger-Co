# Payment idempotency

Secure Command provides scoped idempotency and leases (`prisma/schema.prisma:1907-1947`; `secure-command.service.ts:57-140`), but it is not a financial ledger. Its `UNKNOWN_RESULT` class belongs to command execution, not a durable payment attempt.

Phase 5 requires:

- one checkout for a source idempotency key and confirmed draft binding;
- one active intent/link reused for duplicate link requests when still valid;
- one append-only financial transition per provider event;
- database-enforced one-winner handling for concurrent webhooks;
- durable `UNKNOWN_RESULT` on timeout, with no blind charge retry;
- `FINANCIAL_REVIEW_REQUIRED` when multiple successful transactions target one order;
- no automatic refund absent an existing audited policy.
