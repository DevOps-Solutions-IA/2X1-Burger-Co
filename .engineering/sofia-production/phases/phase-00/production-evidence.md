# Production evidence

## Migration deploy

The owner authorized only `prisma migrate deploy`. The following additive migrations were applied in order:

1. `20260714220000_persistent_audit_contract_v2`
2. `20260727130000_sofia_crm_bounded_context`
3. `20260727133000_sofia_payment_webhook_fail_closed`

Post-deploy migration identity is 32/32. Products (26), order tickets (1,211), users (43), and sales (827) counts were unchanged. SOFIA payment settings/events, customer memories, and CRM customers were queryable. API, web, nginx, and PostgreSQL remained healthy with no unexpected restart and no new migration/schema errors.

## Application runtime

Owner-authorized candidate deployment was attempted on 2026-08-01 and automatically rolled back.

### Candidate identity

- Source commit: `828c1f1fc1cc13ddd54e658e87df6b7ee5598976`
- Build ID: `0.1.0-828c1f1fc1cc-1785570186`
- API digest: `sha256:51e7468302514f9af787520d8bc532c931cef6fb9e5c09672f73eab11f7525b2`
- Web digest: `sha256:574d0f024d39bb055a5fbba8a8e6e9f5292703b58aca8e60de0fcee1f920f499`
- Dirty build: false
- Image secret scan: PASS

### Pre-deploy backup

- File: `backup-inventory_fastfood_system-20260801-103609.dump.gpg`
- Size: 1,487,324 bytes
- SHA-256: `4b73d6a766c6c1e8668d142de972e4ed0ef44453a0c3f8518f8659b6389834df`
- Created: `2026-08-01T15:36:11Z`
- Encrypted: PASS
- Plaintext sibling files: zero

### Runtime result

The isolated candidate passed source identity, 32 fresh migrations, login, read-only operational smoke, safety flags, and authenticated route probes. Sandbox, auto-safe sandbox, mock inbound/outbound, mock payment webhook, AI test, agent process, and QR test endpoints returned HTTP 404; the unauthenticated sandbox probe returned HTTP 401.

Production replacement failed closed because API health returned HTTP 503 with sanitized reason `MIGRATION_INCOMPATIBLE`. `HealthService.readiness()` requires every release-manifest checksum to equal `_prisma_migrations`; the owner-accepted file-only drift for `0001_initial` is not represented in that contract. The candidate web also answered HTTP 200 externally but its internal `wget localhost:3001/login` healthcheck remained unhealthy with connection refused.

The previous API and web images were restored immediately. Final API, web, nginx, and PostgreSQL health passed; migration count remained 32. Products (26), order tickets (1,211), users (43), sales (827), and payment events (126) were unchanged. No outbound message was marked sent during the deployment window and `MOCK_ADMIN` conversation count remained zero.
