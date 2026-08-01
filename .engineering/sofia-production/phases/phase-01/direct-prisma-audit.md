# Direct Prisma audit

## Summary

`20` non-test runtime files under `apps/api/src/modules/sofia` reference `PrismaService`, `this.prisma`, or transactions. Direct Prisma inside a dedicated persistence adapter is acceptable; direct Prisma from SOFIA controllers and orchestration is the Phase 1 boundary violation.

## Runtime files

| File | Current persistence concern | Phase 1 disposition |
| --- | --- | --- |
| `sofia.service.ts` | Conversations, messages, drafts, products, delivery orders, users | Split draft/conversation persistence from domain calls; remove product and operational-order access |
| `sofia-agent.service.ts` | Products, recipes, stock, drafts, messages, memory | Orchestrator must consume contracts only |
| `catalog/sofia-commercial-catalog.service.ts` | SOFIA catalog and `Product` joins | Retain SOFIA catalog repository; replace product access with `CatalogReadService` |
| `crm/sofia-crm.service.ts` | CRM aggregate persistence | Place behind `CustomerResolutionService`; do not expose Prisma entities |
| `sofia-payment-link.service.ts` | Orders, payment settings, webhooks, delivery payment state | Place reads behind `PaymentReadService`; mutation paths remain separately guarded |
| `sofia-whatsapp.service.ts` | Conversations, inbound/outbound messages, users | Introduce SOFIA-owned message repository; orchestration must not query Prisma |
| `memory/sofia-customer-memory.service.ts` | Customer memory | Introduce memory repository port |
| `memory/sofia-conversation-memory.service.ts` | Conversation memory | Introduce memory repository port |
| `prompt/sofia-prompt.service.ts` | Prompt versions | Introduce prompt repository port |
| `auto-safe/sofia-auto-safe-engine.service.ts` | Decision evidence | Keep behind decision-event repository |
| `alerts/sofia-alerts.service.ts` | Operational alerts | Consume an alert/audit application port |
| `governance/sofia-governance.service.ts` | Settings and aggregate metrics | Read repositories only; no domain mutation |
| `runtime-safety/sofia-runtime-safety.service.ts` | Settings, counters, blocked audit | Keep fail-closed through repository/audit ports |
| `metrics/sofia-metrics.service.ts` | Aggregate reads | Read-model repository |
| `learning/sofia-human-feedback.service.ts` | Audit-backed feedback | Dedicated repository or audit query port |
| `learning/sofia-learning.service.ts` | Audit/decision read models | Read-model repository |
| `retention/sofia-retention.service.ts` | Retention counts/deletes | Separate elevated maintenance adapter; not orchestration |
| `backups/sofia-backups.service.ts` | Settings and counts | Read/setting repository; remains dry-run only |
| `whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts` | QR events/settings/messages | Provider persistence adapter, isolated from agent |
| `sofia.controller.ts` | Injects `PrismaService` but does not use it | Remove unused injection during implementation |

## Operational bypasses requiring contracts

| File and symbol | Direct models | Existing authority bypassed | Required replacement |
| --- | --- | --- | --- |
| `SofiaAgentService.activeProducts` | `Product`, `Recipe`, `RecipeItem`, `Ingredient` | Products/recipes/inventory services | `CatalogReadService`, `ProductAvailabilityService`, `RecipeAvailabilityService` |
| `SofiaService.buildItemsSnapshot` | `Product` | Products service and authoritative price snapshot | `CatalogReadService.getProductsByIds` |
| `SofiaCommercialCatalogService.toSnapshot` | `Product` | Products service | `CatalogReadService.getProduct` |
| `SofiaCrmService.resolveOrCreateByPhone` | CRM customer models | No neutral customer application contract | `CustomerResolutionService` |
| `SofiaService.createDeliveryOrderFromDraft` | `WhatsappDeliveryOrder` | `OrdersService.create` | `OrderCreationService.createFromSofiaDraft` |
| `SofiaPaymentLinkService.findSofiaDeliveryOrderByOrderTicket` | `OrderTicket`, payment models | Orders/payment read boundaries | `PaymentReadService` plus order projection |

## Critical conversion trace

| Field | Evidence |
| --- | --- |
| Caller | `SofiaAgentService.processInboundMessage`, confirmation branch at `apps/api/src/modules/sofia/sofia-agent.service.ts:713` |
| Draft confirmation | `SofiaService.confirmDraft` updates only `SofiaOrderDraft.status` at `apps/api/src/modules/sofia/sofia.service.ts:911` |
| Database write | `tx.whatsappDeliveryOrder.create` at `apps/api/src/modules/sofia/sofia.service.ts:1012` |
| Missing link | `orderTicketId: null` at `apps/api/src/modules/sofia/sofia.service.ts:1016` |
| Missing authority | No `OrdersService` dependency in either SOFIA service constructor |
| Current side effects | Draft confirmation audit; delivery-order audit; optional customer-memory update; no cash-session binding, operational alert, realtime order, or order number |
| Current production behavior | Fail-closed before the write unless `NODE_ENV=test` |
| Required Phase 1 contract | Supervised and idempotent `OrderCreationService.createFromSofiaDraft`, internally delegating to order authority and atomically linking draft, delivery order, and `OrderTicket` |

## Idempotency gap

`AuditContextService` captures idempotency metadata and WhatsApp/payment integrations use unique keys, but there is no reusable idempotency result store for order commands. The string `sofia-draft-confirm:<draftId>` is currently used only when recording a blocked action. Phase 1 must define conflict-safe replay semantics before any operational conversion is enabled.
