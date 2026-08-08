# Payment preference

The new `SofiaPaymentPreference` records intent, not financial status: `UNKNOWN`, `ONLINE`, `CASH_ON_DELIVERY`, `PAY_AT_PICKUP`.

Phase 4 exposes only readiness: `PAYMENT_READY_ONLINE`, `PAYMENT_COD`, `PAYMENT_AT_PICKUP` or `PAYMENT_UNRESOLVED`. It creates no payment link, Bold request, charge, webhook mutation or PAID transition.
