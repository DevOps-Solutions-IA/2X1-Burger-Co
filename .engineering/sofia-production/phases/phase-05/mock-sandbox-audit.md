# Mock and sandbox audit

`PaymentProviderFactory` rejects MOCK outside tests and only permits settings-based mock outside production (`apps/api/src/modules/sofia/payments/payment-provider.factory.ts:16-40`). Mock webhook entry is test-guarded. Runtime safety keeps productive actions disabled.

The canonical module imports only `BoldPaymentProvider`; it has no provider factory, mock adapter, sandbox route, or fallback. Production env validation rejects mock WhatsApp, all Phase 5 operational flags, and any non-official Bold endpoint. The exact official Bold hostname is required over HTTPS without embedded credentials or custom port.

Production-reachable mock payment success: 0. Production-reachable sandbox payment: 0. Production-reachable test webhook: 0.
