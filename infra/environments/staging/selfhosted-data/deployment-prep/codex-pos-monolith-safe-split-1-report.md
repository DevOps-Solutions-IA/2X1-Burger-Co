# CODEX-POS-MONOLITH-SAFE-SPLIT-1 Report

## 1. Resumen ejecutivo

Fase ejecutada como refactor seguro del POS, sin cambios de backend, API, Prisma, payloads, pricing, checkout, caja, recibo, WhatsApp ni estilos visuales intencionales.

Resultado: `apps/web/src/app/(app)/pos/page.tsx` bajó de 2.169 líneas a 1.782 líneas. Se extrajeron los cuatro objetivos de la fase:

- `PosCartPanel`
- `PosDeliveryPanel`
- `PosPaymentPanel`
- `usePosCheckoutOrchestrator`

La reducción neta de esta fase fue de 387 líneas. Desde el monolito original reportado de 2.853 líneas, el archivo quedó reducido en 1.071 líneas.

## 2. Estado recibido desde fase 0

- Fase previa: `CODEX-POS-MONOLITH-SAFE-SPLIT-0: GO CONDICIONADO`.
- `page.tsx` antes de esta fase: 2.169 líneas.
- Componentes ya existentes: `PosProductGrid`, `PosActiveOrdersPanel`, `PosOrderActions`, `PosWhatsappReceiptModal`.
- Helpers/tipos ya existentes: `pos.helpers.ts`, `pos.types.ts`.
- Riesgo residual recibido: mantenibilidad por tamaño del archivo.

## 3. Archivo original y tamaño fase 1

- Archivo: `apps/web/src/app/(app)/pos/page.tsx`
- Líneas antes: 2.169
- Líneas después: 1.782
- Evidencia:
  - `/tmp/codex-pos-monolith-safe-split-1/pos-line-count-before.log`
  - `/tmp/codex-pos-monolith-safe-split-1/pos-line-count-after.log`

## 4. Líneas antes/después

| Archivo | Antes | Después | Cambio |
|---|---:|---:|---:|
| `apps/web/src/app/(app)/pos/page.tsx` | 2.169 | 1.782 | -387 |

## 5. Componentes extraídos

| Componente | Responsabilidad | Estado |
|---|---|---|
| `PosCartPanel` | Items del carrito, cantidades, precios, total, delivery fee visual y total manual existente. | PASS |
| `PosDeliveryPanel` | UI de cliente, teléfono, panel de domicilio, Google suggestions, tarifa, km/min, canCheckout visual. | PASS |
| `PosPaymentPanel` | UI de pagos, métodos, efectivo recibido, cambio, warnings de checkout. | PASS |

## 6. Hook extraído

`apps/web/src/features/pos/hooks/usePosCheckoutOrchestrator.ts`

Conserva la secuencia original:

1. Validar `activeOrderId`.
2. Validar `deliveryCanCheckout` para domicilio.
3. `PATCH /orders/:id`.
4. `PUT /orders/:id/items`.
5. `POST /orders/:id/checkout`.
6. Generar recibo.
7. Enviar WhatsApp si aplica.
8. Reset workspace.
9. Limpiar contexto.
10. Invalidar queries operativas.

No se cambiaron payloads, mensajes de error ni invalidations.

## 7. Helpers/tipos modificados

- No se agregaron helpers nuevos.
- No se duplicaron tipos.
- Se reutilizaron tipos existentes de `pos.types.ts`.
- No se introdujo `any` nuevo en archivos extraídos.

## 8. Qué quedó en `page.tsx`

Quedan en `page.tsx`:

- Queries/mutations globales distintas al checkout.
- Estado local compartido.
- Cálculos de derivación visual.
- Orquestación general de layout.
- Integración con componentes extraídos.

El archivo sigue por encima de la meta ideal de 1.400 líneas, pero ya no contiene los bloques completos de carrito, domicilio, pago ni checkout.

## 9. Confirmación de no cambio funcional

Validado por:

- `phase-delivery-auto-2-pos-display`: PASS.
- `phase-delivery-auto-3-checkout-cash-audit`: PASS.
- `delivery-google-maps-core-0`: PASS.
- `delivery-weather-rain-surcharge-google-0`: PASS.
- `pos-monolith-safe-split-1`: PASS.
- `sys1-auth-refresh-concurrency`: PASS final en reintento aislado.

## 10. Confirmación de no cambio visual

Se generaron screenshots before/after en:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-pos-monolith-safe-split-1/`

No se cambiaron textos visibles, estilos ni layout intencionalmente. Solo se agregaron `data-testid` raíz no visibles para `pos-cart-panel` y `pos-payment-panel`.

## 11. Cart panel

Extraído a:

`apps/web/src/features/pos/PosCartPanel.tsx`

Preserva:

- Cantidades.
- Incrementar/disminuir.
- Eliminar item.
- Edición de precio existente.
- Subtotal/total.
- Delivery fee visual.
- Estado vacío.
- `pos-cart-qty-*`.

## 12. Delivery panel

Extraído a:

`apps/web/src/features/pos/PosDeliveryPanel.tsx`

Preserva:

- Cliente/teléfono.
- Dirección/barrio.
- Google suggestions.
- Estado visual de pricing.
- Tarifa, km, min, zona.
- Can checkout.
- Warnings limpios.
- `pos-delivery-*`.

No se movió ni cambió la mutación de estimate, request key, debounce, Google, Open-Meteo ni local free.

## 13. Payment panel

Extraído a:

`apps/web/src/features/pos/PosPaymentPanel.tsx`

Preserva:

- Múltiples pagos.
- Método de pago.
- Efectivo recibido.
- Cambio.
- Warnings de checkout.
- Bloqueo por pagos insuficientes.

No se cambió la fórmula de pago ni payload final.

## 14. Checkout orchestrator

Extraído a:

`apps/web/src/features/pos/hooks/usePosCheckoutOrchestrator.ts`

Se mantuvo la misma fuente de datos desde `page.tsx` y se preservaron:

- Orden de operaciones.
- Payloads.
- Recibo.
- WhatsApp.
- Reset.
- Invalidations.
- Toasts.

## 15. Recibo

Validado en E2E específico:

- Modal de cobro visible.
- Confirmación de cobro.
- Recibo posterior con acción `Imprimir` visible.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-1/e2e-pos-monolith-safe-split-1.log`
- Screenshot `08-pos-receipt-after.png`.

## 16. WhatsApp

No se cambió la mutación ni el modal WhatsApp.

El hook conserva el envío automático de comprobante para domicilio pagado con teléfono y mantiene el manejo de warning si el envío falla.

## 17. Modales

No se cambiaron `CancelOrderButton` ni `CheckoutOrderButton`.

El E2E específico abrió el modal `Cobrar y cerrar` y capturó evidencia en:

- `07-pos-cancel-modal-centered.png`

El nombre del archivo viene de la lista obligatoria de la fase; la evidencia corresponde al modal de confirmación de cobro.

## 18. data-testid

Preservados:

- `pos-page`
- `pos-search`
- `pos-product-*`
- `order-card-*`
- `pos-cart-qty-*`
- `pos-delivery-*`
- `pos-checkout-*`

Agregados, sin impacto visual:

- `pos-cart-panel`
- `pos-payment-panel`

## 19. Typecheck/build

| Gate | Resultado | Evidencia |
|---|---|---|
| Web typecheck | PASS | `/tmp/codex-pos-monolith-safe-split-1/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-pos-monolith-safe-split-1/web-build.log` |
| API typecheck | PASS | `/tmp/codex-pos-monolith-safe-split-1/api-typecheck.log` |
| API build | PASS | `/tmp/codex-pos-monolith-safe-split-1/api-build.log` |

Nota: el build web reporta warnings `no-explicit-any` preexistentes en varios módulos, incluido POS. Esta fase no introdujo `any` nuevo en archivos extraídos.

## 20. E2E

| Spec | Resultado | Evidencia |
|---|---|---|
| `pos-monolith-safe-split-1.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-1/e2e-pos-monolith-safe-split-1.log` |
| `phase-delivery-auto-2-pos-display.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-1/e2e-pos-display.log` |
| `phase-delivery-auto-3-checkout-cash-audit.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-1/e2e-checkout-cash.log` |
| `delivery-google-maps-core-0.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-1/e2e-google-core.log` |
| `delivery-weather-rain-surcharge-google-0.spec.ts` | PASS | `/tmp/codex-pos-monolith-safe-split-1/e2e-weather-core.log` |
| `sys1-auth-refresh-concurrency.spec.ts` | PASS final | `/tmp/codex-pos-monolith-safe-split-1/e2e-auth-refresh-retry2.log` |

Observación SYS-1:

- Primer intento: timeout en `auth.setup`.
- Segundo intento: fallo transitorio en refresh count.
- Tercer intento aislado: PASS completo 4/4.
- No hubo cambios en auth durante esta fase.

## 21. Health

PASS.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-1/health.log`

Respuesta:

`status=ok`, API ok, database ok.

## 22. Bundle

PASS.

`localhost:4300`: 0 ocurrencias.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-1/bundle-localhost4300.log`

## 23. Docker

PASS.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-1/docker-compose-build-api-web.log`
- `/tmp/codex-pos-monolith-safe-split-1/docker-compose-up-local-after-build.log`

Se recreó el servicio local `web` para validar E2E contra la imagen refactorizada. No hubo despliegue.

## 24. Screenshots

Generadas:

1. `01-pos-overview-before-reference.png`
2. `02-pos-overview-after.png`
3. `03-pos-cart-panel-after.png`
4. `04-pos-delivery-panel-after.png`
5. `05-pos-payment-panel-after.png`
6. `06-pos-checkout-success-after.png`
7. `07-pos-cancel-modal-centered.png`
8. `08-pos-receipt-after.png`
9. `09-pos-mobile-after.png`
10. `10-final-pos-summary.png`

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-1/screenshots-files.log`

## 25. Riesgos residuales

- P3 mantenibilidad: `page.tsx` queda en 1.782 líneas, todavía grande frente a la meta ideal de 1.400.
- Los warnings `any` preexistentes en POS siguen pendientes, pero no fueron ampliados por esta fase.
- Una fase futura puede extraer estado/queries no críticas, datos de comanda y notas rápidas.

## 26. Decisión final

`CODEX-POS-MONOLITH-SAFE-SPLIT-1: GO`

## Tabla final

| Área | Antes | Refactor | Después | Estado | Evidencia |
|---|---|---|---|---|---|
| `page.tsx` | 2.169 líneas | Cart, delivery, payment y checkout extraídos | 1.782 líneas | PASS | `pos-line-count-after.log` |
| Cart | JSX inline | `PosCartPanel` | Props tipadas, testids preservados | PASS | `03-pos-cart-panel-after.png` |
| Delivery | JSX inline | `PosDeliveryPanel` | Estimate/Google/weather intactos | PASS | `04-pos-delivery-panel-after.png`, E2E delivery PASS |
| Payment | JSX inline | `PosPaymentPanel` | Pagos/cambio intactos | PASS | `05-pos-payment-panel-after.png` |
| Checkout | Mutación inline | `usePosCheckoutOrchestrator` | PATCH/PUT/POST/recibo/WhatsApp intactos | PASS | `e2e-checkout-cash.log` |
| Data-testid | Distribuidos inline | Preservados y ampliados con raíces panel | Selectores críticos intactos | PASS | `e2e-pos-monolith-safe-split-1.log` |
| Build | N/A | Validación completa | Web/API PASS | PASS | `web-build.log`, `api-build.log` |
| E2E | N/A | Regresión obligatoria | PASS final | PASS | logs E2E en `/tmp/codex-pos-monolith-safe-split-1/` |
| Runtime | N/A | Health/bundle/docker | Health ok, bundle limpio, Docker build PASS | PASS | `health.log`, `bundle-localhost4300.log`, `docker-compose-build-api-web.log` |
