# Phase 5 migration 36 result

## Scope

- Migration: `20260808180000_sofia_order_payment_kitchen_core`
- Character: additive except for the explicitly authorized replacement of global `event_id` uniqueness with provider-scoped uniqueness.
- Historical migrations modified: 0.
- Production migration applied: no.

## Read-only production preflight

Executed on 2026-08-08 inside a read-only transaction against the current production database.

| Check | Result |
| --- | ---: |
| Payment webhook rows | 28 |
| Global duplicate `event_id` groups | 0 |
| Global duplicate extra rows | 0 |
| Duplicate `(provider,event_id)` groups | 0 |
| Scoped duplicate extra rows | 0 |
| Null `event_id` | 4 |
| Provider trim mismatches | 0 |
| Provider casing mismatches | 0 |
| Blank provider values | 0 |
| Malformed provider values | 0 |
| Distinct provider values | 2 |
| `BOLD` rows | 4 |
| `MOCK` rows | 24 |

The historical `MOCK` rows were not changed or removed. The migration contains a fail-closed scoped-collision guard before replacing the index.

## Fresh database

- PostgreSQL: 16 Alpine, isolated disposable container.
- Migrations discovered/applied: 36/36.
- New canonical tables: `order_checkouts`, `payment_intents`, `payment_links`, `payment_transitions`.
- Prisma format: PASS.
- Prisma validate: PASS.
- Prisma client generation: PASS.

Scoped webhook uniqueness contract:

- duplicate `BOLD/abc`: rejected;
- `BOLD/abc` plus `OTHER/abc`: accepted;
- multiple null `event_id` rows: accepted.

## Legacy compatibility

The current production database was streamed read-only into an isolated PostgreSQL container without creating a plaintext dump. It started at 33 migrations, then migrations 34, 35 and 36 were applied.

| Record type | Before | After |
| --- | ---: | ---: |
| Order tickets | 1211 | 1211 |
| Sales | 827 | 827 |
| Sale payments | 827 | 827 |
| WhatsApp delivery orders | 103 | 103 |
| Payment webhook events | 28 | 28 |
| SOFIA drafts | 112 | 112 |

- Final migration count: 36/36.
- Historical order item modifier defaults: 1861/1861 equal `[]`.
- Historical sale payment intent bindings: 827/827 null.
- Historical webhook intent/hash/account bindings: 28/28 null.
- Temporary containers: removed.
- Production writes: 0.

## DDL audit

- New enum types: 5.
- New tables: 4.
- Business table/column drops: 0.
- Deletes, truncates, backfills or financial rewrites: 0.
- Approved index replacement: 1.
- New migration directories: 1.

## Decision

`PREFLIGHT=PASS`, `PRISMA=PASS`, `MIGRATIONS=36/36`, `LEGACY_COMPATIBILITY=PASS`. Runtime implementation may proceed under owner authorization; production migration and deployment remain prohibited.
