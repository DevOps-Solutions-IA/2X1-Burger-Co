# Phase 8 authenticated route audit

Phase 8 covers the complete authenticated operational frontend. `REFACTOR` and
`REDESIGN` both require the shared enterprise tokens, interaction states,
responsive behavior and accessibility contract; neither classification permits
an existing page to remain untouched.

## Exhaustive route matrix

| Route | Classification | Phase 8 disposition |
| --- | --- | --- |
| `/` | KEEP | Public entry redirect to `/login`; authentication is resolved by the login flow. |
| `/login` | REFACTOR | Shared enterprise authentication surface. |
| `/delivery/login` | REFACTOR | Field login using the same tokens and accessible controls. |
| `/waiter/login` | REFACTOR | Field login using the same tokens and accessible controls. |
| `/dashboard` | MERGE | Compatibility alias for canonical `/overview`; it renders the same read model and marks Overview active. |
| `/overview` | BUILD_NEW | Canonical enterprise operational overview. |
| `/pos` | REFACTOR | Preserve POS authority and mutations; replace legacy chrome and states. |
| `/tables` | REFACTOR | Preserve table/order authority; unify responsive operational UX. |
| `/cash` | REFACTOR | Preserve cash authority; unify evidence, forms and failure states. |
| `/inventory` | REFACTOR | Preserve inventory authority; unify filters, table and state contracts. |
| `/purchases` | REFACTOR | Preserve purchase authority; unify governed forms and evidence. |
| `/expenses` | REFACTOR | Preserve expense authority; unify governed forms and evidence. |
| `/suppliers` | REFACTOR | Preserve supplier authority; unify directory UX. |
| `/products` | REFACTOR | Preserve catalog authority; unify product operations. |
| `/ingredients` | REFACTOR | Preserve ingredient authority; unify stock/accessibility UX. |
| `/categories` | REFACTOR | Preserve category authority; unify catalog UX. |
| `/recipes` | REFACTOR | Preserve recipe authority; unify recipe UX. |
| `/reports` | REDESIGN | Real operational reporting with no fabricated KPI. |
| `/deliveries` | REDESIGN | Canonical supervisor delivery control surface. |
| `/delivery` | REFACTOR | Dedicated rider shell and workflow; not a delivery-state authority. |
| `/waiter` | REFACTOR | Dedicated high-density waiter shell and workflow. |
| `/settings` | REDESIGN | Governed runtime settings with fail-closed states. |
| `/sofia` | REDESIGN | Supervised conversational operations. |
| `/sofia/conversations` | MERGE | Permission-checked compatibility redirect to `/conversations`. |
| `/sofia/customers` | MERGE | Permission-checked compatibility redirect to `/customers`. |
| `/sofia/customers/[customerId]` | MERGE | Compatibility redirect preserving identity to `/customers/[customerId]`. |
| `/sofia/whatsapp-qr` | MERGE | Compatibility redirect to `/activation-control`. |
| `/users` | MERGE | Compatibility redirect to `/team`. |
| `/orders` | BUILD_NEW | Canonical real order list and filters. |
| `/orders/[id]` | BUILD_NEW | Canonical order detail, totals, evidence and timeline. |
| `/kitchen` | BUILD_NEW | Governed kitchen queue over canonical order transitions. |
| `/customers` | BUILD_NEW | Protected customer directory. |
| `/customers/[customerId]` | BUILD_NEW | Customer 360 over canonical relations and unified timeline. |
| `/conversations` | BUILD_NEW | Receive-only aware conversation operations. |
| `/conversations/[conversationId]` | BUILD_NEW | Exact sanitized conversation detail and handoff. |
| `/payments` | BUILD_NEW | Payment intent/transition evidence; `UNKNOWN_RESULT` is never success. |
| `/customer-service` | BUILD_NEW | Versioned service cases and recovery evidence. |
| `/crm` | BUILD_NEW | CRM overview over real aggregate totals. |
| `/crm/leads` | BUILD_NEW | Governed lead list and transitions. |
| `/crm/pipelines` | BUILD_NEW | Canonical pipelines and stages. |
| `/crm/tasks` | BUILD_NEW | Governed tasks and follow-ups. |
| `/crm/follow-ups` | BUILD_NEW | Follow-up task projection. |
| `/crm/segments` | BUILD_NEW | Real segment definitions and counts. |
| `/crm/activity` | BUILD_NEW | Unified CRM activity timeline. |
| `/crm/recovery` | BUILD_NEW | Recovery/customer-service projection without invented compensation. |
| `/analytics` | BUILD_NEW | Domain-backed analytics only. |
| `/audit` | BUILD_NEW | Sanitized operational audit evidence. |
| `/team` | BUILD_NEW | Users, roles and permission-aware administration. |
| `/activation-control` | BUILD_NEW | Safe provider, kill-switch and activation status without secrets. |
| `/pagos/[token]` | KEEP | Public customer payment surface; outside the authenticated redesign, retained for functional/security compatibility. |
| `/version` | KEEP | Public technical release metadata handler; no visual surface. |

`REMOVE`: none in Phase 8. Compatibility aliases remain until production parity
is proven and bookmarks/operators have migrated.

## Shared surfaces

- `/(app)/layout` and `AppShell`: `REDESIGN`; one navigation, search, alerts,
  loading, empty, error and permission contract for every authenticated desktop
  module.
- `/(delivery)/layout`: `REFACTOR`; dedicated field navigation with shared
  tokens, valid skip target, desktop scroll and role-aware access.
- `/(waiter)/layout`: `REFACTOR`; dedicated field navigation with shared tokens,
  valid skip target and desktop scroll.
- Root layout: `REFACTOR`; global providers and tokens only. Each operational
  shell owns exactly one valid skip link for its own main landmark.
- CRM layout and module tabs: `BUILD_NEW`; one bounded sub-navigation using the
  shared route-policy and responsive contracts.
- `QueryState`, loading, error and permission surfaces: `REDESIGN`; live-region,
  retry, fail-closed and focus-management behavior is shared by every module.
- Tables, filters, forms, dialogs, drawers and status badges: `REFACTOR`; shared
  tokens, accessible names, bounded rendering and canonical status semantics.

Public storefront and marketing surfaces do not exist in this app tree. The
public payment route remains explicitly out of visual scope.
