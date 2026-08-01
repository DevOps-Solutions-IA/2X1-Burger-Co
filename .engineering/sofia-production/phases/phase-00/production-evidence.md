# Production evidence

## Migration deploy

The owner authorized only `prisma migrate deploy`. The following additive migrations were applied in order:

1. `20260714220000_persistent_audit_contract_v2`
2. `20260727130000_sofia_crm_bounded_context`
3. `20260727133000_sofia_payment_webhook_fail_closed`

Post-deploy migration identity is 32/32. Products (26), order tickets (1,211), users (43), and sales (827) counts were unchanged. SOFIA payment settings/events, customer memories, and CRM customers were queryable. API, web, nginx, and PostgreSQL remained healthy with no unexpected restart and no new migration/schema errors.

## Application runtime

The initial candidate deployment was rolled back safely. The two documented blockers were remediated and a new owner-authorized candidate was deployed on 2026-08-01.

### Verified candidate identity

- Source commit: `b8269f5f51fed784533bb535e4ffd6c38c0c5ae6`
- Build ID: `0.1.0-b8269f5f51fe-1785600648`
- API digest: `sha256:6170f65e9a0a1ebe7bd18ba418f7dbe07b68d0cfdbefd2b2da651c47f43f218c`
- Web digest: `sha256:d5c0348fa23715ee4d37ae6e2bcdc12a5f218ff609a09ffd729c2444e56e510a`
- Dirty build: false
- Image secret scan: PASS

### Pre-deploy backup

- File: `backup-inventory_fastfood_system-20260801-111840.dump.gpg`
- Size: 1,488,203 bytes
- SHA-256: `b9a869c8e2cea926f0e860d70250fdee01aaa8e637f2a7914ee38b2170ec5f85`
- Created: `2026-08-01T16:18:43Z`
- Encrypted: PASS
- Plaintext sibling files: zero

### Runtime result

The isolated canary applied 32 migrations into an isolated database and passed release identity, login, read-only operational smoke, safety flags, API readiness, and repeated API/web health cycles with zero restarts. Nine retained test/sandbox administrative routes returned HTTP 404 with authentication and the unauthenticated probe returned HTTP 401.

The production API returned `READY`, `32/32`, and sanitized status `MIGRATION_FILE_ONLY_DRIFT_ATTESTED`. The only evidence exposed was the forensic commit. The production web healthcheck resolved the API using `http://api:3000`; API, web, Nginx, and PostgreSQL remained healthy with zero restarts and no schema or configuration errors.

The generic webhook contracts remain present, but mock execution fails before persistence: WhatsApp mock inbound returned HTTP 401 and mock payments returned HTTP 400 with `SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN`. Payment webhook event count remained 24. Authentication rejected anonymous admin access, and an authorized administrator login succeeded.

Products (26), order tickets (1,211), users (43), sales (827), and payment webhook events (24) did not change. Audit logs increased from 8,846 to 8,850 due to expected authenticated verification. Total historical outbound messages with `SENT` status remained 35, so no new outbound was sent.

The broader sandbox classification contains 164 historical conversations, including legacy linked records. This corrects the prior narrower statement that only checked a literal `MOCK_ADMIN` identifier. These records predate deployment and remain non-operational: production creation routes are unavailable, mock providers are rejected, global governance is paused, production/auto-reply/auto-safe/real-send flags are false, and sent-outbound count did not increase.
