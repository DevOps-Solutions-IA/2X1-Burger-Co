# Sale and cash impact

`Sale.orderTicketId` is unique, while `SalePayment` has no provider transaction or payment-intent identity (`prisma/schema.prisma:691-780`). Existing sale creation records `PAID` and creates cash movements transactionally; existing order checkout converts an order to a sale and marks it paid in one transaction (`orders.service.ts:2797-2860`). Digital reconciliation is separated from physical cash.

Required semantics:

- ONLINE: create/apply the authoritative sale only after verified webhook and financial application;
- COD/PAY_AT_PICKUP: create/apply sale when an authorized operator records actual collection;
- order creation alone must not mutate cash;
- switching a payment preference to online must reuse the same order.
