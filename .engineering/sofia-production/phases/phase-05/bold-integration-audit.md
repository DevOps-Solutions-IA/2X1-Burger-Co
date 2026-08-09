# Bold integration audit

`BoldPaymentProvider` implements link creation, status lookup, webhook parsing and signature verification (`apps/api/src/modules/sofia/payments/bold-payment.provider.ts:20-171`). It uses a sanitized order reference as the provider idempotency key and HMAC-SHA256 over the base64 raw body. The executable provider contract, not documentation, is the current evidence.

Phase 5 reuses this provider directly; no second Bold stack was introduced. Before any future production enablement:

- confirm the signature algorithm and header against the current official Bold contract;
- production configuration now rejects any `BOLD_BASE_URL` that is not HTTPS on exact host `integrations.api.bold.co`, or that embeds credentials/uses a custom port;
- bind and validate the expected Bold merchant/account identity;
- keep all credentials outside Git and fail closed when absent.

The canonical module has no mock/sandbox fallback. Bold production remains off. No sandbox or production credential was read, printed or committed.
