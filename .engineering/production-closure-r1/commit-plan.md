# Production Closure R1 Commit Plan

Baseline HEAD: c8a82998ef5265f70dc1a1039cab2e9327f8f66d.
Baseline entries: **194**. UNKNOWN: **0**. Staging: **empty**.

## Decision Before Staging

**BLOCKED**. Owner changes and shared mixed files prevent the required clean working tree. In particular, migrations 31/32 depend on the uncommitted Sofia/CRM schema and implementation, while shared manifests, lockfiles and critical specs contain cross-phase changes. R1 explicitly forbids committing owner changes or mixing Sofia cleanup.

## Summary

| Classification | Paths |
| --- | ---: |
| CONTRACT_FIX | 2 |
| DOCUMENTATION | 30 |
| EXCLUDE | 15 |
| GENERATED_DELETE | 2 |
| MIGRATION | 4 |
| OWNER_CHANGE | 97 |
| RECOVERY_ROLLBACK | 9 |
| RELEASE_INFRASTRUCTURE | 18 |
| RUNTIME_VERSION_READINESS | 8 |
| TEST | 9 |

## Path Matrix

| Path | Classification | Commit | Tests | Include/Exclude | Evidence |
| --- | --- | --- | --- | --- | --- |
| .agents/tasks/prd-sofia-ultra-premium.json | OWNER_CHANGE | NONE | not a closure gate | EXCLUDE | Pre-existing owner/agent coordination state; Git  M |
| .claude/scheduled_tasks.lock | OWNER_CHANGE | NONE | not a closure gate | EXCLUDE | Pre-existing owner/agent coordination state; Git  D |
| .engineering/GLOBAL_STATUS.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/ROADMAP.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/api.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/caja.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/dashboard.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/database.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/delivery.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/deployment.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/frontend.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/inventory.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/performance.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/pos.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/security.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/sofia.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/testing.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/uiux.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .engineering/modules/whatsapp.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git  M |
| .env.example | OWNER_CHANGE | NONE | full source regression | EXCLUDE | Shared mixed file with broad owner/domain changes; no safe whole-file stage; Git  M |
| .github/workflows/cd.yml | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| .github/workflows/ci.yml | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| apps/api/package.json | OWNER_CHANGE | NONE | full source regression | EXCLUDE | Shared mixed file with broad owner/domain changes; no safe whole-file stage; Git  M |
| apps/api/src/config/env.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/api/src/delivery/delivery-pricing/delivery-pricing.engine.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/api/src/main.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/api/src/modules/health/health.module.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/api/src/modules/health/health.service.spec.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/api/src/modules/health/health.service.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/api/src/modules/health/observability.service.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/api/src/modules/orders/delivery-receipt.renderer.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/api/src/modules/orders/orders.service.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/api/src/modules/reports/reports.service.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/api/src/modules/settings/settings.service.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/api/src/modules/sofia/ai/deepseek-ai.provider.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/ai/sofia-ai-provider.adapter.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/ai/sofia-ai-provider.factory.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/backups/sofia-backups.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/catalog/sofia-commercial-catalog.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/catalog/sofia-commercial-catalog.types.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/dto/sofia.dto.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/governance/sofia-governance.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/memory/sofia-customer-memory.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/memory/sofia-memory.types.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/payments/bold-payment.provider.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/payments/mock-payment.provider.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/payments/null-payment.provider.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/payments/payment-provider.adapter.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/prompt/sofia-master-prompt.seed.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/prompt/sofia-prompt.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.service.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.types.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia-agent.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia-payment-link.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia-payment-webhooks.controller.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia-public-payments.controller.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia-whatsapp.controller.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia-whatsapp.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia.controller.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia.module.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/sofia.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/whatsapp/hermes-whatsapp.provider.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.controller.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.provider.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/api/src/modules/whatsapp/whatsapp.service.ts | OWNER_CHANGE | NONE | WhatsApp safety regression | EXCLUDE | Pre-existing shared WhatsApp changes; cannot stage wholesale; Git  M |
| apps/api/src/release/release-manifest.spec.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/api/src/release/release-manifest.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/api/src/release/release-metadata.service.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/api/src/tests/app.critical.spec.ts | CONTRACT_FIX | fix(validation) | 40/40 focal; groups 3x; 157/157 | INCLUDE_PARTIAL_ONLY | Required contract hunks share files with prior harness changes; Git  M |
| apps/api/src/tests/delivery-receipt-phase-a.spec.ts | CONTRACT_FIX | fix(validation) | 40/40 focal; groups 3x; 157/157 | INCLUDE_PARTIAL_ONLY | Required contract hunks share files with prior harness changes; Git  M |
| apps/web/next.config.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/package.json | OWNER_CHANGE | NONE | full source regression | EXCLUDE | Shared mixed file with broad owner/domain changes; no safe whole-file stage; Git  M |
| apps/web/src/app/(app)/cash/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/dashboard/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/deliveries/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/expenses/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/ingredients/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/inventory/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/layout.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/pos/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/products/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/purchases/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/recipes/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/reports/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(app)/sofia/conversations/page.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/app/(app)/sofia/page.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/app/(app)/sofia/sandbox/page.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/app/(app)/sofia/whatsapp-qr/page.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/app/(app)/users/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(waiter)/waiter-layout.client.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/(waiter)/waiter/page.client.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/pagos/[token]/page.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/app/version/route.ts | RUNTIME_VERSION_READINESS | feat(runtime) | release/health focused 18/18 | INCLUDE | Version, manifest, liveness and readiness source; Git  M |
| apps/web/src/components/app-shell.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/components/sofia/SofiaLiveSignalCard.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/components/sofia/SofiaOperatorConsole.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/components/sofia/SofiaReadinessGauge.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/components/sofia/SofiaReadinessGrid.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/components/sofia/SofiaScopeComparison.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/components/sofia/SofiaSectionHeader.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/components/sofia/SofiaTimeline.tsx | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| apps/web/src/components/ui/field.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/components/ui/section-title.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/features/pos/PosProductBrowser.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/features/pos/PosWhatsappReceiptModal.tsx | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| apps/web/src/lib/api.ts | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| docker-compose.yml | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| docs/sofia-current-state.md | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git  M |
| eslint.config.mjs | OWNER_CHANGE | NONE | full regression or owning-phase tests | EXCLUDE | Pre-existing functional/UI/configuration work outside R1; Git  M |
| infra/docker/Dockerfile.api | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/docker/Dockerfile.web | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/nginx/default.conf | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/nginx/generated/default.conf | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/nginx/templates/http.conf.template | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/nginx/templates/https.conf.template | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/recovery/build-test-artifacts.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/recovery/docker-compose.recovery.yml | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/recovery/run-ephemeral-recovery-drill.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/release/build-artifacts.sh | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/release/canary-deploy.sh | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/release/canary-smoke.mjs | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/release/docker-compose.canary.yml | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/release/docker-compose.staging-images.yml | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/release/generate-release-manifest.mjs | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/release/runtime-safety-smoke.mjs | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/release/staging-deploy.sh | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git  M |
| infra/schema/migration-expectation.mjs | MIGRATION | fix(migrations) | migration expectation 10/10 | INCLUDE | Dynamic migration inventory and checksum contract; Git  M |
| infra/schema/migration-expectation.test.mjs | MIGRATION | fix(migrations) | migration expectation 10/10 | INCLUDE | Dynamic migration inventory and checksum contract; Git  M |
| infra/scripts/backup.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/scripts/common.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/scripts/deploy.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/scripts/render-nginx-conf.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/scripts/restore.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/scripts/smoke.sh | RECOVERY_ROLLBACK | feat(release) | recovery/schema drills | INCLUDE | Recovery, restore, smoke and rollback harness; Git  M |
| infra/testing/contract-tests.mjs | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git  M |
| infra/testing/run-ephemeral-e2e.sh | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git  M |
| package.json | OWNER_CHANGE | NONE | full source regression | EXCLUDE | Shared mixed file with broad owner/domain changes; no safe whole-file stage; Git  M |
| pnpm-lock.yaml | OWNER_CHANGE | NONE | full source regression | EXCLUDE | Shared mixed file with broad owner/domain changes; no safe whole-file stage; Git  M |
| prisma/schema.prisma | OWNER_CHANGE | NONE | full source regression | EXCLUDE | Shared mixed file with broad owner/domain changes; no safe whole-file stage; Git  M |
| tests/e2e/ephemeral/core-operational-ui.spec.ts | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git  M |
| tests/e2e/ephemeral/mobile.spec.ts | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git  M |
| tests/e2e/ephemeral/operator-console.spec.ts | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git  M |
| tests/e2e/sofia-agent-multimedia-sandbox-phase-7-9.spec.ts | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git  M |
| tests/e2e/sofia-whatsapp-qr-gateway-4.spec.ts | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git  M |
| .agents/skills/ui-ux-pro-max/scripts/__pycache__/ | GENERATED_DELETE | NONE | generated/cache checks | EXCLUDE | Regenerable cache; deletion is safe only after owner-work gate; Git ?? |
| .engineering/checkpoints/enterprise-program-before.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/checkpoints/enterprise-resilience-implementation-complete.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/checkpoints/phase-2-5-1-r2-complete.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/checkpoints/production-closure-2026-07-29.md | DOCUMENTATION | docs(release) | source gate evidence | INCLUDE | Current production-closure evidence; Git ?? |
| .engineering/checkpoints/production-readiness-validation-2026-07-28.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/checkpoints/sofia-enterprise-implementation-complete.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/evidence/phase-2-2/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/evidence/phase-2-3/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/evidence/phase-2-4/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/evidence/phase-2-5-1-r1/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/evidence/phase-2-5-1-r2/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/evidence/phase-2-5-1/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/evidence/phase-2-5/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/evidence/production-readiness-2026-07-28/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| .engineering/production-closure/ | DOCUMENTATION | docs(release) | source gate evidence | INCLUDE | Current production-closure evidence; Git ?? |
| .engineering/reports/enterprise-program-execution.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/reports/enterprise-resilience-implementation-report.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/reports/phase-2-5-1-r2-recovery-release-report.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/reports/production-closure-final-2026-07-29.md | DOCUMENTATION | docs(release) | source gate evidence | INCLUDE | Current production-closure evidence; Git ?? |
| .engineering/reports/production-readiness-validation-2026-07-28.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| .engineering/reports/sofia-enterprise-production-readiness-report.md | DOCUMENTATION | NONE | prior phase evidence | EXCLUDE | Prior-phase framework/report; preserve outside R1 candidate; Git ?? |
| apps/api/src/modules/sofia/ai/deepseek-ai.provider.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/catalog/sofia-commercial-catalog.service.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/crm/ | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/payments/bold-payment.provider.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/privacy/sofia-admin-response-sanitizer.interceptor.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/privacy/sofia-admin-response-sanitizer.interceptor.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/sofia-payment-link.service.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/sofia/whatsapp/whatsapp-provider-idempotency.spec.ts | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/api/src/modules/whatsapp/whatsapp-outbound-safety.spec.ts | OWNER_CHANGE | NONE | WhatsApp safety regression | EXCLUDE | Pre-existing shared WhatsApp changes; cannot stage wholesale; Git ?? |
| apps/web/src/app/(app)/sofia/customers/ | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| apps/web/src/features/sofia/ | OWNER_CHANGE | NONE | Sofia focused regression | EXCLUDE | Pre-existing Sofia/CRM implementation; R1 forbids Sofia redesign/cleanup; Git ?? |
| infra/environments/staging/selfhosted-data/deployment-prep/delivery-phase-a-commit/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| infra/environments/staging/selfhosted-data/deployment-prep/delivery-real-receipt-validation/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| infra/environments/staging/selfhosted-data/deployment-prep/delivery-test-handle-fix/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| infra/environments/staging/selfhosted-data/deployment-prep/sofia-claude-direct-ultra-premium/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| infra/environments/staging/selfhosted-data/deployment-prep/sofia-extreme-live-dashboard/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| infra/environments/staging/selfhosted-data/deployment-prep/sofia-fable5-command-center/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| infra/environments/staging/selfhosted-data/deployment-prep/system-total-audit-final/ | EXCLUDE | NONE | evidence review | EXCLUDE | Historical/generated evidence; not release source; Git ?? |
| infra/release/release-safety.test.mjs | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git ?? |
| infra/release/verify-runtime-identity.mjs | RELEASE_INFRASTRUCTURE | feat(release) | artifact/source safety tests | INCLUDE | Artifact, canary, OCI/runtime and CI release controls; Git ?? |
| infra/testing/.engineering/ | GENERATED_DELETE | NONE | generated/cache checks | EXCLUDE | Regenerable cache; deletion is safe only after owner-work gate; Git ?? |
| prisma/migrations/20260727130000_sofia_crm_bounded_context/ | MIGRATION | fix(migrations) | fresh 3x; upgrade 30->32 | EXCLUDE | Legitimate migrations but inseparable from owner Sofia/CRM schema and implementation; Git ?? |
| prisma/migrations/20260727133000_sofia_payment_webhook_fail_closed/ | MIGRATION | fix(migrations) | fresh 3x; upgrade 30->32 | EXCLUDE | Legitimate migrations but inseparable from owner Sofia/CRM schema and implementation; Git ?? |
| tests/e2e/ephemeral/accessibility.ts | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git ?? |
| tests/e2e/tsconfig.json | TEST | test(release) | ephemeral/Playwright regression | INCLUDE | Release validation harness; review generated evidence separately; Git ?? |

## Blocking Owner/Shared Boundaries

- prisma/schema.prisma contains the CRM bounded context required by migrations 31/32 and unrelated formatting/domain changes.
- pnpm-lock.yaml and package manifests contain broad dependency upgrades outside the release-only changeset.
- apps/api/src/tests/app.critical.spec.ts contains the four closure fixes plus earlier multi-domain harness work.
- Sofia backend/frontend/CRM and WhatsApp shared changes are explicitly owner work and excluded by R1.
- Excluding those paths leaves the source schema and feature implementation inconsistent; including them violates the owner-change and Sofia scope rules.

No index mutation, commit, artifact build or canary deployment is permitted until the owner-work boundary is resolved in a dedicated approved changeset.

