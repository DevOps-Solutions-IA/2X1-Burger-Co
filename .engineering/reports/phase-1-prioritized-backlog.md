# Phase 1 - Backlog priorizado

## Formula

`Prioridad = severidad x impacto operativo x impacto financiero x impacto de seguridad x modulos dependientes / esfuerzo`.

Escala de factores: 1 a 5; dependencias usa cantidad de modulos; esfuerzo relativo usa 1 a 5. La clasificacion P0-P3 tambien considera bloqueo critico inmediato, no solo orden numerico.

## Resumen

| ID | Clase | Modulo | Score formula | Problema |
| --- | --- | --- | ---: | --- |
| ENG-P0-001 | P0 | Deployment/Security | 2000 | Release foundation y runtime provenance inexistentes |
| ENG-P0-002 | P0 | Security/Sofia | 833 | Flags efectivos contradicen configuracion raw |
| ENG-P0-003 | P0 | Deployment | 1600 | Sin remote, required checks ni reviewers |
| ENG-P1-001 | P1 | Database/Testing | 960 | No hay plataforma E2E efimera segura |
| ENG-P1-002 | P1 | Database/Deployment | 1250 | Recovery productivo no demostrado |
| ENG-P1-003 | P1 | Security/Users/API | 640 | Matriz RBAC incompleta |
| ENG-P1-004 | P1 | API/Deployment | 614 | Observabilidad/SLO insuficientes |
| ENG-P1-005 | P1 | WhatsApp/Sofia | 400 | QR/allowlist/runtime safety gates pendientes |
| ENG-P2-001 | P2 | Caja/POS | 375 | Recovery/reimpresion sin E2E operacional aislado |
| ENG-P2-002 | P2 | Inventory | 336 | Invariantes/reconciliacion runtime incompletas |
| ENG-P2-003 | P2 | Performance | 307 | Capacidad y concurrencia no demostradas |
| ENG-P3-001 | P3 | Frontend/UIUX | 173 | 157 any y 88 warnings; visual/a11y incompletos |

## ENG-P0-001 - Release Foundation & Runtime Provenance

- Causa: working tree mezclado, artifacts sin labels, CD placeholder y runtime sin version endpoint.
- Evidencia: `evidence/phase-1/git-status.txt`, `container-images.txt`, `cd-workflow.txt`.
- Solucion: separar cambios, artifacts inmutables con commit/SBOM, endpoint version sanitizado, staging/canary y rollback.
- Archivos probables: workflows CI/CD, Dockerfiles, deploy/smoke, metadata API/web, documentacion release.
- Dependencias: todos los modulos.
- Riesgo: desplegar cambios no revisados o validar una version diferente.
- Pruebas: build reproducible, labels, smoke artifact, rollback drill, comparacion source=runtime.
- Aceptacion: cadena completa demostrable y working tree de release limpio.
- Estimacion: XL (5).
- Loop: Architecture -> Implementation -> Validation -> Security -> Production Readiness.

## ENG-P0-002 - Runtime Safety Flag Hotfix

- Causa: imagen activa anterior al parser booleano estricto.
- Evidencia: `runtime-safe-flags.json` vs `sofia-effective-status.json`.
- Solucion: incluir parser seguro en artifact limpio del bloque 001 y desplegar canary.
- Archivos probables: config env, tests config, release metadata.
- Dependencias: Security, Sofia, WhatsApp, Deployment.
- Riesgo: Auto Safe efectivo activo cuando el operador cree que esta OFF.
- Pruebas: flags raw/efectivos, API status, UI, send/PAID/production blocking.
- Aceptacion: todos los flags efectivos coinciden con declarados y permanecen OFF.
- Estimacion: M (3).
- Loop: Audit -> Implementation -> Validation -> Security.

## ENG-P0-003 - Repository Governance

- Causa: no hay remote/tags/protections verificables.
- Evidencia: `remotes.txt`, `tags.txt`.
- Solucion: configurar remote, branch model, reviews, signed releases y required checks.
- Archivos probables: plataforma Git, CODEOWNERS, workflows, reglas de repositorio.
- Dependencias: todos los modulos.
- Riesgo: cambios sensibles sin revision ni trazabilidad.
- Pruebas: PR de prueba bloqueada sin checks/review; tag/release firmado.
- Aceptacion: protecciones verificadas por API/plataforma.
- Estimacion: L (4).
- Loop: Security -> Production Readiness.

## ENG-P1-001 - Ephemeral Test Platform

- Causa: E2E depende de preparacion destructiva y es manual.
- Evidencia: `ci-workflow.txt`; Testing module.
- Solucion: DB/container efimero por run, seeds deterministas y cleanup aislado.
- Archivos probables: Playwright config, test scripts, compose test, CI.
- Dependencias: Caja, POS, Delivery, Inventory, Users, Frontend, Testing, Database.
- Riesgo: UI rota con backend verde o prueba sobre DB incorrecta.
- Pruebas: run paralelo/repetido, guard DB, cero acceso a DB operativa.
- Aceptacion: E2E critical required y no destructivo.
- Estimacion: XL (5).
- Loop: Architecture -> Implementation -> Validation -> Regression.

## ENG-P1-002 - Backup, Restore, RTO/RPO

- Causa: scripts existen sin drill/cifrado obligatorio/custodia demostrada.
- Evidencia: inventario Phase 1.
- Solucion: backup cifrado, offsite, restore drill automatizado y runbook medido.
- Archivos probables: backup/restore, CI scheduled, runbooks, config secrets.
- Dependencias: Database, Deployment, Security y modulos con datos.
- Riesgo: perdida de datos o recuperacion fuera de ventana.
- Pruebas: restore a entorno aislado, checksum, tiempos y verificacion funcional.
- Aceptacion: RPO/RTO acordados y drill PASS.
- Estimacion: L (4).
- Loop: Security -> Validation -> Production Readiness.

## ENG-P1-003 - RBAC Contract Matrix

- Causa: permisos probados por casos, no por superficie completa.
- Evidencia: `api-endpoints.txt`, critical tests.
- Solucion: matriz endpoint/metodo/roles/permisos y tests parametrizados allow/deny.
- Archivos probables: guards/decorators, tests, documentacion API.
- Dependencias: Users, Security, API, Testing.
- Riesgo: endpoint nuevo expuesto por omision.
- Pruebas: deny-by-default y cobertura 100% de rutas sensibles.
- Aceptacion: matriz versionada sin rutas huerfanas.
- Estimacion: L (4).
- Loop: Discovery -> Security -> Validation.

## ENG-P1-004 - Observability and SLO

- Causa: logs/requestId sin metrics/tracing/alert routing de plataforma.
- Evidencia: API/Performance modules y health actual.
- Solucion: OpenTelemetry/metrics, dashboards, SLO, alertas y retencion.
- Archivos probables: bootstrap API, middleware, infra observability, runbooks.
- Dependencias: todos los modulos de runtime.
- Riesgo: fallos no detectados o sin causa rastreable.
- Pruebas: trace E2E, alerta sintetica, cardinalidad y redaccion.
- Aceptacion: SLI/SLO y alertas accionables demostradas.
- Estimacion: XL (5).
- Loop: Performance -> Security -> Production Readiness.

## ENG-P1-005 - WhatsApp/Sofia Controlled Runtime Gate

- Causa: QR desconectado, allowlist pendiente y runtime drift.
- Evidencia: `sofia-effective-status.json`.
- Solucion: despues del artifact trazable, validar receive-only, allowlist, dedup, pause y send/PAID blocking.
- Archivos probables: config/gateway/status UI y runbooks; no cambios comerciales.
- Dependencias: bloques P0, Security, WhatsApp, Sofia.
- Riesgo: mensajes o automatizacion fuera de gate.
- Pruebas: fisicas controladas y read-only DB/audit.
- Aceptacion: CONNECTED/inbound permitido, SENT=0 y flags OFF.
- Estimacion: L (4).
- Loop: Validation -> Security -> Production Readiness.

## ENG-P2-001 - Caja/POS Recovery E2E

- Causa: implementacion/tests backend sin recorrido UI/API/DB/PDF conjunto actual.
- Evidencia: `caja-pos-recovery-trace.txt`.
- Solucion: escenarios efimeros de reprint, convert, reopen, reversal e idempotencia por rol/estado.
- Archivos probables: E2E, contratos UI, endpoints solo si aparece bug.
- Dependencias: Ephemeral Test Platform, Caja, POS, Database.
- Riesgo: doble ingreso, doble stock o comprobante incorrecto.
- Pruebas: reconciliacion antes/despues y auditoria.
- Aceptacion: cada operacion exactamente una vez y recovery reversible.
- Estimacion: L (4).
- Loop: Business Rules -> Validation -> Regression.

## ENG-P2-002 - Inventory Reconciliation

- Causa: cobertura funcional sin reconciliador runtime/invariantes globales.
- Evidencia: critical tests y Inventory module.
- Solucion: invariantes por movimiento, reporte read-only y E2E de compras/recetas/ajustes.
- Archivos probables: inventory services/tests/reporting.
- Dependencias: Database, POS, Testing.
- Riesgo: stock/costo divergente.
- Pruebas: propiedades e idempotencia/concurrencia.
- Aceptacion: cero diferencias no explicadas.
- Estimacion: L (4).
- Loop: Business Rules -> Validation -> Regression.

## ENG-P2-003 - Performance Baseline

- Causa: ausencia de SLO/load/concurrency actuales.
- Evidencia: Performance module.
- Solucion: escenarios no destructivos, baseline y budgets CI.
- Archivos probables: load tests, observability, CI.
- Dependencias: Release Foundation, Observability.
- Riesgo: saturacion desconocida.
- Pruebas: p95/p99, error rate, DB pool y recovery.
- Aceptacion: capacidad documentada y budgets PASS.
- Estimacion: XL (5).
- Loop: Performance -> Regression.

## ENG-P3-001 - Typed Frontend and UI Quality

- Causa: contratos locales con any y lint no bloqueante.
- Evidencia: `explicit-any.txt`, `web-build.log`.
- Solucion: typed client/DTOs, eliminar any por riesgo, lint Next correcto, visual/a11y/mobile.
- Archivos probables: frontend routes/components, ESLint, API contracts, E2E.
- Dependencias: API contracts, Ephemeral Test Platform.
- Riesgo: estados falsos y errores silenciosos.
- Pruebas: lint cero warnings, visual regression, accessibility.
- Aceptacion: cero warnings en rutas criticas y gates required.
- Estimacion: XL (5).
- Loop: Implementation -> Validation -> Regression -> UIUX.
