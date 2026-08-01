# SOFIA Phase 1 discovery

## Baseline

- Repository: `DevOps-Solutions-IA/2X1-Burger-Co`
- Branch: `feature/sofia-01-domain-contracts`
- Base: `6119b7a6d1c84948840a2603d8650126f2933f5d`
- Production executable observed: `105db5b1654947e0ff79b269028e7e98b6bf8c9e`
- Production migrations observed: `32/32`
- Initial scope: read-only code discovery and contract design. Implementation was subsequently authorized and is recorded in `implementation.md`.

## Verified architecture

The NestJS API is composed in `apps/api/src/app.module.ts`. Domain modules expose concrete services such as `ProductsService`, `RecipesService`, `InventoryService`, `OrdersService`, `SalesService`, `DeliveryPricingService`, and the global `AuditService`. `SofiaModule` is registered beside those modules but currently imports only `SofiaAutoSafeModule`; its orchestration services therefore query Prisma directly instead of consuming the domain services.

The most important module dependency constraint is circular: `OrdersModule` imports `SofiaModule` to consume `SofiaPaymentLinkService`, while `SofiaModule` does not import `OrdersModule`. Phase 1 cannot simply inject `OrdersService` into SOFIA without first extracting the payment-facing dependency or introducing a neutral application-contract module.

## Critical order gap

The confirmed path is:

1. `SofiaAgentService.processInboundMessage` in `apps/api/src/modules/sofia/sofia-agent.service.ts:527` builds or updates a `SofiaOrderDraft`.
2. Its confirmation branch at `apps/api/src/modules/sofia/sofia-agent.service.ts:713` calls `SofiaService.confirmDraft` and then `SofiaService.createDeliveryOrderFromDraft`.
3. `SofiaService.confirmDraft` in `apps/api/src/modules/sofia/sofia.service.ts:890` only changes `SofiaOrderDraft.status` to `CONFIRMED` and emits an audit event.
4. `SofiaService.createDeliveryOrderFromDraft` in `apps/api/src/modules/sofia/sofia.service.ts:994` is test-only after Phase 0, but its implementation writes `WhatsappDeliveryOrder` directly with `orderTicketId: null`.
5. No constructor dependency or call to `OrdersService.create` exists in `SofiaService` or `SofiaAgentService`.
6. The agent records `operationalOrderCreated: false` in customer memory at `apps/api/src/modules/sofia/sofia-agent.service.ts:747`, confirming the missing operational conversion.

Current production is fail-closed because `createDeliveryOrderFromDraft` rejects non-test execution with `SOFIA_PROD_DELIVERY_ORDER_CREATION_FORBIDDEN`. This is a safety control, not an order-creation implementation.

## Main findings

- `20` runtime files under `apps/api/src/modules/sofia` depend on Prisma directly.
- SOFIA reads products, persisted prices, recipes, and stock through private Prisma queries in `SofiaAgentService.activeProducts`, duplicating availability logic.
- `SofiaService.buildItemsSnapshot` correctly reads persisted product prices, but it bypasses `ProductsService` and has no reusable availability contract.
- `SofiaCommercialCatalogService` joins SOFIA catalog records to `Product` directly instead of using a catalog read boundary.
- `SofiaCrmService` is currently both SOFIA orchestration and the concrete customer persistence service. It can be reused behind `CustomerResolutionService`, but callers need an interface that does not expose Prisma entities.
- Delivery pricing has a reusable backend authority: `DeliveryPricingService.estimate` and `DeliveryPricingEngine.quote`.
- `OrdersService.create` is the operational command authority for cash-session binding, delivery snapshots, audit, alerts, and realtime publication. It does not currently expose an idempotent SOFIA conversion command.
- `OrdersService.buildOrderItems` accepts an optional caller-provided `unitPrice`; the SOFIA contract must omit that field and force authoritative persisted pricing.
- `SalesService.createInTransaction` is the stock-decrement authority at checkout. SOFIA must not duplicate its locking or stock mutation.
- There is no general-purpose idempotency command store. Idempotency is implemented per integration using unique keys and request audit context.
- There is no normalized `CustomerAddress` model. Delivery addresses are snapshots on `OrderTicket`, defaults on `DeliveryCustomer`, and text/location fields on drafts.

## Phase boundary

Phase 1 should introduce application contracts and adapters around existing authoritative services, plus a safe draft-to-order command. It must not enable real WhatsApp sending, autonomous confirmation, payment mutation, or Phase 2 behavior.

## Implementation outcome

The approved implementation preserves this boundary. Neutral contracts now own catalog, availability, customer resolution, delivery quote, draft, blocked order creation, payment read, and audit command DTOs. The unsafe draft conversion was removed from runtime reachability and replaced by a blocked adapter. No operational order, payment, stock, cash, or outbound-message mutation was enabled.
