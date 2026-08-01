# Pending Migration Preconditions

Production schema equals the reconstructed 29 frontier, so all preconditions
were evaluated against an exact structural equivalent without executing SQL in
production.

| Migration / operation | Current state | Classification | Lock/risk | Required action |
| --- | --- | --- | --- | --- |
| `20260714220000_persistent_audit_contract_v2`: add 19 audit columns | columns absent; table exists with 8,843 rows | SAFE_TO_EXECUTE | medium; AccessExclusive, defaults may touch metadata/data | maintenance window and lock monitoring |
| same: create 8 audit indexes | indexes absent; audit table about 12.9 MB | SAFE_TO_EXECUTE | medium; non-concurrent index builds | bounded window, abort on lock wait |
| `20260727130000_sofia_crm_bounded_context`: create 10 enums/tables | all objects absent | SAFE_TO_EXECUTE | low | normal deploy transaction |
| same: add three nullable `customer_id` columns | all absent; source tables exist | SAFE_TO_EXECUTE | low/medium table locks | normal deploy transaction |
| same: create indexes and foreign keys | targets absent; new link columns are nullable | SAFE_TO_EXECUTE | medium validation locks | monitor lock duration |
| `20260727133000_sofia_payment_webhook_fail_closed`: defaults | current defaults are permissive | SAFE_TO_EXECUTE | low | apply fail-closed defaults |
| same: data updates | one settings row currently unsafe | SAFE_TO_EXECUTE | low row lock; intentional safety transition | verify resulting row is fail-closed |

Detection summary: 71 SQL statements; zero `DROP TABLE`, `DROP COLUMN`, type
replacement, or `SET NOT NULL` operations. No statement is already satisfied,
would conflict, or requires structural reconciliation first.
