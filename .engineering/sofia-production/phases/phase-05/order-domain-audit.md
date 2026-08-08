# Order domain audit

`SofiaOrderDraft` already retains version, draft hash, expiry, confirmation hash, immutable item snapshot and quoted totals (`prisma/schema.prisma:1082-1126`). Confirmation uses compare-and-set over ID, version, hash, state and expiry (`apps/api/src/modules/sofia/commercial/persistence/prisma-commercial.repository.ts:69-75`), with the confirmation hash bound by the checkout service (`commercial-checkout.service.ts:246-273`).

The order creation contract is intentionally non-operational (`Promise<never>`) in `sofia-domain-contracts.ts:134-141`; its adapter only audits and rejects (`sofia-contract.adapters.ts:69-91`). `OrdersService.create` is the current `OrderTicket` authority (`orders.service.ts:1359-1506`) and requires an open cash session. It cannot be called directly from Sofia without violating the required channel-independent boundary, and `OrdersModule` currently depends on `SofiaModule`, so reversing that dependency would create a cycle.

Required capability: a canonical `OrderCheckoutOrchestrator` owned by the order/payment domain. Sofia, POS, domicilios and authorized operators must submit the same immutable checkout command. A confirmed draft/version/hash and source idempotency key must resolve to one checkout and at most one `OrderTicket`.
