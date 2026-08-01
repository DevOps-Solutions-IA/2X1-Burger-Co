# Phase 1 contracts plan

These are application contracts, not alternate business logic. Concrete adapters must delegate to the verified domain services and persistence remains behind those services or dedicated repositories.

| Contract | Input DTO | Output DTO | Validation | Authorization context | Idempotency | Audit | Transaction boundary | Source attribution | Mode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CatalogReadService` | `CatalogQuery { productIds?, categoryIds?, brand?, activeOnly=true }` | `CatalogProduct[] { id, code, name, category, kind, persistedPrice, active, updatedAt }` | IDs/brand valid; active products only for SOFIA sale flow | Authenticated actor, location, roles | Not required | Optional read metric, no sensitive query text | Read-only snapshot | `PRODUCTS_SERVICE`, product update timestamp | Read-only |
| `ProductAvailabilityService` | `ProductAvailabilityQuery { productId, quantity, locationId? }` | `{ available, reasonCode, checkedAt, stockVersion? }` | Quantity positive; product active | Actor/location scope | Not required | Log blocked operational conversion, not every lookup | Consistent read; final order revalidates | `INVENTORY_SERVICE` | Read-only advisory |
| `RecipeAvailabilityService` | `RecipeAvailabilityQuery { productId, quantity, locationId? }` | `{ available, missingIngredients[], checkedAt }` | Prepared product and active recipe; positive yield | Actor/location scope | Not required | Block reason on conversion | Consistent recipe/ingredient read; final sale remains authoritative | `RECIPES_SERVICE` + `INVENTORY_SERVICE` | Read-only advisory |
| `CustomerResolutionService` | `ResolveCustomerCommand { normalizedPhone, displayName?, addressCandidate? }` | `{ customerId, deliveryCustomerId?, addressCandidate?, created, updatedAt }` | Normalize phone/name/address; consent boundaries | Authenticated human actor and source channel | Required for create/update using provider event or request key | Before/after identifiers, actor, source; no full phone in audit | One transaction for CRM identity and delivery-profile link | `SOFIA`, provider, conversation ID | Mutating |
| `DeliveryQuoteService` | `DeliveryQuoteCommand { destination, neighborhood?, subtotal, customerId?, requestedAt }` | `{ auditId, status, finalFee, currency, distanceKm, estimatedMinutes, reasonCode, calculationVersion, expiresAt? }` | Backend location, coverage and pricing validation | Actor/location and delivery quote permission | Required if quote is persisted/applied | Request/result sanitized through delivery pricing audit | Quote/audit transaction; order creation revalidates or links audit | `DELIVERY_PRICING_SERVICE` | Read with audited result |
| `OrderDraftService` | Create/update/confirm commands with draft ID, conversation ID, customer refs and product quantities only | Sanitized draft with authoritative item/price snapshots, status and missing fields | Products/prices via catalog contract; no caller total or fee authority | Human actor, roles, conversation scope | Required for create/update/confirm | Draft lifecycle events with before/after and request context | Draft write and audit in one transaction | `SOFIA_ADMIN` or supervised inbound | Mutating, non-operational |
| `OrderCreationService` | `CreateOrderFromSofiaDraftCommand { draftId, actor, idempotencyKey, expectedDraftVersion }` | `{ orderTicketId, orderNumber, deliveryOrderId, draftId, status, total, replayed }` | Confirmed non-mock draft; quote valid; authoritative prices; active cash session; allowed role; no client unit price | Full `AuthUser`, source, location, explicit confirmation/approval | Mandatory unique key scoped to draft; replay returns original result; competing key returns conflict | Attempt, policy decision, order create/link, replay/conflict | Single transaction for idempotency claim, `OrderTicket`, links and audit; post-commit realtime | `SOFIA_SUPERVISED` | Mutating, confirmation required |
| `PaymentReadService` | `PaymentReadQuery { orderTicketId, actor }` | Sanitized methods/link/status/expiry; no secret/provider payload | Order exists and actor may view; public token never returned internally unless required | Authenticated actor and payment read permission | Not required | Sensitive reads only when policy requires | Read-only | `PAYMENT_METHODS_SERVICE` / payment link service | Read-only |
| `AuditCommandService` | `AuditCommand { action, entity, result, before?, after?, metadata? }` plus request context | `{ auditEventId, timestamp }` | Identifier lengths, redaction, allowed metadata schema | Actor/request context mandatory for human mutations | Carries command idempotency key | It is the audit authority | Accepts domain transaction client so state and audit commit together | Caller module and release metadata | Mutating support contract |

## Standard errors

- `SOFIA_DOMAIN_FORBIDDEN`
- `SOFIA_DOMAIN_NOT_FOUND`
- `SOFIA_PRODUCT_UNAVAILABLE`
- `SOFIA_RECIPE_UNAVAILABLE`
- `SOFIA_DELIVERY_QUOTE_REQUIRED`
- `SOFIA_DELIVERY_QUOTE_EXPIRED`
- `SOFIA_DRAFT_VERSION_CONFLICT`
- `SOFIA_DRAFT_NOT_CONFIRMABLE`
- `SOFIA_ORDER_IDEMPOTENCY_CONFLICT`
- `SOFIA_ORDER_CREATION_BLOCKED`
- `SOFIA_PAYMENT_READ_FORBIDDEN`
- `SOFIA_DOMAIN_DEPENDENCY_UNAVAILABLE`

Errors returned to SOFIA must be structured and sanitized. Model text cannot turn an error into a successful operation.

## Module dependency plan

1. Define interfaces/tokens and DTOs in a neutral application layer, not inside the Prisma-backed SOFIA orchestration service.
2. Add adapters in the owning domain modules and export only contract tokens.
3. Break the current `OrdersModule -> SofiaModule` dependency by extracting the payment-link dependency into a narrower module or neutral port before adding `SofiaModule -> OrderCreationService`.
4. Keep SOFIA-owned persistence behind repositories for conversations, drafts, memory, prompts, governance, and messages.
5. Convert `SofiaAgentService` to depend exclusively on contracts and SOFIA-owned repositories.
6. Keep the Phase 0 production mutation block until the order command, approval, idempotency, audit, and regression tests all pass in a later authorized implementation step.

## Acceptance tests for implementation authorization

- Contract tests prove product and price responses match `ProductsService`.
- Availability reads match recipe/inventory data and are revalidated by the operational transaction.
- Delivery quote output matches `DeliveryPricingService.estimate`.
- Duplicate draft conversion creates exactly one `OrderTicket` and one linked `WhatsappDeliveryOrder`.
- Failed conversion leaves draft, order, delivery link, and audit in a consistent state.
- Mock-admin and sandbox drafts cannot create operational orders.
- SOFIA orchestration files contain no `PrismaService` dependency after migration to contracts/repositories.
