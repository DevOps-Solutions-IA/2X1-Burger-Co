# Webhook security

Current strengths: missing/invalid signatures fail closed, raw payload is required, amount and COP currency are checked, and a signed approval still requires reconciliation rather than directly marking `PAID` (`sofia-payment-link.service.ts:774-847`).

Phase 5 canonical remediation:

- all supplied provider payment/reference identities are combined with `AND`; ambiguous or unknown matches fail closed;
- expected merchant identity is stored and compared only as SHA-256 hash;
- scoped event uniqueness and transition idempotency normalize sequential/concurrent replay;
- `PaymentWebhookEvent` binds nullable intent, payload hash, account hash, and `(provider,eventId)` uniqueness;
- amount, currency, account, terminal checkout, lifecycle version, unknown result, and double success are explicitly classified.

Only an authenticated provider event matching intent, order, merchant, amount, currency and valid state may establish authoritative online success. Customer text, screenshots and prompt output never may.
