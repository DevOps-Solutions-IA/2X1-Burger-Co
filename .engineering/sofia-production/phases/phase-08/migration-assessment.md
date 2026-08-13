# Phase 8 migration assessment

Migration `20260812130000_sofia_crm_product_core` is the single authorized Phase 8 migration and advances the frontier from 37 to 38.

It is additive: new enums and the canonical pipeline, stage, lead, stage-history, task/follow-up and note tables. It performs no update, delete, backfill, table drop or business-column drop. Existing customer, order, payment, conversation and customer-service authorities are referenced rather than duplicated.

Safety invariants include source-scoped idempotency, optimistic versions, append-only lead transition evidence, restrictive historical relations and a composite foreign key binding each lead stage to its own pipeline.

Verified locally:

- Fresh PostgreSQL: `38/38`, zero incomplete or rolled-back migrations.
- Representative legacy PostgreSQL: `37 -> 38` PASS.
- Existing users, customers, tags and assignments preserved.
- Cross-pipeline stage binding rejected by PostgreSQL.
- Ephemeral database removed after validation.

Production migration is not represented as complete by this document.
