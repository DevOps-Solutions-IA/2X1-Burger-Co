# PHASE-DELIVERY-AUTO-3 — Checkout Cash Audit

## 1. Resumen ejecutivo

PHASE-DELIVERY-AUTO-3 cerró el flujo automático de domicilios desde POS hasta checkout, Sale, Caja y auditoría. Se bloqueó el vector restante de inyección por `POST /sales` directo con canal `DOMICILIO`, se reforzó checkout para exigir snapshot automático auditable, se mostró `deliveryFee` en Caja sin recalcularlo, se vinculó `DeliveryPricingAudit` con comanda y venta usando campos existentes, y se archivaron los E2E manual-first fuera del gate principal.

Decisión: **GO**.

## 2. Estado recibido

- CLEAN-DELIVERY-UI-DEEPSEEK-0: GO.
- PHASE-DELIVERY-AUTO-1 BACKEND ENGINE: GO.
- PHASE-DELIVERY-AUTO-2 POS DISPLAY ONLY: GO.
- SYS-1 AUTH SESSION SINGLE-FLIGHT REFRESH: GO.

## 3. Flujo punta a punta actual

- POS captura domicilio y muestra estimate automático.
- `OrdersService.resolveDeliverySnapshot` llama al motor backend y persiste snapshot en `OrderTicket`.
- Checkout de comanda usa únicamente `OrderTicket.deliveryFee` y metadata backend.
- `SalesService.createInTransaction` recibe la venta desde checkout con `orderTicketId`.
- Caja lee `Sale.deliveryFee` final; no recalcula ni usa fee manual.

## 4. Checkout hardening

Archivo: `apps/api/src/modules/orders/orders.service.ts`.

- Checkout DELIVERY solo permite `LOCAL_FREE` o `AUTO_PRICED`.
- Checkout DELIVERY bloquea `deliveryRequiresManualQuote`.
- Checkout DELIVERY exige fee finito.
- Checkout DELIVERY ahora exige `deliveryCalculationVersion` y `deliveryPricingBreakdown`.
- Al crear/actualizar comanda se vincula `DeliveryPricingAudit.orderTicketId`.
- Al checkout se vincula `DeliveryPricingAudit.saleId`.

## 5. Sale metadata

Archivo: `apps/api/src/modules/sales/sales.service.ts`.

- `deliveryFee` final se guarda desde snapshot backend.
- `deliveryFeeSuggested`, `deliveryFeeEdited`, `deliveryFeeEditReason`, `deliveryDistanceKm`, `deliveryZoneLabel`, `deliveryPricingBreakdown` y `deliveryCalculationVersion` se conservan en `Sale`.
- Campos legacy manuales permanecen audit-only.
- No se agregaron columnas nuevas en esta fase.

## 6. Cash deliveryFee

Archivo: `apps/web/src/app/(app)/cash/page.tsx`.

- Caja muestra una línea `Domicilio COP X` para ventas `DOMICILIO`.
- La línea usa `Sale.deliveryFee`.
- Caja no recalcula tarifa.
- Caja no muestra banner rojo con metadata delivery.
- Metadata legacy `null` no bloquea la pantalla.

## 7. Anti-injection

Archivo: `apps/api/src/modules/sales/sales.service.ts`.

- `POST /sales` con `channel=DOMICILIO` sin `orderTicketId` ahora responde 400.
- Esto bloquea inyección directa de `deliveryFee` falso.
- La vía operativa de domicilio queda obligada a pasar por comanda con snapshot backend.

Prueba agregada: `apps/api/src/tests/app.critical.spec.ts`.

## 8. Legacy E2E cleanup

Movidos a referencia histórica fuera de `*.spec.ts`:

- `tests/e2e/legacy/audit8g0-delivery-domain-reset.legacy.ts`
- `tests/e2e/legacy/audit8g2-delivery-final.legacy.ts`
- `tests/e2e/legacy/audit8g11i-screenshots-final.legacy.ts`

Motivo: documentaban flujo manual-first anterior y no deben ser gate principal del modelo automático.

## 9. Tests activos

Gate principal automático:

- `tests/e2e/phase-delivery-auto-2-pos-display.spec.ts`
- `tests/e2e/phase-delivery-auto-3-checkout-cash-audit.spec.ts`
- `tests/e2e/sys1-auth-refresh-concurrency.spec.ts`

## 10. Tests legacy archivados/reescritos

- `audit8g0-delivery-domain-reset.spec.ts`: archivado como legacy.
- `audit8g2-delivery-final.spec.ts`: archivado como legacy.
- `audit8g11i-screenshots-final.spec.ts`: archivado como legacy.
- Reemplazo operativo: `phase-delivery-auto-3-checkout-cash-audit.spec.ts`.

## 11. Buildx risk

Evidencia: `/tmp/phase-delivery-auto-3/docker-buildx.log`.

- Docker buildx local: `v0.11.2`.
- Docker Compose: `v2.40.3-desktop.1`.
- Riesgo P2: `docker compose build web` sigue condicionado por buildx local antiguo si el pipeline exige buildx >= 0.17.
- No se instalaron herramientas globales ni se tocó producción.
- Para E2E local se sincronizó build compilado con contenedores mediante `docker compose cp` y restart controlado.

## 12. API typecheck/build/test

- API typecheck: PASS.
- API build: PASS.
- API tests: PASS, 12 suites / 201 tests.
- Evidencia:
  - `/tmp/phase-delivery-auto-3/api-typecheck.log`
  - `/tmp/phase-delivery-auto-3/api-build.log`
  - `/tmp/phase-delivery-auto-3/api-test.log`

## 13. Web typecheck/build

- Web typecheck: PASS.
- Web build: PASS.
- Warnings residuales: `no-explicit-any` existentes, no bloqueantes.
- Evidencia:
  - `/tmp/phase-delivery-auto-3/web-typecheck.log`
  - `/tmp/phase-delivery-auto-3/web-build.log`

## 14. E2E POS display regression

- `phase-delivery-auto-2-pos-display.spec.ts`: PASS.
- Evidencia: `/tmp/phase-delivery-auto-3/e2e-pos-display-regression.log`.

## 15. E2E checkout/cash/audit

- `phase-delivery-auto-3-checkout-cash-audit.spec.ts`: PASS.
- Valida:
  - LOCAL_FREE punta a punta.
  - AUTO_PRICED fixture confiable con Sale/Caja.
  - NEEDS_ADDRESS_CORRECTION bloqueado.
  - PROVIDER_UNAVAILABLE bloqueado.
  - Anti-injection directo por `/api/sales`.
  - Caja sin banner rojo.
  - Caja muestra deliveryFee backend.
- Evidencia: `/tmp/phase-delivery-auto-3/e2e-checkout-cash-audit.log`.

## 16. SYS-1 regression

- `sys1-auth-refresh-concurrency.spec.ts`: PASS.
- Ajuste de harness: `playwright.noserver.config.ts` y `auth.setup.ts` ahora generan storage state aislado por ejecución local, evitando contaminación por `local-noserver`.
- Evidencia: `/tmp/phase-delivery-auto-3/e2e-sys1-auth.log`.

## 17. Health

- `curl http://localhost/api/health`: PASS.
- Evidencia: `/tmp/phase-delivery-auto-3/health.log`.

## 18. Bundle localhost

- `grep -R "localhost:4300" apps/web/.next`: 0 ocurrencias.
- Evidencia: `/tmp/phase-delivery-auto-3/bundle-localhost4300.log`.

## 19. Screenshots

Directorio: `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/phase-delivery-auto-3/`.

| Screenshot | Existe | Tamaño | Qué demuestra |
| --- | --- | ---: | --- |
| `01-local-free-checkout.png` | Sí | 120968 | Checkout local free habilitado |
| `02-local-free-cash.png` | Sí | 99984 | Caja muestra domicilio COP 0 |
| `03-auto-priced-checkout.png` | Sí | 127610 | UI muestra AUTO_PRICED fixture |
| `04-auto-priced-cash.png` | Sí | 100361 | Caja muestra fee calculado |
| `05-address-correction-blocked.png` | Sí | 111742 | Dirección ambigua bloqueada |
| `06-provider-unavailable-blocked.png` | Sí | 110731 | Provider unavailable bloqueado |
| `07-anti-injection-rejected.png` | Sí | 110731 | Estado tras rechazo anti-inyección |
| `08-cash-no-banner.png` | Sí | 100361 | Caja sin banner rojo |
| `09-sale-delivery-metadata.png` | Sí | 100361 | Venta domicilio visible en Caja |
| `10-final-summary.png` | Sí | 98718 | Resumen final estable |

Evidencia: `/tmp/phase-delivery-auto-3/screenshots-list.log`.

## 20. Riesgos residuales

- P2: build reproducible Docker local sigue condicionado por buildx v0.11.2.
- P2: `Sale` no tiene columnas separadas para `deliveryPricingStatus`, `deliveryPricingConfidence`, providers ni `auditId`; se conserva trazabilidad mediante `DeliveryPricingAudit.orderTicketId/saleId`, `Sale.deliveryPricingBreakdown`, `Sale.deliveryCalculationVersion` y relación `Sale.orderTicketId`.
- P3: warnings frontend `no-explicit-any` existentes.

## 21. Qué queda para PHASE-DELIVERY-AUTO-4

- Resolver buildx/pipeline reproducible.
- Evaluar migración no destructiva para duplicar en `Sale` campos separados de status/confidence/providers/auditId si negocio lo exige para reporting sin join.
- Limpieza gradual de tipos `any` no críticos.

## 22. Decisión final

**PHASE-DELIVERY-AUTO-3 CHECKOUT CASH AUDIT: GO**
