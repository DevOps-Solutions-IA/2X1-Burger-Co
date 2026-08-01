# Production evidence

## Migration deploy

The owner authorized only `prisma migrate deploy`. The following additive migrations were applied in order:

1. `20260714220000_persistent_audit_contract_v2`
2. `20260727130000_sofia_crm_bounded_context`
3. `20260727133000_sofia_payment_webhook_fail_closed`

Post-deploy migration identity is 32/32. Products (26), order tickets (1,211), users (43), and sales (827) counts were unchanged. SOFIA payment settings/events, customer memories, and CRM customers were queryable. API, web, nginx, and PostgreSQL remained healthy with no unexpected restart and no new migration/schema errors.

## Application runtime

No application image was built into or deployed to the principal environment. Consequently, this document does not claim the new sandbox/mock controls are active in production.

