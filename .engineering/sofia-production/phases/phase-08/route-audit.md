# Phase 8 route audit

## Keep

`/` remains an authenticated redirect boundary.

## Refactor without behavior replacement

`/login`, `/delivery/login`, `/waiter/login`, `/pagos/[token]`, `/pos`, `/tables`, `/cash`, `/inventory`, `/purchases`, `/expenses`, `/suppliers`, `/products`, `/ingredients`, `/categories`, `/recipes`, `/delivery`, `/waiter`.

## Redesign

`/dashboard`, `/deliveries`, `/reports`, `/settings`, `/sofia` and the authenticated shell.

## Merge through compatible routes

- `/users` into `/team`.
- `/sofia/conversations` into `/conversations`.
- `/sofia/customers` into `/customers` and Customer 360.
- `/sofia/whatsapp-qr` into `/activation-control`.

Existing routes remain available until parity is proven.

## Build

`/orders`, `/kitchen`, `/customers`, `/conversations`, `/payments`, `/customer-service`, `/crm`, CRM subroutes, `/analytics`, `/audit`, `/team`, `/activation-control` and RBAC-aware global search.
