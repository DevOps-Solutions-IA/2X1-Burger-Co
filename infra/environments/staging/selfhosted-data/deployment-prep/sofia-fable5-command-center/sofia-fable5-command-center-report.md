# Sofía Fable 5 Command Center — Reporte final

Fecha: 2026-07-10. Repo: `/home/wundah/inventario`, branch `master` (HEAD `54116f4`). Ejecutor: Claude Code (Fable 5). **Nada commiteado** — pendiente de aprobación del owner.

## 1. Auditoría inicial

Documento completo: `/tmp/sofia-fable5-command-center/auditoria-integral.md` (5 tablas obligatorias). Hallazgos clave:

- La base ya era sólida tras las iteraciones previas de esta sesión (centro de mando con control real de pausa/reanudación, alertas, señales vivas, timeline de auditoría, gauge de readiness degradado a sección informativa).
- **Working tree compartido con un workstream ajeno** (`delivery-location-logistics-updated-receipt`): modifica `orders.service.ts` (+222, módulo protegido), `whatsapp.service.ts` y `app.critical.spec.ts` (+360). No es de Sofía, no se tocó, y debe commitearse por separado.
- Bug real de Sofía: `sofia-backups.service.ts` usaba ruta relativa → generó un árbol espurio `apps/api/infra/**` con artefactos de dry-run.
- 4 componentes muertos (0 usos, 0 refs e2e): `SofiaMetricCard`, `SofiaInsightCard`, `SofiaSecurityPanel`, `SofiaQrStatusPanel`.
- 3 estados QR reales sin traducción (`DISABLED`, `RECONNECTING`, `LOGGED_OUT`); los estados `LINKING_FAILED`/`SESSION_CONFLICT` pedidos por el brief **no existen en el backend**.
- Gates de fase hardcodeados intencionalmente (`realOperationEnabled=false`, `allowlistFinalStatus='PENDING'`, `securityCleanupStatus='GO_CONDICIONADO'`) — candados, no bugs.

## 2. Plan

Documento completo: `/tmp/sofia-fable5-command-center/plan-tecnico.md` (10 bloques). Bloques 3 (Conversations), 5 (Sandbox) y 7 (Observabilidad) resultaron "sin cambios de código" tras la auditoría — verificación solamente. Ejecutado en orden: backups/gitignore → labels QR → limpieza de muertos → skeletons/degradación → seguridad → gates → capturas → reporte.

## 3. Cambios backend (esta fase)

- `apps/api/src/modules/sofia/backups/sofia-backups.service.ts`: `resolveWritableBackupDir()` ahora ancla la ruta al root del monorepo (detección por `pnpm-workspace.yaml`, hasta 6 niveles) con fallback a `/tmp/sofia-sanitized-backups`; en contenedor (sin workspace file) cae a tmp, que es lo correcto. `filePathSanitized` ajustado a la nueva resolución.
- `.gitignore`: agregado `apps/api/infra/` para que los artefactos ya generados y futuros no ensucien `git status`.

(Cambios backend previos de la misma sesión, ya reportados en informes anteriores: labels de reason codes, `noSessionAuth`, typo de tilde en `pendingChecks`.)

## 4. Cambios frontend (esta fase)

- `sofia-status-humanize.ts`: diccionario de estados QR completado — `RECONNECTING`→"Reconectando", `LOGGED_OUT`→"Sesión cerrada", `DISABLED`→"Deshabilitado", `FAILED`→"Falló". Ningún estado del type puede renderizar crudo.
- `/sofia/page.tsx`: skeletons de sección (`SectionSkeleton`) para alertas y timeline durante carga, y estados degradados honestos (`DegradedSection`) si esas queries secundarias fallan — el panel ya no oculta silenciosamente una sección caída ni deja huecos mudos.
- Eliminados 4 componentes muertos y sus exports en `index.ts`.

## 5. Endpoints usados o modificados

Ningún endpoint modificado. Consumidos por la UI (todos reales, JWT+roles): `dashboard/summary`, `readiness`, `governance/events`, `alerts` + `alerts/:id/ack`, `governance/pause|resume`, `conversations/inbox` + acciones (`take-over`, `handoff`, `resolve`, `pause`, `resume`, feedback), `whatsapp/qr/*` (status/connect/disconnect/logout/test-inbound/test-send), `sandbox/commercial-message`, `agent/recover-abandoned`. `governance/settings` deliberadamente sin consumidor UI (gate server-side rechaza activación real con auditoría `PHASE_NOT_READY`).

## 6. Componentes creados

En esta fase: ninguno nuevo (el sistema ya cubría la lista de la Fase 7 del brief — mapeo documentado en la Tabla 3 de la auditoría). Netos de la sesión: `SofiaLiveStatusDot`, `SofiaReadinessGauge`, `SofiaLiveSignalCard`, `SofiaScopeComparison`, `SofiaBlockerChecklist`, `SofiaActionMatrix(Card)`, `SofiaProgressBar` (primitiva), `SofiaPageShell`, `SofiaSectionCard`, `SofiaScopeTabs`, `SofiaRiskBanner`, `SofiaConversationCard`, `SofiaSandboxCaseCard`; recuperados y conectados: `SofiaReadinessGrid`, `SofiaTimeline`. Eliminados (muertos): `SofiaMetricCard`, `SofiaInsightCard`, `SofiaSecurityPanel`, `SofiaQrStatusPanel`.

## 7. Datos reales usados

Resumen de dashboard, checklist de readiness (16 checks), eventos de auditoría (gobernanza + decisiones AutoSafe + reglas comerciales), alertas operativas (tabla `operationalAlert`), inbox por scope con teléfonos enmascarados, estado QR en vivo (refetch 15 s), resultados de sandbox (catálogo/prompt/SafetyGuard reales). Evidencia de que el control es real: el timeline registra la reactivación hecha por este agente (12:54 a. m.) y una pausa posterior hecha por un admin (12:57 a. m.) — el estado actual "Pausada" es acción real del owner y **se respetó sin revertir**.

## 8. Datos no disponibles (documentados, no inventados)

- Estados QR `LINKING_FAILED` / `SESSION_CONFLICT`: no existen en `SofiaWhatsappQrConnectionStatus`; agregar diagnóstico de conflicto de sesión requeriría cambio backend (fuera de esta iteración).
- Latencia, costos, tokens y métricas de ejecución IA: sin fuente en backend; no se crearon sistemas nuevos.
- Series históricas para mini-gráficas de tendencia: sin datos suficientes; no se fabricaron.
- Diagnóstico específico de "No se pudo vincular el dispositivo": el gateway expone `lastErrorCode/lastErrorMessage` sanitizados y la página los muestra en detalle técnico; un diagnóstico guiado dedicado queda como pendiente.

## 9. Seguridad

| Check | Resultado | Evidencia |
|---|---|---|
| Flags de activación real en código/env.example | 0 hallazgos | `/tmp/sofia-fable5-command-center/no-real-activation-check.log` |
| `realSendingEnabled/autoReplyEnabled/productionEnabled/whatsappCanMarkPaid` | Todos `false` hardcodeados; `WHATSAPP_QR_ALLOW_REAL_SEND` neutralizado con `&& false` | `sofia.service.ts:263,384-387,498,514-515` |
| Gate server-side de activación | `governance/settings` rechaza `qrRealAllowed/deepSeekRealAllowed/autoSafeProductionAllowed=true` con `BadRequestException` + audit | `sofia-governance.service.ts:397-411` |
| Secretos / QR raw / session auth | 18 coincidencias, todas falsos positivos por nombre de campo o redacción por diseño; 0 reales | `/tmp/sofia-fable5-command-center/secret-check.log` |
| Teléfonos completos en frontend Sofía | Solo `573001112233` (valor de ejemplo del formulario sandbox/test-inbound, no dato de cliente) | grep documentado |
| Pendiente de hardening (documentado) | `GET memory/:phone` devuelve `phoneNormalized` completo; sin consumidor UI; JWT+roles | Auditoría Tabla 5 |

## 10. Pruebas

| Prueba | Resultado | Evidencia |
|---|---|---|
| `pnpm --filter web typecheck` | PASS | ejecución en sesión |
| `pnpm --filter web build` | PASS (warnings `no-explicit-any` preexistentes fuera de Sofía) | `/tmp/sofia-fable5-command-center/web-build.log` |
| `pnpm --filter api typecheck` | PASS | `/tmp/sofia-fable5-command-center/api-typecheck.log` |
| `pnpm --filter api build` | PASS | `/tmp/sofia-fable5-command-center/api-build.log` |
| ESLint focalizado Sofía (`--quiet`) | PASS (0 errores) | ejecución en sesión |
| e2e Playwright Sofía | **NO EJECUTADO — declarado honestamente** | El harness (`prepare-test-db.sh`) ejecuta `prisma migrate reset --force`; el guard de DB `_test` es correcto, pero Prisma bloquea la invocación por agente IA y exige `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`, variable que CLAUDE.md prohíbe usar. No se rodeó el candado. **El owner puede correr `pnpm e2e` directamente.** |
| Deriva de testids en specs e2e | Documentada | Varios specs (`config-panel-redesign`, `governance-panel-3`, etc.) referencian testids de generaciones de UI anteriores a esta sesión (`sofia-config-panel`, `sofia-enterprise-header`, `sofia-kill-switch`); requieren actualización cuando se corran. Deriva preexistente, no introducida ahora. |
| Verificación funcional manual (navegador real) | PASS | Pausa/reanudación E2E contra backend (registrada en auditoría), ack de alertas, procesamiento sandbox, toggle de checklist |

Sin `forceExit`, sin timeouts declarados como éxito.

## 11. Screenshots

8/8 en `/tmp/sofia-fable5-command-center/screenshots/` (desktop 1440×4600 con viewport alto por el scroll interno del layout; mobile 390 full-page): `01-sofia-desktop`, `02-sofia-mobile`, `03/04-conversations`, `05/06-whatsapp-qr`, `07/08-sandbox`. La 01 muestra el estado vivo real: Sofía Pausada (acción del owner), 3 alertas abiertas con botón de reconocer, timeline con los eventos de pausa/reanudación de hoy.

## 12. Archivos modificados (alcance Sofía de esta fase)

- `apps/api/src/modules/sofia/backups/sofia-backups.service.ts`
- `.gitignore`
- `apps/web/src/components/sofia/sofia-status-humanize.ts`
- `apps/web/src/app/(app)/sofia/page.tsx`
- `apps/web/src/components/sofia/index.ts`
- Eliminados: `SofiaMetricCard.tsx`, `SofiaInsightCard.tsx`, `SofiaSecurityPanel.tsx`, `SofiaQrStatusPanel.tsx`

(El resto del diff del working tree corresponde a las iteraciones previas de esta misma sesión, ya reportadas en `sofia-claude-direct-ultra-premium` y `sofia-extreme-live-dashboard`, más el workstream ajeno de delivery-receipts que NO debe mezclarse.)

## 13. Pendientes

1. Correr `pnpm e2e` (owner) — bloqueado para agentes por el candado de Prisma; actualizar specs con testids desactualizados.
2. Hardening de `GET memory/:phone` (full phone en respuesta; sin consumidor UI).
3. Estados de diagnóstico de vinculación (`SESSION_CONFLICT` etc.) requerirían soporte backend en el gateway.
4. Overlap del header global en mobile (`app-shell.tsx`) — preexistente, fuera de alcance Sofía.
5. Encoding "Hamburguesa 2X1�" en seed de catálogo — catálogo es módulo protegido, no se tocó.
6. Al commitear: separar por paths el trabajo de Sofía del workstream `delivery-location-logistics-updated-receipt`.

## 14. Decisión

Las 4 rutas funcionan contra datos reales verificados en navegador; sandbox e histórico separados; estados honestos (incluye skeletons y degradación por sección nuevos); sin mocks presentados como reales; sin secretos; sin activación real (bloqueada además server-side); módulos protegidos intactos (el diff en `orders.service.ts` es de otro workstream, documentado y no tocado); build/typecheck/lint en verde. Lo único no verificable por el agente son los e2e de Playwright, por un candado de seguridad correcto que no se debe rodear — queda como pendiente externo documentado con instrucción exacta para el owner.

**SOFÍA FABLE 5 COMMAND CENTER: GO CONDICIONADO**

Condicionado únicamente por: (a) e2e pendientes de ejecución por el owner (`pnpm e2e`) con specs de generaciones anteriores por actualizar, y (b) los pendientes externos 2-5 ya listados. Ningún condicionante es de seguridad ni de datos falsos.
