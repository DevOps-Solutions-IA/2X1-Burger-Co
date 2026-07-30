# Working Tree Classification

Status: **COMPLETE - NO UNKNOWN PATHS**. Classification is evidence-based by path plus reviewed domain diffs; `MIXED` and `OWNER_CHANGE` remain explicitly excluded from automatic staging.

## Summary

| Classification | Files |
| --- | ---: |
| DOCUMENTATION | 30 |
| GENERATED | 10 |
| HARNESS_FIX | 20 |
| HISTORICAL_REPORT | 7 |
| LEGITIMATE_FIX | 30 |
| MIXED | 8 |
| OWNER_CHANGE | 89 |

## File Matrix

| File | Git | Origin / purpose | Dependency | Tests | Action | Proposed commit |
| --- | --- | --- | --- | --- | --- | --- |
| `.agents/tasks/prd-sofia-ultra-premium.json` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Preservar sin stage | `none` |
| `.claude/scheduled_tasks.lock` | ` D` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Preservar sin stage | `none` |
| `.engineering/GLOBAL_STATUS.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/ROADMAP.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/api.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/caja.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/dashboard.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/database.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/delivery.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/deployment.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/frontend.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/inventory.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/performance.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/pos.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/security.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/sofia.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/testing.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/uiux.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/modules/whatsapp.md` | ` M` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.env.example` | ` M` | Shared file with multiple domains | hunk separation required | not a closure gate | Separar por hunks/dependencias; no stage completo | `multiple` |
| `.github/workflows/cd.yml` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `.github/workflows/ci.yml` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/package.json` | ` M` | Shared file with multiple domains | hunk separation required | not a closure gate | Separar por hunks/dependencias; no stage completo | `multiple` |
| `apps/api/src/config/env.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/api/src/delivery/delivery-pricing/delivery-pricing.engine.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Delivery congelado previo; no incluir en cierre | `none` |
| `apps/api/src/main.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/api/src/modules/health/health.module.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/src/modules/health/health.service.spec.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/src/modules/health/health.service.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/src/modules/health/observability.service.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/src/modules/orders/delivery-receipt.renderer.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Delivery congelado previo; no incluir en cierre | `none` |
| `apps/api/src/modules/orders/orders.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Delivery congelado previo; no incluir en cierre | `none` |
| `apps/api/src/modules/reports/reports.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/api/src/modules/settings/settings.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/api/src/modules/sofia/ai/deepseek-ai.provider.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/ai/sofia-ai-provider.adapter.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/ai/sofia-ai-provider.factory.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/backups/sofia-backups.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/catalog/sofia-commercial-catalog.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/catalog/sofia-commercial-catalog.types.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/dto/sofia.dto.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/governance/sofia-governance.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/memory/sofia-customer-memory.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/memory/sofia-memory.types.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/payments/bold-payment.provider.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/payments/mock-payment.provider.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/payments/null-payment.provider.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/payments/payment-provider.adapter.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/prompt/sofia-master-prompt.seed.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/prompt/sofia-prompt.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.service.spec.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.types.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia-agent.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia-payment-link.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia-payment-webhooks.controller.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia-public-payments.controller.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia-whatsapp.controller.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia-whatsapp.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia.controller.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia.module.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/whatsapp/hermes-whatsapp.provider.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.controller.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.provider.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/whatsapp/whatsapp.service.ts` | ` M` | Shared file with multiple domains | hunk separation required | not a closure gate | WhatsApp safety y Delivery mezclados; separar hunks | `fix(whatsapp)` |
| `apps/api/src/release/release-manifest.spec.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/src/release/release-manifest.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/src/release/release-metadata.service.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/api/src/tests/app.critical.spec.ts` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Expectativas corregidas con evidencia 10x | `fix(validation)` |
| `apps/api/src/tests/delivery-receipt-phase-a.spec.ts` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Expectativas corregidas con evidencia 10x | `fix(validation)` |
| `apps/web/next.config.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Preservar; no incluir sin validación de dominio | `none` |
| `apps/web/package.json` | ` M` | Shared file with multiple domains | hunk separation required | not a closure gate | Separar por hunks/dependencias; no stage completo | `multiple` |
| `apps/web/src/app/(app)/cash/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/dashboard/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/deliveries/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Delivery congelado previo; no incluir en cierre | `none` |
| `apps/web/src/app/(app)/expenses/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/ingredients/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/inventory/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/layout.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/pos/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/products/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/purchases/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/recipes/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/reports/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(app)/sofia/conversations/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/app/(app)/sofia/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/app/(app)/sofia/sandbox/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/app/(app)/sofia/whatsapp-qr/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/app/(app)/users/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(waiter)/waiter-layout.client.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/(waiter)/waiter/page.client.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/pagos/[token]/page.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/app/version/route.ts` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `apps/web/src/components/app-shell.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/components/sofia/SofiaLiveSignalCard.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/components/sofia/SofiaOperatorConsole.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/components/sofia/SofiaReadinessGauge.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/components/sofia/SofiaReadinessGrid.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/components/sofia/SofiaScopeComparison.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/components/sofia/SofiaSectionHeader.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/components/sofia/SofiaTimeline.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/web/src/components/ui/field.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/components/ui/section-title.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/features/pos/PosProductBrowser.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/features/pos/PosWhatsappReceiptModal.tsx` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `apps/web/src/lib/api.ts` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `docker-compose.yml` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `docs/sofia-current-state.md` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `eslint.config.mjs` | ` M` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Cambio funcional/calidad previo; preservar y separar | `none` |
| `infra/docker/Dockerfile.api` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/docker/Dockerfile.web` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/nginx/default.conf` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/nginx/generated/default.conf` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/nginx/templates/http.conf.template` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/nginx/templates/https.conf.template` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/recovery/build-test-artifacts.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/release/canary-deploy.sh` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/release/canary-smoke.mjs` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/release/docker-compose.canary.yml` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/release/docker-compose.staging-images.yml` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/release/generate-release-manifest.mjs` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/release/runtime-safety-smoke.mjs` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/release/staging-deploy.sh` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/schema/migration-expectation.mjs` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/schema/migration-expectation.test.mjs` | ` M` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/scripts/backup.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/scripts/common.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/scripts/deploy.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/scripts/render-nginx-conf.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/scripts/restore.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/scripts/smoke.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/testing/contract-tests.mjs` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/testing/run-ephemeral-e2e.sh` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `package.json` | ` M` | Shared file with multiple domains | hunk separation required | not a closure gate | Separar por hunks/dependencias; no stage completo | `multiple` |
| `pnpm-lock.yaml` | ` M` | Shared file with multiple domains | hunk separation required | not a closure gate | Separar por hunks/dependencias; no stage completo | `multiple` |
| `prisma/schema.prisma` | ` M` | Shared file with multiple domains | hunk separation required | not a closure gate | Separar por hunks/dependencias; no stage completo | `multiple` |
| `tests/e2e/ephemeral/core-operational-ui.spec.ts` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `tests/e2e/ephemeral/mobile.spec.ts` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `tests/e2e/ephemeral/operator-console.spec.ts` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `tests/e2e/sofia-agent-multimedia-sandbox-phase-7-9.spec.ts` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `tests/e2e/sofia-whatsapp-qr-gateway-4.spec.ts` | ` M` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `.agents/skills/ui-ux-pro-max/scripts/__pycache__/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Regenerable; no incluir | `none` |
| `.engineering/checkpoints/enterprise-program-before.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/checkpoints/enterprise-resilience-implementation-complete.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/checkpoints/phase-2-5-1-r2-complete.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/checkpoints/production-readiness-validation-2026-07-28.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/checkpoints/sofia-enterprise-implementation-complete.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/evidence/phase-2-2/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/evidence/phase-2-3/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/evidence/phase-2-4/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/evidence/phase-2-5-1-r1/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/evidence/phase-2-5-1-r2/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/evidence/phase-2-5-1/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/evidence/phase-2-5/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/evidence/production-readiness-2026-07-28/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Preservar evidencia; excluir binarios/logs | `none` |
| `.engineering/production-closure/` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Incluir al cierre | `docs(release)` |
| `.engineering/reports/enterprise-program-execution.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/reports/enterprise-resilience-implementation-report.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/reports/phase-2-5-1-r2-recovery-release-report.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/reports/production-readiness-validation-2026-07-28.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `.engineering/reports/sofia-enterprise-production-readiness-report.md` | `??` | Engineering evidence/status | independent or excluded | not a closure gate | Revisar y separar por fase | `docs(engineering)` |
| `apps/api/src/modules/sofia/ai/deepseek-ai.provider.spec.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/catalog/sofia-commercial-catalog.service.spec.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/crm/` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Feature CRM previa; changeset independiente, no cierre automático | `feat(sofia-crm)` |
| `apps/api/src/modules/sofia/payments/bold-payment.provider.spec.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/privacy/sofia-admin-response-sanitizer.interceptor.spec.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/privacy/sofia-admin-response-sanitizer.interceptor.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/sofia-payment-link.service.spec.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.spec.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/sofia/whatsapp/whatsapp-provider-idempotency.spec.ts` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Trabajo Sofia previo; validar y separar antes de commit | `feat(sofia)` |
| `apps/api/src/modules/whatsapp/whatsapp-outbound-safety.spec.ts` | `??` | Shared file with multiple domains | hunk separation required | not a closure gate | WhatsApp safety y Delivery mezclados; separar hunks | `fix(whatsapp)` |
| `apps/web/src/app/(app)/sofia/customers/` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Feature CRM previa; changeset independiente, no cierre automático | `feat(sofia-crm)` |
| `apps/web/src/features/sofia/` | `??` | Pre-existing/owner domain work | independent or excluded | not a closure gate | Feature CRM previa; changeset independiente, no cierre automático | `feat(sofia-crm)` |
| `infra/environments/staging/selfhosted-data/deployment-prep/delivery-phase-a-commit/` | `??` | Historical traceability | independent or excluded | not a closure gate | Preservar sin mezclar con runtime | `none` |
| `infra/environments/staging/selfhosted-data/deployment-prep/delivery-real-receipt-validation/` | `??` | Historical traceability | independent or excluded | not a closure gate | Preservar sin mezclar con runtime | `none` |
| `infra/environments/staging/selfhosted-data/deployment-prep/delivery-test-handle-fix/` | `??` | Historical traceability | independent or excluded | not a closure gate | Preservar sin mezclar con runtime | `none` |
| `infra/environments/staging/selfhosted-data/deployment-prep/sofia-claude-direct-ultra-premium/` | `??` | Historical traceability | independent or excluded | not a closure gate | Preservar sin mezclar con runtime | `none` |
| `infra/environments/staging/selfhosted-data/deployment-prep/sofia-extreme-live-dashboard/` | `??` | Historical traceability | independent or excluded | not a closure gate | Preservar sin mezclar con runtime | `none` |
| `infra/environments/staging/selfhosted-data/deployment-prep/sofia-fable5-command-center/` | `??` | Historical traceability | independent or excluded | not a closure gate | Preservar sin mezclar con runtime | `none` |
| `infra/environments/staging/selfhosted-data/deployment-prep/system-total-audit-final/` | `??` | Historical traceability | independent or excluded | not a closure gate | Preservar sin mezclar con runtime | `none` |
| `infra/release/release-safety.test.mjs` | `??` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/release/verify-runtime-identity.mjs` | `??` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset release/provenance | `feat(runtime)` |
| `infra/testing/.engineering/` | `??` | Generated cache/evidence | independent or excluded | not a closure gate | Regenerable; no incluir | `none` |
| `prisma/migrations/20260727130000_sofia_crm_bounded_context/` | `??` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset Sofia CRM separado | `feat(sofia-crm)` |
| `prisma/migrations/20260727133000_sofia_payment_webhook_fail_closed/` | `??` | Release or schema source change | validated source contract | typecheck/build/contracts/regression | Changeset safety fail-closed separado | `fix(sofia-payments)` |
| `tests/e2e/ephemeral/accessibility.ts` | `??` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `tests/e2e/tsconfig.json` | `??` | Validation/recovery harness | ephemeral test platform | typecheck/build/contracts/regression | Changeset harness separado | `test(release)` |
| `infra/recovery/docker-compose.recovery.yml` | ` M` | Validation/recovery harness | isolated restore environment | recovery and schema drills | Changeset recovery separado | `test(recovery)` |
| `infra/recovery/run-ephemeral-recovery-drill.sh` | ` M` | Validation/recovery harness | isolated restore environment | recovery and schema drills | Changeset recovery separado | `test(recovery)` |
| `infra/release/build-artifacts.sh` | ` M` | Release or schema source change | validated artifact contract | artifact packaging and inspection | Changeset release/provenance | `feat(runtime)` |
| `.engineering/checkpoints/production-closure-2026-07-29.md` | `??` | Engineering evidence/status | current closure | final gate evidence | Include only in closure documentation changeset | `docs(release)` |
| `.engineering/reports/production-closure-final-2026-07-29.md` | `??` | Engineering evidence/status | current closure | final gate evidence | Include only in closure documentation changeset | `docs(release)` |

## Staging Rule

No `OWNER_CHANGE`, `MIXED`, `GENERATED`, or `HISTORICAL_REPORT` path may be staged wholesale. Shared files require a reviewed index patch. No `git add .` is permitted.
