# Phase 2.5 - Checkpoint inicial

Fecha: 2026-07-14 (America/Bogota)

## Identidad y aislamiento

- Branch: `master`.
- HEAD: `66c54785f6d1383e40f28e66dd825a4db11d6a44`.
- Working tree: contiene cambios heredados de fases anteriores; no se descartan ni se mezclan mediante commit.
- Staging inicial: vacio.
- Commit/push en esta fase: prohibidos.
- Runtime operativo observado: API `4300`, web `3301`, PostgreSQL `5432`.
- Canary preservado: API `4400`, web `3401`, PostgreSQL `55433`.
- Artifact efimero disponible: buildId `0.1.0-66c54785f6d1-phase24-0799d8d57701` para API y web.
- Plataforma de mutacion autorizada: `infra/testing/run-ephemeral-e2e.sh`, con red, volumen, DB y puertos unicos por run.
- DB operativa: fuera de alcance; no se conectara ni mutara.
- WhatsApp real, QR y sesiones reales: no montados en la plataforma efimera.

## Estado recibido

- Phase 2.3 demostro migraciones, seed, contratos, RBAC, smoke y UI base en entorno efimero.
- Phase 2.4 demostro backup/restore/reconciliacion local y observabilidad base.
- El smoke existente cubre operaciones basicas, pero no reconcilia en un mismo escenario recovery, reopen, reversas, concurrencia, idempotencia ni PDF sin side effects.
- `app.critical.spec.ts` contiene cobertura backend relevante, pero no sustituye la traza operativa UI/API/DB de esta fase.

## Inventario funcional inicial

| Dominio | Trigger/API principal | Persistencia | Evidencia existente | Brecha Phase 2.5 |
| --- | --- | --- | --- | --- |
| Caja | `/cash-register/*` | `cash_sessions`, `cash_movements`, auditoria | Smoke de open/close/movement | Reopen, doble operacion, RBAC y reconciliacion profunda |
| POS | `/sales`, receipt, conversion/reopen | ventas, pagos, stock, caja, ordenes | Critical spec y smoke | Exactly-once operacional, recovery y side effects PDF |
| Delivery | `/orders`, delivery receipt/status/history | orden, revision, receipt audit, ubicacion | Delivery Phase A y smoke | Flujo efimero completo, concurrencia y evidencia PDF real |
| Inventory | compras, ajustes, conteos, movimientos | productos/ingredientes/movimientos | Critical spec y smoke | Compra/devolucion equivalente, concurrencia y reconciliacion |
| UI | `/cash`, `/pos`, `/deliveries`, `/inventory` | API real efimera | Navegacion Playwright | Mutaciones operativas y verificacion de side effects |

## Riesgos iniciales

1. La reimpresion es un GET de PDF y debe demostrar cero mutaciones, no solo contenido valido.
2. Recovery y reopen cruzan venta, caja, stock y comanda; cualquier retry debe ser rechazado sin doble aplicacion.
3. Delivery usa revision optimista; debe demostrarse que dos actualizaciones concurrentes no crean versiones duplicadas.
4. Inventario usa locks en ajustes/conteos, pero la prueba debe reconciliar saldos y movimientos.
5. El modelo de auditoria no contiene de forma universal `requestId`, `correlationId` o `idempotencyKey`; se evaluara como hallazgo y no se inventara evidencia.
6. La ausencia de idempotency key explicita en creacion directa de venta puede limitar el gate exactly-once ante retries ambiguos.

## Criterio previo a mutaciones

La ejecucion se abortara si el DB guard no confirma nombre con sufijo `_test`, run ID, puerto efimero y `EPHEMERAL_TEST_MODE=true`. Toda evidencia debe indicar `operationalDatabaseTouched=false`, `productionModified=false` y `realWhatsapp=OFF`.
