# Bold integration audit

`BoldPaymentProvider` implements link creation, status lookup, webhook parsing and signature verification (`apps/api/src/modules/sofia/payments/bold-payment.provider.ts:20-171`). It uses a sanitized order reference as the provider idempotency key and HMAC-SHA256 over the base64 raw body. The executable provider contract, not documentation, is the current evidence.

Before any production enablement:

- confirm the signature algorithm and header against the current official Bold contract;
- restrict production `BOLD_BASE_URL` to the approved production hostname (the current config accepts any valid URL);
- bind and validate the expected Bold merchant/account identity;
- keep all credentials outside Git and fail closed when absent.

Bold production remains off. No sandbox credential was read, printed or committed during this audit.
