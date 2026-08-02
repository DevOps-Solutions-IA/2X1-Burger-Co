# Phase 1 risk register

| ID | Risk | Evidence | Severity | Control / Phase 1 decision |
| --- | --- | --- | --- | --- |
| P1-01 | Confirmed draft lacks real operational order | `SofiaService.createDeliveryOrderFromDraft` writes `orderTicketId: null` | Critical | Add supervised idempotent `OrderCreationService`; retain production block until verified |
| P1-02 | Circular module dependency | `OrdersModule` imports full `SofiaModule` for payment links | High | Extract narrow payment port/module before SOFIA consumes order command |
| P1-03 | Catalog and availability rules drift | Agent duplicates product, recipe and ingredient queries/calculation | High | Delegate reads to catalog/availability contracts |
| P1-04 | Untrusted order price | `CreateOrderTicketDto` allows optional `unitPrice`; `OrdersService.buildOrderItems` accepts it | Critical | SOFIA command never accepts price; adapter resolves persisted price |
| P1-05 | Delivery fee defaults to zero in draft | `SofiaService.draftMoney` defaults delivery fee to `0` | Critical | Require valid backend quote for operational delivery conversion; free zone must be explicit rule |
| P1-06 | Duplicate order on replay/concurrency | No order-command idempotency result store | Critical | Persist deterministic draft conversion key and original result in transaction |
| P1-07 | Audit commits outside state transaction | Several SOFIA methods write state then call audit | High | `AuditCommandService` accepts transaction client; enforce atomic audit for mutations |
| P1-08 | Customer identity divergence | CRM `Customer` and `DeliveryCustomer` resolution are separate | High | Customer resolution contract links canonical records transactionally |
| P1-09 | No normalized address aggregate | Address exists as draft text, delivery customer default and order snapshot | Medium | Contract returns normalized candidate; do not create schema without separate approval |
| P1-10 | Availability race | Agent availability is an advisory read before order/sale transaction | High | Mark read as advisory and revalidate in authoritative transaction |
| P1-11 | Payment orchestration bypass | Payment service reads and mutates Prisma directly | High | Phase 1 exposes read-only payment port; mutation remains separately guarded |
| P1-12 | Broad Prisma coupling | 20 runtime SOFIA files reference Prisma | High | Incrementally introduce repositories for SOFIA-owned state and contracts for external domains |
| P1-13 | Phase 0 safety regression | Enabling conversion could bypass production block | Critical | Do not remove `SOFIA_PROD_DELIVERY_ORDER_CREATION_FORBIDDEN` until gated implementation tests and owner authorization |
| P1-14 | Scope expansion into sales/payments/WhatsApp | Existing services are adjacent to order conversion | Critical | Phase 1 planning only; no real send, payment mutation, sale creation, or autonomous confirmation |

## Blockers for implementation

No discovery blocker exists. Implementation requires owner approval of:

1. The module-cycle resolution strategy.
2. The persistent idempotency strategy for draft conversion.
3. Whether customer/address normalization needs a schema change; no migration is authorized by this discovery.
4. The exact human approval and role policy for `OrderCreationService`.

## Phase 1 closure

- P1-01/P1-13: controlled by the blocked `OrderCreationService`; no delivery-order or order-ticket write remains reachable from agent confirmation.
- P1-02: no new cycle; a real order adapter remains blocked until the pre-existing dependency is extracted.
- P1-03/P1-04: catalog and draft snapshots use persisted prices through the neutral catalog contract.
- P1-05/P1-06: remain prerequisites for a later operational conversion; they cannot affect production because creation is blocked.
- P1-07: neutral audit command supports an opaque existing transaction context without exposing Prisma across the boundary.
- P1-10: availability DTOs are explicitly advisory; checkout/sales authority is unchanged.
- P1-11/P1-14: payment is read-only and sanitized; real send/payment/order operations remain disabled.

No Phase 1 release blocker remains. These residual risks block operational order enablement, not the contract-only architecture delivered here.
