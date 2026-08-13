# Phase 8 product architecture

Status: FROZEN for implementation at base `8baf7fd5bcc4a1ac8f7086cf1c022e5f8e3709e3`.

## Canonical authorities

| Concern | Authority |
| --- | --- |
| Customer and identity | `Customer`, `CustomerIdentity`, CRM services |
| Consent | `CustomerConsent` |
| Catalog, price, stock | Existing product/inventory domain services |
| Order and kitchen state | `OrderTicket` and `OrdersService` |
| Checkout and payment | `OrderCheckout`, `PaymentIntent`, canonical payment services |
| Delivery | `OrderTicket` delivery workflow and append-only delivery events |
| Customer recovery | `CustomerServiceCase` |
| Conversation and handoff | Sofia WhatsApp conversation services |
| CRM lead lifecycle | Phase 8 `CrmLead` plus append-only stage history |
| CRM work | Phase 8 `CrmTask`; follow-ups use `type=FOLLOW_UP` |
| CRM notes | Phase 8 append-only `CrmNote` |
| Presentation | Typed frontend contracts; never a transactional authority |

The unified customer timeline is a read model. It does not copy canonical domain state.

## Product shell

The authenticated product uses one application shell, one semantic token system, explicit route permissions and a shared typed query/error model. Unavailable, empty and zero are distinct states. Realtime uses the existing operational SSE stream where supported; all other refreshes are bounded and visibility-aware.

Primary modules: Overview, Sofia, CRM, Orders, Kitchen, Customers, Conversations, Payments, Delivery, Customer Service, Analytics, Audit, Team, Settings and Activation Control.

## Write ownership

| Owner | Exclusive write scope |
| --- | --- |
| Lead | root layouts, shell, tokens, global API/auth/RBAC, Prisma, migrations, shared contracts, integration |
| Design | `apps/web/src/components/ui/**` and new product-shell primitives |
| Overview | overview/dashboard/analytics routes and feature modules |
| Orders | orders/kitchen routes and read/policy UI; canonical mutations only |
| Customers | customers/conversations routes and feature modules |
| CRM | CRM backend repository/service/controller after migration, then CRM routes |
| Operations | payments/delivery/customer-service protected reads and routes |
| Governance | team/audit/settings/activation-control routes |
| Quality | tests, accessibility and performance fixes after integration |

Shared authoritative files are changed only by the lead.

## Migration 38

Migration `20260812130000_sofia_crm_product_core` is additive. It creates pipelines, stages, leads, lead stage evidence, tasks/follow-ups and notes. It adds no duplicated customer, order, payment, case or interaction authority and performs no historical backfill.
