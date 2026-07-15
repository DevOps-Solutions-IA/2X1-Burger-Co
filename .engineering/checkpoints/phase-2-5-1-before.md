# Phase 2.5.1 Before

- Local timestamp: 2026-07-14T21:55:17-05:00
- UTC timestamp: 2026-07-15T02:55:17+00:00
- Branch: `master
`
- HEAD: `66c54785f6d1383e40f28e66dd825a4db11d6a44
`
- Migration count: `29
`
- Production modified: NO.
- Operative DB touched: NO.
- WhatsApp real: OFF.
- Push: NO.

## Git status

```text
 M .agents/tasks/prd-sofia-ultra-premium.json
 M .claude/scheduled_tasks.lock
 M .engineering/GLOBAL_STATUS.md
 M .engineering/ROADMAP.md
 M .engineering/modules/api.md
 M .engineering/modules/caja.md
 M .engineering/modules/dashboard.md
 M .engineering/modules/database.md
 M .engineering/modules/delivery.md
 M .engineering/modules/deployment.md
 M .engineering/modules/frontend.md
 M .engineering/modules/inventory.md
 M .engineering/modules/performance.md
 M .engineering/modules/pos.md
 M .engineering/modules/security.md
 M .engineering/modules/sofia.md
 M .engineering/modules/testing.md
 M .engineering/modules/uiux.md
 M .engineering/modules/whatsapp.md
 M .github/workflows/ci.yml
 M apps/api/src/common/filters/prisma-exception.filter.ts
 M apps/api/src/common/middleware/request-logging.middleware.ts
 M apps/api/src/config/env.ts
 M apps/api/src/modules/cash-register/cash-register.service.ts
 M apps/api/src/modules/health/health.controller.ts
 M apps/api/src/modules/health/health.module.ts
 M apps/api/src/modules/health/health.service.ts
 M apps/api/src/modules/orders/orders.service.ts
 M apps/api/src/modules/sales/sales.service.ts
 M package.json
?? .engineering/checkpoints/phase-2-2-before.md
?? .engineering/checkpoints/phase-2-2-complete.md
?? .engineering/checkpoints/phase-2-3-before.md
?? .engineering/checkpoints/phase-2-3-complete.md
?? .engineering/checkpoints/phase-2-4-before.md
?? .engineering/checkpoints/phase-2-4-complete.md
?? .engineering/checkpoints/phase-2-5-1-before.md
?? .engineering/checkpoints/phase-2-5-before.md
?? .engineering/checkpoints/phase-2-5-complete.md
?? .engineering/evidence/phase-2-2/
?? .engineering/evidence/phase-2-3/
?? .engineering/evidence/phase-2-4/
?? .engineering/evidence/phase-2-5/
?? .engineering/reports/phase-2-2-runtime-contract-map.md
?? .engineering/reports/phase-2-2-runtime-safety-report.md
?? .engineering/reports/phase-2-2-safety-matrix.md
?? .engineering/reports/phase-2-3-ephemeral-test-platform-report.md
?? .engineering/reports/phase-2-3-rbac-matrix.md
?? .engineering/reports/phase-2-3-test-architecture-audit.md
?? .engineering/reports/phase-2-4-alert-catalog.md
?? .engineering/reports/phase-2-4-backup-policy.md
?? .engineering/reports/phase-2-4-recovery-audit.md
?? .engineering/reports/phase-2-4-recovery-observability-report.md
?? .engineering/reports/phase-2-4-rpo-rto.md
?? .engineering/reports/phase-2-4-slo-catalog.md
?? .engineering/reports/phase-2-5-business-invariants.md
?? .engineering/reports/phase-2-5-core-operational-e2e-report.md
?? apps/api/src/modules/health/health.service.spec.ts
?? apps/api/src/modules/health/observability.service.spec.ts
?? apps/api/src/modules/health/observability.service.ts
?? docs/runbooks/
?? infra/environments/staging/selfhosted-data/deployment-prep/delivery-phase-a-commit/
?? infra/environments/staging/selfhosted-data/deployment-prep/delivery-real-receipt-validation/
?? infra/environments/staging/selfhosted-data/deployment-prep/delivery-test-handle-fix/
?? infra/environments/staging/selfhosted-data/deployment-prep/sofia-claude-direct-ultra-premium/
?? infra/environments/staging/selfhosted-data/deployment-prep/sofia-extreme-live-dashboard/
?? infra/environments/staging/selfhosted-data/deployment-prep/sofia-fable5-command-center/
?? infra/environments/staging/selfhosted-data/deployment-prep/system-total-audit-final/
?? infra/recovery/
?? infra/testing/
?? tests/e2e/ephemeral/
```

## Runtime containers

```text
NAME                    IMAGE                COMMAND                  SERVICE    CREATED       STATUS                 PORTS
inventario-api-1        inventario-api       "docker-entrypoint.s…"   api        3 days ago    Up 3 days (healthy)    0.0.0.0:4300->3000/tcp
inventario-nginx-1      nginx:1.27-alpine    "/docker-entrypoint.…"   nginx      13 days ago   Up 13 days (healthy)   0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
inventario-postgres-1   postgres:16-alpine   "docker-entrypoint.s…"   postgres   3 weeks ago   Up 2 weeks (healthy)   127.0.0.1:5432->5432/tcp
inventario-web-1        inventario-web       "docker-entrypoint.s…"   web        4 days ago    Up 4 days (healthy)    0.0.0.0:3301->3001/tcp
```
