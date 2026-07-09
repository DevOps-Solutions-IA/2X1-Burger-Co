# CODEX-POS-MONOLITH-SAFE-SPLIT-0

## 1. Resumen ejecutivo

Se ejecutó un refactor seguro del POS sin cambiar backend, endpoints, payloads, pricing, checkout, caja, WhatsApp, recibo, modales ni `data-testid` críticos. El archivo `apps/web/src/app/(app)/pos/page.tsx` bajó de **2.853** a **2.169** líneas mediante extracción de tipos, helpers puros y componentes leaf de bajo riesgo.

La decisión final es **GO CONDICIONADO**: todos los gates funcionales pasaron, pero `page.tsx` todavía supera la meta ideal de 700 líneas. La deuda restante se limita a mantenibilidad: extraer cart, delivery panel, payment panel y checkout orchestration en una fase posterior más focalizada.

## 2. Estado recibido desde auditoría POS

- POS funcional: GO.
- Checkout: PASS.
- Delivery pricing: PASS.
- Pagos múltiples: PASS.
- Recibo térmico/WhatsApp: PASS.
- Modales centrados: PASS.
- Caja/Dashboard cache: PASS.
- Bundle limpio y health PASS.
- Único hallazgo: monolito de mantenibilidad en `pos/page.tsx`.

## 3. Archivo original y tamaño

| Archivo | Antes | Después | Cambio |
|---|---:|---:|---:|
| `apps/web/src/app/(app)/pos/page.tsx` | 2.853 líneas | 2.169 líneas | -684 líneas |

## 4. Componentes extraídos

| Componente | Responsabilidad | Riesgo | Estado |
|---|---|---|---|
| `PosProductGrid.tsx` | Grilla visual de productos y badges de stock | Bajo | PASS |
| `PosActiveOrdersPanel.tsx` | Lista de pedidos abiertos con scroll y selección | Bajo | PASS |
| `PosOrderActions.tsx` | Botones de cancelar y cobrar con `ConfirmDialog` | Bajo | PASS |
| `PosWhatsappReceiptModal.tsx` | Modal de envío de comprobante por WhatsApp | Bajo | PASS |

## 5. Hooks extraídos

No se extrajeron hooks en esta fase. Los hooks actuales están muy acoplados a checkout, delivery pricing, cache invalidation y estado compartido del workspace. Se mantuvieron en `page.tsx` para evitar cambios funcionales.

## 6. Helpers extraídos

| Helper | Contenido | Estado |
|---|---|---|
| `pos.helpers.ts` | currency input, payments parsing, distribución de totales, snippets, labels, visual de tipo de pedido | PASS |
| `pos.types.ts` | tipos POS, productos, pagos, pedidos, delivery, WhatsApp, mesas, ventas | PASS |

## 7. Qué quedó en `page.tsx`

Quedó como orquestador principal:

- queries y mutations,
- estado local compartido,
- checkout payload,
- delivery pricing request/response handling,
- payments state,
- cart state,
- receipt creation,
- cache invalidation,
- integración POS con mesas, caja y WhatsApp.

## 8. Líneas antes/después

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-0/pos-line-count-before.log`
- `/tmp/codex-pos-monolith-safe-split-0/pos-line-count-after.log`

## 9. Confirmación de no cambio funcional

No se cambiaron:

- endpoints,
- payloads,
- delivery pricing,
- checkout,
- pagos,
- caja,
- recibo,
- WhatsApp,
- auth,
- Google Maps,
- Open-Meteo,
- `data-testid` críticos.

## 10. Confirmación de no cambio visual

Los componentes extraídos conservaron el mismo JSX, clases Tailwind, textos visibles y estructura semántica. Se generaron screenshots before/after.

## 11. Checkout

Validado por `phase-delivery-auto-3-checkout-cash-audit.spec.ts`: PASS.

Flujo protegido:

1. Validación de pedido activo.
2. Validación de delivery `canCheckout`.
3. Guardado de orden/items.
4. Checkout.
5. Recibo.
6. Cache refresh.

## 12. Delivery pricing

Validado por:

- `phase-delivery-auto-2-pos-display.spec.ts`: PASS.
- `delivery-google-maps-core-0.spec.ts`: PASS.
- `delivery-weather-rain-surcharge-google-0.spec.ts`: PASS.

Sin cambios en cálculo ni payloads.

## 13. Pagos

Validado por checkout/cash E2E. No se modificó:

- método de pago,
- recibido,
- cambio,
- pagos múltiples,
- bloqueo por saldo/diferencia.

## 14. Recibo

Se mantuvo `ThermalReceiptData`, `printThermalReceipt` y mapeo de venta a recibo. El modal WhatsApp solo fue movido a componente leaf.

## 15. WhatsApp

`PosWhatsappReceiptModal.tsx` conserva:

- estado de sesión,
- QR,
- actualizar QR,
- desvincular,
- envío de comprobante,
- cierre por overlay/Escape.

## 16. Modales

`CancelOrderButton` y `CheckoutOrderButton` se movieron a `PosOrderActions.tsx` con el mismo `ConfirmDialog`, textos, confirm labels y centrado.

## 17. data-testid

Se preservaron los `data-testid` críticos:

- `pos-product-*`,
- `order-card-*`,
- `pos-cart-qty-*`,
- `pos-delivery-*`,
- `pos-checkout-*`,
- `pos-page`,
- `pos-search`.

## 18. Typecheck/build

| Gate | Resultado | Evidencia |
|---|---|---|
| Web typecheck | PASS | `/tmp/codex-pos-monolith-safe-split-0/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-pos-monolith-safe-split-0/web-build.log` |
| API typecheck | PASS | `/tmp/codex-pos-monolith-safe-split-0/api-typecheck.log` |
| API build | PASS | `/tmp/codex-pos-monolith-safe-split-0/api-build.log` |

## 19. E2E

| Spec | Resultado |
|---|---|
| `phase-delivery-auto-2-pos-display.spec.ts` | PASS |
| `phase-delivery-auto-3-checkout-cash-audit.spec.ts` | PASS |
| `delivery-google-maps-core-0.spec.ts` | PASS |
| `delivery-weather-rain-surcharge-google-0.spec.ts` | PASS |
| `sys1-auth-refresh-concurrency.spec.ts` | PASS |
| `pos-monolith-safe-split-screenshots.spec.ts` | PASS |

Nota: el primer intento de SYS-1 falló por `ECONNREFUSED` mientras Nginx estaba reiniciando tras `docker compose up`; con health OK, el rerun pasó 4/4.

## 20. Health

Health final: PASS.

Evidencia: `/tmp/codex-pos-monolith-safe-split-0/health.log`.

## 21. Bundle

`grep -R "localhost:4300" apps/web/.next` devolvió 0 ocurrencias.

Evidencia: `/tmp/codex-pos-monolith-safe-split-0/bundle-localhost4300.log`.

## 22. Docker

`docker compose build api web` PASS. Runtime local recreado y healthy.

Evidencia:

- `/tmp/codex-pos-monolith-safe-split-0/docker-compose-build-api-web.log`
- `/tmp/codex-pos-monolith-safe-split-0/docker-compose-up-after-build.log`

## 23. Screenshots

Generadas en:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-pos-monolith-safe-split-0/`

Archivos:

1. `01-pos-overview-before-reference.png`
2. `02-pos-overview-after.png`
3. `03-pos-product-grid-after.png`
4. `04-pos-cart-panel-after.png`
5. `05-pos-delivery-estimate-after.png`
6. `06-pos-payment-modal-after.png`
7. `07-pos-cancel-modal-centered.png`
8. `08-pos-receipt-after.png`
9. `09-pos-mobile-after.png`
10. `10-final-pos-summary.png`

## 24. Riesgos residuales

- `page.tsx` sigue grande: 2.169 líneas.
- No se extrajeron hooks críticos por riesgo de alterar checkout/delivery/caja.
- Próxima fase recomendada: extraer `PosCartPanel`, `PosDeliveryPanel`, `PosPaymentPanel` y un hook `usePosCheckoutOrchestrator` con pruebas dedicadas.

## 25. Decisión final

**CODEX-POS-MONOLITH-SAFE-SPLIT-0: GO CONDICIONADO**

Motivo: refactor funcionalmente seguro y gates PASS, pero reducción no alcanza la meta ideal de menos de 700 líneas.

## Tabla final

| Área | Antes | Refactor | Después | Estado | Evidencia |
|---|---|---|---|---|---|
| `pos/page.tsx` | 2.853 líneas | Tipos, helpers y componentes leaf extraídos | 2.169 líneas | GO CONDICIONADO | `pos-line-count-after.log` |
| Productos | JSX inline | `PosProductGrid` | UI y `pos-product-*` preservados | PASS | `03-pos-product-grid-after.png` |
| Pedidos abiertos | JSX inline | `PosActiveOrdersPanel` | Scroll y `order-card-*` preservados | PASS | E2E POS |
| Acciones | Botones inline | `PosOrderActions` | Modales confirm preservados | PASS | `07-pos-cancel-modal-centered.png` |
| WhatsApp | Modal inline | `PosWhatsappReceiptModal` | QR/envío/cierre preservados | PASS | `08-pos-receipt-after.png` |
| Delivery | Sin cambio | No se tocó cálculo/payload | PASS | `e2e-pos-display.log` |
| Checkout/caja | Sin cambio | No se tocó flujo | PASS | `e2e-checkout-cash.log` |
| Auth | Sin cambio | SYS-1 rerun PASS | PASS | `e2e-auth-refresh.log` |
| Build/bundle/docker | Requerido | Gates ejecutados | PASS | `/tmp/codex-pos-monolith-safe-split-0/` |
