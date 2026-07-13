# Phase 2.1 - Clasificación del working tree

Clasificación basada en el diff real al inicio de Phase 2.1. Ningún archivo fue descartado.

| Archivo | Dominio | Dependencias | Puede separarse | Riesgo | Acción |
|---|---|---|---|---|---|
| .agents/tasks/prd-sofia-ultra-premium.json (M) | UNRELATED | Ninguna directa | No | Alto | Mantener sin stage |
| .claude/scheduled_tasks.lock (M) | UNRELATED | Ninguna directa | No | Alto | Mantener sin stage |
| .gitignore (M) | SHARED_MIXED | Múltiples dominios | Sí con backend Sofía | Bajo | Asociar hygiene al backup Sofía |
| apps/api/jest.config.ts (M) | TEST_HARNESS | API tests/DB test | Sí | Medio | Commit harness seguro |
| apps/api/src/config/env.ts (M) | CONFIG_SECURITY | API/Sofía/WhatsApp | Sí | Alto | Commit hotfix de flags estrictos |
| apps/api/src/modules/orders/delivery-receipt.renderer.ts (M) | DELIVERY | Orders/WhatsApp/tests | Sí | Medio | Commit de corrección Delivery posterior a Phase A |
| apps/api/src/modules/orders/orders.service.ts (M) | DELIVERY | Orders/WhatsApp/tests | Sí | Medio | Commit de corrección Delivery posterior a Phase A |
| apps/api/src/modules/sofia/backups/sofia-backups.service.ts (M) | SOFIA | Sofía API/web | Sí | Alto | Commit backend safety |
| apps/api/src/modules/sofia/governance/sofia-governance.service.ts (M) | SOFIA | Sofía API/web | Sí | Alto | Commit backend safety |
| apps/api/src/modules/sofia/sofia.service.ts (M) | SOFIA | Sofía API/web | Sí | Alto | Commit backend safety |
| apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts (M) | SOFIA | Sofía API/web | Sí | Alto | Commit backend safety |
| apps/api/src/modules/whatsapp/whatsapp.service.ts (M) | WHATSAPP_CORE | Delivery/WhatsApp | Sí | Alto | Commit lifecycle timeout |
| apps/api/src/tests/app.critical.spec.ts (M) | SHARED_MIXED | Múltiples dominios | Por hunks | Alto | Separar hunk Delivery del hunk QR/test |
| apps/api/src/tests/delivery-receipt-phase-a.spec.ts (M) | DELIVERY | Orders/WhatsApp/tests | Sí | Medio | Commit de corrección Delivery posterior a Phase A |
| apps/api/src/tests/helpers/test-data.ts (M) | TEST_HARNESS | API tests/DB test | Sí | Medio | Commit harness seguro |
| apps/web/src/app/(app)/sofia/conversations/page.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/app/(app)/sofia/page.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/app/(app)/sofia/sandbox/page.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/app/(app)/sofia/whatsapp-qr/page.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaCommandCard.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaEmptyState.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaInsightCard.tsx (D) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaMetricCard.tsx (D) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaOperatorConsole.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaPageHero.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaQrStatusPanel.tsx (D) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaReadinessGrid.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaSectionHeader.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaSecurityPanel.tsx (D) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaStatusPill.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaTimeline.tsx (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/index.ts (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/sofia-status-humanize.ts (M) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| .engineering/ARCHITECTURE.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/GLOBAL_STATUS.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/LOOPS.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/MASTER.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/README.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/ROADMAP.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/RULES.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/checkpoints/phase-1-before.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/checkpoints/phase-1-complete.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/api-endpoints.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/api-health.json (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/async-jobs-realtime.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/backend-components.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/branch.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/caja-pos-recovery-trace.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/cd-workflow.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/ci-workflow.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/container-images.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/docker-compose-ps.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/engineering-files-final.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/explicit-any.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/git-status-final.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/git-status.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/head.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/listening-ports.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/migrations.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/mock-placeholder-inventory.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/outside-engineering-status-diff.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/remotes.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/runtime-safe-flags.json (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/sofia-effective-status.json (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/tags.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/timestamp.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/todo-fixme.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/web-health-headers.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-1/web-routes.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/api-health-before.json (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/backups-before-sanitized.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/critical-source-hashes-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/diff-name-status.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/diff-numstat.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/docker-compose-ps-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/git-status-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/images-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/listening-ports-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/release-files-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/remotes.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/staged-status-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/tags.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/timestamp.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/evidence/phase-2-1/web-headers-before.txt (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/api.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/caja.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/dashboard.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/database.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/delivery.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/deployment.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/frontend.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/inventory.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/performance.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/pos.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/security.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/sofia.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/testing.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/uiux.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/users.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/modules/whatsapp.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/reports/phase-1-inventory.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/reports/phase-1-prioritized-backlog.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/reports/phase-1-score-matrix.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| .engineering/reports/phase-2-first-block-plan.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir en changeset documental |
| apps/api/src/config/env.spec.ts (??) | CONFIG_SECURITY | API/Sofía/WhatsApp | Sí | Alto | Commit hotfix de flags estrictos |
| apps/api/src/tests/setup-env.ts (??) | TEST_HARNESS | API tests/DB test | Sí | Medio | Commit harness seguro |
| apps/web/src/components/sofia/SofiaActionMatrix.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaBlockerChecklist.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaConversationCard.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaLiveSignalCard.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaLiveStatusDot.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaPageShell.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaProgressBar.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaReadinessGauge.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaRiskBanner.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaSandboxCaseCard.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaScopeComparison.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaScopeTabs.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| apps/web/src/components/sofia/SofiaSectionCard.tsx (??) | SOFIA | Sofía API/web | Sí | Medio | Commit frontend separado |
| infra/environments/staging/selfhosted-data/deployment-prep/delivery-phase-a-commit/delivery-phase-a-commit-report.md (??) | DELIVERY | Orders/WhatsApp/tests | Sí | Medio | Commit de corrección Delivery posterior a Phase A |
| infra/environments/staging/selfhosted-data/deployment-prep/delivery-real-receipt-validation/delivery-real-receipt-validation-report.md (??) | DELIVERY | Orders/WhatsApp/tests | Sí | Medio | Commit de corrección Delivery posterior a Phase A |
| infra/environments/staging/selfhosted-data/deployment-prep/delivery-test-handle-fix/delivery-test-handle-fix-report.md (??) | DELIVERY | Orders/WhatsApp/tests | Sí | Medio | Commit de corrección Delivery posterior a Phase A |
| infra/environments/staging/selfhosted-data/deployment-prep/engineering-framework-foundation/engineering-framework-foundation-report.md (??) | ENGINEERING_FRAMEWORK | Ninguna directa | Sí | Bajo | Incluir evidencia Phase 0 |
| infra/environments/staging/selfhosted-data/deployment-prep/sofia-claude-direct-ultra-premium/sofia-claude-direct-ultra-premium-report.md (??) | HISTORICAL_REPORT | Ninguna directa | Sí, aislado | Bajo | No mezclar con implementación |
| infra/environments/staging/selfhosted-data/deployment-prep/sofia-extreme-live-dashboard/sofia-extreme-live-dashboard-report.md (??) | HISTORICAL_REPORT | Ninguna directa | Sí, aislado | Bajo | No mezclar con implementación |
| infra/environments/staging/selfhosted-data/deployment-prep/sofia-fable5-command-center/sofia-fable5-command-center-report.md (??) | HISTORICAL_REPORT | Ninguna directa | Sí, aislado | Bajo | No mezclar con implementación |
| infra/environments/staging/selfhosted-data/deployment-prep/system-total-audit-final/system-total-audit-final-report.md (??) | HISTORICAL_REPORT | Ninguna directa | Sí, aislado | Bajo | Incluir con framework si no contiene secretos |

## Decisión inicial

Los changesets separables son framework, Delivery follow-up, configuración/harness, timeout WhatsApp, backend Sofía, frontend Sofía y release foundation. Archivos unrelated e históricos no críticos quedan fuera de commits funcionales.
