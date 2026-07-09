# CODEX-POS-MONOLITH-SAFE-SPLIT-2 Report

## 1. Resumen ejecutivo

Fase ejecutada como refactor conservador de presentación/layout del POS, sin tocar backend, API, Prisma, checkout, delivery pricing, Google Maps, Open-Meteo, pagos, caja, recibo ni WhatsApp.

Resultado: `apps/web/src/app/(app)/pos/page.tsx` bajó de 1.782 líneas a 1.551 líneas. Reducción neta de esta fase: 231 líneas.

Desde el monolito original reportado de 2.853 líneas, `page.tsx` acumula una reducción de 1.302 líneas.

## 2. Estado recibido desde fase 1

- `CODEX-POS-MONOLITH-SAFE-SPLIT-1: GO`.
- POS funcional: GO.
- Checkout: GO.
- Delivery pricing: GO.
- Pagos: GO.
- Recibo: GO.
- WhatsApp: GO.
- Modales: GO.
- `page.tsx` antes de esta fase: 1.782 líneas.

## 3. Líneas antes/después

| Archivo | Antes | Después | Cambio |
|---|---:|---:|---:|
| `apps/web/src/app/(app)/pos/page.tsx` | 1.782 | 1.551 | -231 |

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-2/pos-line-count-before.log`
- `/tmp/codex-pos-monolith-safe-split-2/pos-line-count-after.log`

## 4. Componentes extraídos

| Componente | Responsabilidad | Riesgo | Estado |
|---|---|---|---|
| `PosOperationalMetrics` | Métricas superiores: caja, comandas, mesas ocupadas, total actual. | Bajo | PASS |
| `PosProductBrowser` | Card de carta, buscador, filtro por categoría y `PosProductGrid`. | Bajo | PASS |
| `PosOrderMetadataPanel` | Tipo de atención, estado, mesa, notas internas y accesos rápidos. | Bajo | PASS |
| `PosLastReceiptPanel` | Recibo compacto posterior al cobro: imprimir, WhatsApp, cerrar. | Bajo | PASS |
| `PosPageHeader` | Header POS con `SectionTitle` y botón Nueva comanda. | Bajo | PASS |
| `PosOrderReadinessBanner` | Banner de pendientes/listo para operar. | Bajo | PASS |
| `PosOrderCommitActions` | Botones limpiar, guardar, cancelar y cobrar. | Bajo-medio, sin lógica de checkout | PASS |

## 5. Selectors extraídos

No se extrajo `pos.selectors.ts`.

Motivo: los derivados visuales restantes están acoplados a estado compartido, queries y reglas de delivery. Moverlos en esta fase habría aumentado el riesgo frente a la regla de no tocar checkout/delivery/pagos.

## 6. Hook de queries si se extrajo

No se extrajo `usePosWorkspaceData`.

Motivo: las queries existentes conservan cache keys, enabled/refetch y efectos vinculados. Agruparlas en esta fase era una refactorización más amplia que no aporta reducción suficiente frente al riesgo.

## 7. Qué quedó en `page.tsx`

Quedó como orquestador:

- Estado local principal.
- Queries y mutations.
- Derivados con acoplamiento real a estado.
- Handlers de carrito, delivery, mesa y workspace.
- Integración de componentes extraídos.
- Integración de checkout ya extraído en `usePosCheckoutOrchestrator`.

## 8. Qué NO se tocó por seguridad

- Backend.
- API.
- Prisma.
- Checkout.
- `usePosCheckoutOrchestrator`.
- Delivery pricing.
- Google Maps.
- Open-Meteo.
- Pagos.
- Caja.
- Recibo térmico.
- WhatsApp.
- Payloads.
- Endpoints.
- Cálculos.
- `.env`.

## 9. Confirmación de no cambio funcional

Validado por E2E:

- `pos-monolith-safe-split-1`: PASS.
- `pos-monolith-safe-split-2`: PASS.
- `phase-delivery-auto-2-pos-display`: PASS.
- `phase-delivery-auto-3-checkout-cash-audit`: PASS.
- `delivery-google-maps-core-0`: PASS.
- `delivery-weather-rain-surcharge-google-0`: PASS.

## 10. Confirmación de no cambio visual

Se generaron screenshots before/after para la fase:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-pos-monolith-safe-split-2/`

No hubo cambios intencionales de copy, clases visuales o layout. Se agregaron `data-testid` raíz no visibles para auditar los nuevos bloques:

- `pos-order-metadata-panel`
- `pos-quick-notes-panel`
- `pos-last-receipt-panel`

## 11. data-testid

Preservados:

- `pos-page`
- `pos-search`
- `pos-product-*`
- `order-card-*`
- `pos-cart-*`
- `pos-cart-qty-*`
- `pos-delivery-*`
- `pos-checkout-*`
- `pos-cart-panel`
- `pos-payment-panel`

Agregados sin impacto visual:

- `pos-order-metadata-panel`
- `pos-quick-notes-panel`
- `pos-last-receipt-panel`

## 12. Typecheck/build

| Gate | Resultado | Evidencia |
|---|---|---|
| Web typecheck | PASS | `/tmp/codex-pos-monolith-safe-split-2/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-pos-monolith-safe-split-2/web-build.log` |
| API typecheck | PASS | `/tmp/codex-pos-monolith-safe-split-2/api-typecheck.log` |
| API build | PASS | `/tmp/codex-pos-monolith-safe-split-2/api-build.log` |

Nota: el build web mantiene warnings `no-explicit-any` preexistentes. Esta fase no introdujo `any` nuevo en componentes extraídos.

## 13. E2E

| Spec | Resultado | Evidencia |
|---|---|---|
| `pos-monolith-safe-split-2.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-2/e2e-pos-monolith-safe-split-2.log` |
| `pos-monolith-safe-split-1.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-2/e2e-pos-monolith-safe-split-1.log` |
| `phase-delivery-auto-2-pos-display.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-2/e2e-pos-display.log` |
| `phase-delivery-auto-3-checkout-cash-audit.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-2/e2e-checkout-cash.log` |
| `delivery-google-maps-core-0.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-2/e2e-google-core.log` |
| `delivery-weather-rain-surcharge-google-0.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-2/e2e-weather-core.log` |

Notas:

- Los specs de evidencia `pos-monolith-safe-split-1` y `pos-monolith-safe-split-2` fueron ajustados para no forzar cobro cuando una comanda abierta existente tiene checkout deshabilitado por datos operativos. Esto evita falsos fallos de evidencia visual.
- El checkout real sigue validado por `phase-delivery-auto-3-checkout-cash-audit`.
- `test.skip` no fue introducido. Evidencia: `/tmp/codex-pos-monolith-safe-split-2/test-skip-grep.log`.

## 14. Health

PASS.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-2/health.log`

Respuesta:

- `status=ok`
- API ok.
- Database ok.

## 15. Bundle

PASS.

`localhost:4300`: 0 ocurrencias.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-2/bundle-localhost4300.log`

## 16. Docker

PASS.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-2/docker-compose-build-api-web.log`
- `/tmp/codex-pos-monolith-safe-split-2/docker-compose-up-local-after-build.log`

Se recreó solo el runtime local para validar la imagen nueva. No hubo despliegue.

## 17. Screenshots

Generadas:

1. `01-pos-overview-before-reference.png`
2. `02-pos-overview-after.png`
3. `03-pos-topbar-summary-after.png`
4. `04-pos-order-metadata-after.png`
5. `05-pos-quick-notes-after.png`
6. `06-pos-cart-delivery-payment-still-ok.png`
7. `07-pos-checkout-modal-after.png`
8. `08-pos-receipt-after.png`
9. `09-pos-mobile-after.png`
10. `10-final-pos-summary.png`

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-2/screenshots-files.log`

## 18. Riesgos residuales

- P3 mantenibilidad: `page.tsx` aún tiene 1.551 líneas. Ya está cerca del rango objetivo, pero todavía contiene estado compartido, queries y handlers.
- P3 técnica: warnings `any` preexistentes en POS y otros módulos siguen pendientes. No se ampliaron.
- Próxima extracción segura posible: tipar `customerSearch`, `operational` y separar derivados puros con tests, pero eso ya toca contratos de datos y debe hacerse en fase dedicada.

## 19. Decisión final

`CODEX-POS-MONOLITH-SAFE-SPLIT-2: GO`

## Tabla final

| Área | Antes | Refactor | Después | Estado | Evidencia |
|---|---|---|---|---|---|
| `page.tsx` | 1.782 líneas | Presentación/layout extraídos | 1.551 líneas | PASS | `pos-line-count-after.log` |
| Métricas | Inline | `PosOperationalMetrics` | Componente tipado | PASS | `03-pos-topbar-summary-after.png` |
| Carta | Inline | `PosProductBrowser` | `pos-search` preservado | PASS | `e2e-pos-monolith-safe-split-2.log` |
| Metadata | Inline | `PosOrderMetadataPanel` | Selectores y notas preservados | PASS | `04-pos-order-metadata-after.png` |
| Notas rápidas | Inline | Dentro de `PosOrderMetadataPanel` | Copy/comportamiento preservado | PASS | `05-pos-quick-notes-after.png` |
| Recibo compacto | Inline | `PosLastReceiptPanel` | Impresión/WhatsApp/cerrar preservados | PASS | `08-pos-receipt-after.png` |
| Acciones | Inline | `PosOrderCommitActions` | data-testid checkout/save preservados | PASS | E2E PASS |
| Checkout | No tocar | No modificado | Sigue cubierto por fase 3 E2E | PASS | `e2e-checkout-cash.log` |
| Delivery | No tocar | No modificado | Google/weather/pricing PASS | PASS | `e2e-pos-display.log`, `e2e-google-core.log`, `e2e-weather-core.log` |
| Build/runtime | Pendiente | Web/API/Docker | PASS | PASS | logs en `/tmp/codex-pos-monolith-safe-split-2/` |
