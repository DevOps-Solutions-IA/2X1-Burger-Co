# Sale and cash impact

Migration 36 adds nullable unique `SalePayment.paymentIntentId`; historical rows remain null. Existing sale creation records `PAID`, inventory, and cash movements transactionally; existing order checkout remains the authority.

Required semantics:

- ONLINE: canonical order checkout accepts exactly one matching `SUCCEEDED` intent and links it internally to the resulting `SalePayment`;
- COD/PAY_AT_PICKUP: create/apply sale when an authorized operator records actual collection;
- order creation alone must not mutate cash;
- cash modes create no fake payment intent; preference changes occur through a newly confirmed commercial draft/checkout before execution.

No production sale or cash operation was executed. Phase 5 tests use an isolated database and explicit test-only gates.
