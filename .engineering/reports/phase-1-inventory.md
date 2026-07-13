# Phase 1 - Inventario total

Fecha: 2026-07-12  
HEAD: `900449425e11e3d9305cb9677192c69a12ee8456`  
Branch: `master`

## Resumen cuantitativo

| Superficie | Cantidad observada | Evidencia |
| --- | ---: | --- |
| Rutas/layouts web | 32 | `evidence/phase-1/web-routes.txt` |
| Decoradores de controladores/endpoints | 278 | `evidence/phase-1/api-endpoints.txt` |
| Services/controllers/gateways/middleware | 81 | `evidence/phase-1/backend-components.txt` |
| Migraciones | 29 | `evidence/phase-1/migrations.txt` |
| Archivos de test | 78 | Inventario `rg --files` Phase 1 |
| Ocurrencias fuente de `any` | 157 | `evidence/phase-1/explicit-any.txt` |
| Warnings `no-explicit-any` en build web | 88 | `evidence/phase-1/web-build.log` |
| Tests criticos ejecutados | 91 PASS | `evidence/phase-1/app-critical.log` |
| Tests Delivery Phase A | 11 PASS | `evidence/phase-1/delivery-phase-a.log` |
| Tests config/delivery unit | 67 PASS | `evidence/phase-1/config-delivery-unit.log` |

## Frontend

Rutas operativas identificadas: dashboard, Caja, POS, mesas, domicilios, inventario, compras, gastos, proveedores, catalogo, usuarios, reportes, configuracion, Sofia, delivery rider, waiter y pagos. Existen rutas separadas de sandbox/pagos mock. El build termina, pero la calidad no es limpia: plugin Next ESLint no detectado y 88 warnings.

## API y backend

Se inventariaron controladores y servicios de auth, users/roles, catalogo, inventory, purchases, sales, cash-register, orders, delivery pricing, reports, realtime, WhatsApp y Sofia. La suite critica valida 91 escenarios. No existe metadata de version de runtime que vincule source, commit e imagen.

## Jobs, timers, colas y realtime

- Realtime usa sockets/eventos internos.
- WhatsApp contiene timeouts, reconnect y operaciones asincronas.
- Frontend waiter mantiene cola local de sincronizacion.
- No se identifico una plataforma de colas durable dedicada en el inventario.
- No existe baseline formal de jobs, retries, dead letters o ownership operacional.

Evidencia: `evidence/phase-1/async-jobs-realtime.txt`.

## PDFs e impresion

Se identificaron comprobante POS, cuenta Delivery vigente/actualizada, reportes diarios y acciones de apertura de blob/impresion. Caja abre `/sales/:id/receipt-pdf`; Delivery usa endpoints de cuenta vigente separados. Los tests Delivery pasan, pero no se ejecutaron operaciones mutantes sobre runtime operativo.

## Caja y recovery

- Reimpresion: `GET /sales/:id/receipt-pdf`, rol `sales.read`.
- Reenvio: `POST /whatsapp/sales/:id/send-receipt`.
- Recuperar venta como comanda: `POST /sales/:id/convert-to-order`, roles admin/cashier/supervisor.
- Reabrir comanda convertida: `POST /sales/:id/reopen-converted-order`, mismos roles.
- Reabrir caja: `POST /cash-register/reopen`, solo admin/supervisor.
- Readiness, summary, operational log e historial tienen endpoints distintos.

La suite valida conversion, reapertura, reversa de stock/caja y bloqueos. Falta E2E efimero que demuestre botones, PDF, auditoria e idempotencia juntos.

## Roles y permisos

Existen JWT guard, roles/permissions y pruebas para admin, cashier, waiter y delivery rider. No existe una matriz automatizada exhaustiva de los 278 decoradores/rutas ni evidencia de branch protection/reviewers.

## Database

PostgreSQL runtime esta healthy y hay 29 migraciones. No se ejecutaron migraciones/reset en Phase 1. Existen scripts backup/restore, pero falta restore drill actual, RTO/RPO y cifrado/custodia obligatorios demostrados.

## Docker, CI y CD

- Contenedores API/web/nginx/postgres healthy, creados en fechas distintas.
- Runtime API declara `development`.
- CI ejecuta build/typecheck/tests; E2E es manual.
- CD es placeholder.
- No hay remotes ni tags visibles.
- No hay OCI labels/commit hash/version endpoint demostrados.
- No puede demostrarse `SOURCE = COMMIT = ARTIFACT = RUNTIME`.

## Observabilidad

Existe health, request ID, logs estructurados basicos, auditoria de negocio y metricas Sofia. No se demuestran tracing distribuido, metrics infra, alert routing, SLO, error budgets ni retencion.

## Seguridad y configuracion

El runtime raw declara send/auto flags false, pero el dashboard efectivo reporta Auto Safe true. QR esta DISCONNECTED y adapter real false. CSP contiene `unsafe-inline` y `unsafe-eval`; `X-Powered-By` esta visible. Se observaron multiples procesos/tunnels y puertos sin ownership documentado.

## Mocks, sandbox y placeholders

Mocks y sandbox existen en tests, providers y rutas dedicadas. No se concluye que sean defectos por presencia; cada uso debe conservar etiqueta y aislamiento. CD contiene un placeholder real y bloqueante. El inventario esta en `evidence/phase-1/mock-placeholder-inventory.txt`.

## TODO/FIXME y codigo muerto

No se confirmaron marcadores TODO/FIXME reales; el unico match textual fue la palabra espanola `TODOS`. Codigo muerto y duplicacion requieren analisis semantico adicional; no se inventaron conteos.

## Working tree y artefactos

El working tree mezcla Delivery, Sofia, test harness, config, componentes eliminados/nuevos y reportes. `.engineering/` es nuevo. No se descarto ningun cambio. La mezcla bloquea un rebuild/deploy seguro.
