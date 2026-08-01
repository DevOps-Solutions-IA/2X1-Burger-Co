# Phase 1 domain map

| Domain | Controller | Authoritative service and method | DTO / input | Prisma models | Current SOFIA call path | Direct Prisma usage | Missing contract | Risk | Phase 1 action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Products | `ProductsController` | `ProductsService.findSellable`, `findOne` | Product ID, optional brand | `Product`, `Category`, `Unit` | `SofiaAgentService.activeProducts`; `SofiaService.buildItemsSnapshot` | `product.findMany/findUnique` | `CatalogReadService` | Catalog rules and active-product rules can diverge | Adapt `ProductsService`; return sanitized catalog DTOs |
| Prices | `ProductsController` | Persisted `Product.salePrice` through `ProductsService` | Product IDs | `Product` | Agent and draft service read `salePrice` directly | `product.findMany/findUnique` | `CatalogReadService` price snapshot | Caller-provided order `unitPrice` could bypass authority | SOFIA order command omits `unitPrice`; adapter resolves current price |
| Categories | `CategoriesController` | `CategoriesService.findAll` | None | `Category`, `Product` | Agent reads nested category directly | `product.findMany` | `CatalogReadService` category projection | Inconsistent category filters | Export active/sellable category projection |
| Recipes | `RecipesController` | `RecipesService.findByProduct` | Product ID | `Recipe`, `RecipeItem`, `Ingredient` | Agent embeds recipe query in `activeProducts` | nested `product.recipes` query | `RecipeAvailabilityService` | Recipe rules duplicated | Wrap recipe read and availability calculation |
| Ingredient availability | `IngredientsController`, `InventoryController` | `IngredientsService.findOne`; stock authority in `InventoryService` and `SalesService.createInTransaction` | Product ID and quantity | `Ingredient`, `Recipe`, `RecipeItem` | `SofiaAgentService.isAvailable` computes locally | nested ingredient stock query | `RecipeAvailabilityService` | Read result can race; formula can drift | Return advisory availability with timestamp; revalidate in order/sale transaction |
| Inventory | `InventoryController` | `InventoryService.findStock`, `findMovements`, `getReorderSuggestions` | Inventory query DTOs | `Product`, `Ingredient`, `InventoryMovement`, `StockCount` | Agent reads product/ingredient stock directly | direct stock reads | `ProductAvailabilityService` | SOFIA may advertise unavailable items | Add quantity-aware read facade; no stock mutation |
| Customers | `SofiaCrmController`; order customer endpoints | `SofiaCrmService.resolveOrCreateByPhone`; `OrdersService.findOrCreateCustomer` | `ResolveCustomerByPhoneDto` or delivery customer input | `Customer`, `CustomerIdentity`, `DeliveryCustomer`, consent/timeline models | Memory and CRM services query independently | direct customer and identity writes | `CustomerResolutionService` | Two customer identities can diverge | Resolve canonical CRM customer and linked delivery profile transactionally |
| Addresses | Order customer endpoints; `DeliveryLocationController` | `OrdersService.upsertDeliveryCustomer`; `DeliveryLocationService.resolve` | Address/location DTOs | `DeliveryCustomer`, `OrderTicket`, `DeliveryLocationInbox` | Draft stores free text; agent carries address string | draft and delivery customer direct access | `CustomerResolutionService` address projection | No normalized address entity; stale/default ambiguity | Return normalized address candidate without inventing a new model in discovery |
| Delivery pricing | `DeliveryPricingController` | `DeliveryPricingService.estimate` | `DeliveryPricingRequest` / `EstimateDeliveryPricingDto` | `DeliveryPricingAudit`, provider cache/usage, `OrderTicket` snapshot | Draft money defaults fee to zero; no quote call in conversion path | SOFIA draft stores fee directly | `DeliveryQuoteService` | Fake/zero fee or stale quote could reach a draft | Require quote result/audit ID; order creation recalculates or verifies |
| Order tickets | `OrdersController` | `OrdersService.create` | `CreateOrderTicketDto`, authenticated `AuthUser` | `OrderTicket`, `OrderTicketItem`, `CashSession`, delivery snapshot models | Agent calls only `SofiaService` draft/delivery methods | direct `WhatsappDeliveryOrder.create` | `OrderCreationService` | Critical: no guaranteed real `OrderTicket` | Add idempotent, supervised draft conversion using `OrdersService` authority |
| Sales | `SalesController` | `SalesService.create`, `createInTransaction` | `CreateSaleDto` | `Sale`, `SaleItem`, `SalePayment`, `InventoryMovement` | No supported SOFIA sale command | none in agent conversion | Read projection only for Phase 1 | Financial and stock mutation risk | Keep sales mutation outside Phase 1; expose no SOFIA write contract |
| Payments | `PaymentMethodsController`; public/payment webhook controllers | `PaymentMethodsService.findAll`; `SofiaPaymentLinkService.getOperationalLink/getPaymentSettings` | Order ticket ID or public token | `PaymentMethod`, `SofiaPaymentSettings`, `WhatsappDeliveryOrder`, payment event models | Agent requests link only if an `orderTicketId` exists | payment service reads/writes Prisma directly | `PaymentReadService` | Payment state could leak into orchestration | Read-only sanitized status/method contract; no payment mutation |
| Audit | `AuditController` | `AuditService.log` | `AuditInput`, request audit context | `AuditLog` | Services call `AuditService`, but some writes are outside the same transaction | `AuditService` owns Prisma as intended | `AuditCommandService` | Partial state/audit commit possible | Require transaction-capable audit command for every mutation |
| Idempotency | No dedicated controller/service | Integration-specific unique keys plus `AuditContextService` | Request/provider/draft keys | Unique message/payment fields; `AuditLog.idempotencyKey` | Agent records a hashed draft key only when blocked | scattered direct lookups/unique constraints | Cross-cutting requirement on mutation contracts | Duplicate order conversion | Define mandatory deterministic key and persisted result lookup for `OrderCreationService` |
| SOFIA draft conversion | `SofiaController` | Current `SofiaService.confirmDraft/createDeliveryOrderFromDraft`; target `OrdersService.create` adapter | `CreateSofiaOrderDraftDto`, draft ID, actor, idempotency key | `SofiaOrderDraft`, `WhatsappDeliveryOrder`, `OrderTicket` | `SofiaAgentService.processInboundMessage` | direct draft and delivery-order writes | `OrderDraftService`, `OrderCreationService` | Confirmed draft is not an operational order | Separate draft state from supervised idempotent conversion and link all three records atomically |

## Authoritative service references

- Catalog: `apps/api/src/modules/products/products.service.ts:11` and `apps/api/src/modules/categories/categories.service.ts:17`.
- Recipes: `apps/api/src/modules/recipes/recipes.service.ts:9`.
- Inventory: `apps/api/src/modules/inventory/inventory.service.ts:14`.
- Customers: `apps/api/src/modules/sofia/crm/sofia-crm.service.ts:40` and delivery-profile methods in `apps/api/src/modules/orders/orders.service.ts:4130`.
- Delivery quote: `apps/api/src/delivery/delivery-pricing/delivery-pricing.service.ts:9`.
- Orders: `apps/api/src/modules/orders/orders.service.ts:418`, especially `create` at line 1359.
- Sales/stock consumption: `apps/api/src/modules/sales/sales.service.ts:24`, especially `createInTransaction` at line 576.
- Payments: `apps/api/src/modules/payment-methods/payment-methods.service.ts:5` and `apps/api/src/modules/sofia/sofia-payment-link.service.ts:26`.
- Audit: `apps/api/src/modules/audit/audit.service.ts:22`.

## Implemented adapter map

| Contract | Concrete adapter | Authority delegated to | Operational mutation |
| --- | --- | --- | --- |
| `CatalogReadService` | `ProductsCatalogReadAdapter` | `ProductsService`, `CategoriesService` | None |
| `ProductAvailabilityService` | `DomainAvailabilityAdapter` | `ProductsService`, `InventoryService` | None; advisory |
| `RecipeAvailabilityService` | `DomainAvailabilityAdapter` | `RecipesService`, `IngredientsService` | None; advisory |
| `CustomerResolutionService` | `SofiaCustomerResolutionAdapter` | `SofiaCrmService` | CRM resolution only |
| `DeliveryQuoteService` | `AuthoritativeDeliveryQuoteAdapter` | `DeliveryPricingService` | Audited quote only |
| `OrderDraftService` | `SofiaOrderDraftAdapter` | `SofiaService` draft lifecycle | SOFIA draft only |
| `OrderCreationService` | `BlockedSofiaOrderCreationAdapter` | No operational authority injected | Always blocked |
| `PaymentReadService` | `SofiaPaymentReadAdapter` | `SofiaPaymentLinkService` | None; sanitized read |
| `AuditCommandService` | `AuthoritativeAuditCommandAdapter` | `AuditService` | Audit event only |

The critical gap remains intentionally non-operational: no `OrdersService.create` call exists yet, but the unsafe `WhatsappDeliveryOrder` bypass has been removed. A future implementation must first resolve the module ownership and persistent idempotency prerequisites under separate owner authorization.
