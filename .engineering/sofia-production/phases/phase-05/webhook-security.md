# Webhook security

Current strengths: missing/invalid signatures fail closed, raw payload is required, amount and COP currency are checked, and a signed approval still requires reconciliation rather than directly marking `PAID` (`sofia-payment-link.service.ts:774-847`).

Blocking gaps:

- order lookup uses `OR` across provider payment ID, provider reference and order reference (`:751-771`) instead of requiring all supplied identities to agree;
- expected merchant/account identity is not validated;
- deduplication performs read-before-insert (`:801-811`, `:863-881`), so concurrent duplicates can surface a unique error rather than a normalized idempotent result;
- `PaymentWebhookEvent.eventId` is globally unique rather than `(provider,eventId)` and has no payment-intent relation (`prisma/schema.prisma:1538-1561`);
- there is no exact active-attempt, cancelled-order or stale-attempt binding.

Only an authenticated provider event matching intent, order, merchant, amount, currency and valid state may establish authoritative online success. Customer text, screenshots and prompt output never may.
