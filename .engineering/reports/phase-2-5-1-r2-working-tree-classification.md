# Phase 2.5.1-R2 - Working tree classification

The classification is based on file diffs, not path names alone. Owner files and generated evidence remain outside every code changeset.

| File or path | Domain | Dependencies | Separable | Action |
| --- | --- | --- | --- | --- |
| `.agents/tasks/prd-sofia-ultra-premium.json` | OWNER_UNRELATED | Owner workflow | Yes | Leave unstaged |
| `.claude/scheduled_tasks.lock` | OWNER_UNRELATED | Owner workflow | Yes | Leave unstaged |
| `prisma/schema.prisma` | AUDIT_V2 | Prisma client | Yes | Audit contract commit |
| `prisma/migrations/20260714220000_persistent_audit_contract_v2/` | AUDIT_V2 | Schema | Yes | Audit contract commit |
| `apps/api/src/modules/audit/**` | AUDIT_V2 | Prisma, request context | Yes | Audit contract commit |
| `apps/api/src/common/middleware/request-logging.middleware.ts` | AUDIT_V2 | Audit context, observability | Yes | Audit contract commit |
| `apps/api/src/common/filters/prisma-exception.filter.ts` | AUDIT_V2 | Sanitized request logging | Yes | Audit contract commit |
| `apps/api/src/modules/health/**` | RECOVERY_HARNESS | Prisma, observability | Yes | Audit/observability foundation commit |
| `apps/api/src/config/env.ts` | RECOVERY_HARNESS | Health/readiness | Yes | Audit/observability foundation commit |
| `apps/api/src/common/guards/jwt-auth.guard.ts` | RBAC_ROLE_FIX | Audit service | Yes | RBAC remediation commit |
| `apps/api/src/common/guards/roles.guard.ts` | RBAC_ROLE_FIX | Trusted principal, audit context | Yes | RBAC remediation commit |
| `apps/api/src/common/guards/roles.guard.spec.ts` | RBAC_ROLE_FIX | Roles guard | Yes | RBAC remediation commit |
| `apps/api/src/modules/cash-register/cash-register.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core transactional audit commit |
| `apps/api/src/modules/sales/sales.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core transactional audit commit |
| `apps/api/src/modules/orders/orders.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core transactional audit commit |
| `apps/api/src/modules/inventory/inventory.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core transactional audit commit |
| `apps/api/src/modules/purchases/purchases.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core transactional audit commit |
| `apps/api/src/modules/sofia/backups/sofia-backups.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core audit bypass removal commit |
| `apps/api/src/modules/sofia/governance/sofia-governance.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core audit bypass removal commit |
| `apps/api/src/modules/sofia/learning/sofia-human-feedback.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core audit bypass removal commit |
| `apps/api/src/modules/sofia/retention/sofia-retention.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core audit bypass removal commit |
| `apps/api/src/modules/sofia/runtime-safety/**` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core audit bypass removal commit |
| `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts` | CORE_TRANSACTIONAL_AUDIT | Audit v2 | Yes | Core audit bypass removal commit |
| `apps/api/src/tests/delivery-receipt-phase-a.spec.ts` | CORE_TRANSACTIONAL_AUDIT | Central phone redaction | Yes | Core audit test commit |
| `infra/testing/**` excluding nested generated evidence | TEST_PLATFORM | Docker, Prisma, Playwright | Yes | Test platform commit |
| `tests/e2e/ephemeral/**` | TEST_PLATFORM | Ephemeral runner | Yes | Test platform commit |
| `package.json` | TEST_PLATFORM | Test scripts | Yes | Test platform commit |
| `.github/workflows/ci.yml` | TEST_PLATFORM | Test platform | Yes | Test platform commit |
| `infra/recovery/**` | RECOVERY_HARNESS | Test artifacts, Docker | Yes | Recovery commit |
| `infra/schema/**` | RECOVERY_HARNESS | Prisma migrations | Yes | Recovery commit |
| `infra/release/generate-release-manifest.mjs` | RELEASE_INFRA | Shared schema expectation | Yes | Recovery/release commit |
| `docs/runbooks/**` | ENGINEERING_DOCS | Recovery and observability | Yes | Engineering documentation commit |
| `.engineering/modules/*.md` | ENGINEERING_DOCS | Phase reports | Yes | Engineering documentation commit |
| `.engineering/GLOBAL_STATUS.md` | ENGINEERING_DOCS | Module scores | Yes | Engineering documentation commit |
| `.engineering/ROADMAP.md` | ENGINEERING_DOCS | Phase gates | Yes | Engineering documentation commit |
| `.engineering/checkpoints/phase-2-2*` through `phase-2-5-1-r1*` | ENGINEERING_DOCS | Historical phase state | Yes | Engineering documentation commit |
| `.engineering/reports/phase-2-2*` through `phase-2-5-1-r1*` | ENGINEERING_DOCS | Historical phase state | Yes | Engineering documentation commit |
| `.engineering/reports/phase-2-5-1-r2-*` | ENGINEERING_DOCS | Current execution | Yes | Commit pre-artifact reports when stable |
| `.engineering/evidence/**` | GENERATED | Runtime/test output | Yes | Keep uncommitted; sanitize and reference |
| `infra/testing/.engineering/evidence/**` | GENERATED | Mislocated Playwright output from historical runs | Yes | Leave unstaged; do not delete owner evidence |
| `infra/environments/staging/selfhosted-data/deployment-prep/**` | HISTORICAL_REPORTS | Historical phases | Yes | Leave unstaged in this release changeset |

## Separation decision

No owner file is required by the candidate artifact. Shared source files contain cohesive audit changes and can be committed as complete files. Generated evidence is not required to reproduce the application and is excluded from artifact source.
