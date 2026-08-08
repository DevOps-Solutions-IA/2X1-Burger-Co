# Mock and sandbox audit

`PaymentProviderFactory` rejects MOCK outside tests and only permits settings-based mock outside production (`apps/api/src/modules/sofia/payments/payment-provider.factory.ts:16-40`). Mock webhook entry is test-guarded. Runtime safety keeps productive actions disabled.

Production-reachable mock payment success: 0 under current gates. Production-reachable test webhook: 0. A remaining Phase 5 requirement is an explicit production hostname allowlist so `BOLD_BASE_URL` cannot point to a sandbox despite selecting provider `BOLD`.
