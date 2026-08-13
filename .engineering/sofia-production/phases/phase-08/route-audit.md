# Phase 8 route audit

## Keep

`/` remains an authenticated redirect boundary.

## Refactor without behavior replacement

`/login`, `/delivery/login`, `/waiter/login`, `/pos`, `/tables`, `/cash`, `/inventory`, `/purchases`, `/expenses`, `/suppliers`, `/products`, `/ingredients`, `/categories`, `/recipes`, `/delivery`, `/waiter`.

Every authenticated route in this list is mandatory Phase 8 scope. `REFACTOR` means preserve domain behavior while replacing inconsistent page chrome, controls, states, responsiveness and accessibility with the shared enterprise system; it does not mean defer or leave untouched.

## Redesign

`/dashboard`, `/deliveries`, `/reports`, `/settings`, `/sofia` and the authenticated shell.

## Merge through compatible routes

- `/users` into `/team`.
- `/sofia/conversations` into `/conversations`.
- `/sofia/customers` into `/customers` and Customer 360.
- `/sofia/whatsapp-qr` into `/activation-control`.

Existing routes remain available until parity is proven.

## Build

`/overview`, `/orders`, `/orders/[id]`, `/kitchen`, `/customers`, `/customers/[customerId]`, `/conversations`, `/conversations/[conversationId]`, `/payments`, `/customer-service`, `/crm`, `/crm/leads`, `/crm/pipelines`, `/crm/tasks`, `/crm/follow-ups`, `/crm/segments`, `/crm/activity`, `/crm/recovery`, `/analytics`, `/audit`, `/team`, `/activation-control` and RBAC-aware global search.

## Remove after compatibility window

No authenticated route is removed in Phase 8. The merged aliases remain as permission-checked redirects until their canonical replacements have production parity evidence.

## Public routes outside the transformation

`/pagos/[token]` is a public customer payment surface, not part of the authenticated operational application. Phase 8 preserves its functional and security compatibility but does not redesign it. Public storefront and marketing routes are likewise out of scope.

## Layouts and shared surfaces

`/(app)/layout` and its navigation, search, alerts, loading, empty, error and permission states are `REDESIGN`. `/(delivery)/layout` and `/(waiter)/layout` are `REFACTOR` for the same token, accessibility and responsive contracts while retaining their distinct field-operation navigation.
