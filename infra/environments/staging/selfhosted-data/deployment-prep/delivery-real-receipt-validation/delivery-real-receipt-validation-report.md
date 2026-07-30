# Delivery real receipt validation

Fecha: 2026-07-11  
Decisión: **NO-GO**

## 1. Resumen ejecutivo

Se validó el flujo real de `/deliveries` con una orden DELIVERY controlada creada mediante los endpoints operativos, geocodificación real y tarifa persistida del sistema. El botón `Ver cuenta vigente` consume correctamente `GET /orders/:id/delivery-receipt`; no usa el comprobante POS ni un `about:blank`.

El runtime inicial estaba obsoleto: el contenedor API servía el renderer Delivery anterior. Tras reconstruir API, el endpoint real entregó el diseño Phase A. La inspección detectó y corrigió dos problemas de datos: se imprimían dirección/teléfono seed provisionales y se mostraba Nequi aunque la orden no tuviera método de pago.

La cuenta inicial y la actualizada pasan validación textual y visual. La ubicación logistics-only conserva pricing y versión comercial. Los cuatro typecheck/build pasan. No obstante, el spec completo `delivery-receipt-phase-a.spec.ts` pasa sus assertions pero Jest no termina por un handle Prisma persistente. Se agotaron tres iteraciones sin `forceExit`; por el criterio explícito, el cierre es NO-GO.

## 2. Comprobante observado y causa

La cadena exacta `COMPROBANTE OPERATIVO POS` solo existe en `apps/api/src/modules/sales/sales.service.ts` y corresponde a `GET /sales/:id/receipt-pdf`. Por tanto, la imagen observada era **POS**, no la cuenta Delivery Phase A.

Había además un desfase de build: el contenedor API previo contenía el renderer antiguo incrustado en `orders.service.js`, sin `delivery-receipt.renderer.js` ni `dist/assets/brand-logo.png`.

| Elemento | Imagen observada | Resultado requerido | Estado |
| --- | --- | --- | --- |
| Tipo | Comprobante operativo POS | Cuenta de domicilio | Corregido/trazado |
| Versión | Ausente | VERSIÓN 1/2 | PASS |
| Vigencia | Ausente | VIGENTE | PASS |
| Totales | Ambiguos | Productos + domicilio + total | PASS |
| Logo | Incorrecto/ausente | Logo gráfico 2X1 | PASS |
| Datos seed | Presentes | Omitidos | PASS |

## 3. Rutas y comprobantes

| Flujo | Endpoint usado | Comprobante generado | Estado |
| --- | --- | --- | --- |
| POS PDF | `GET /sales/:id/receipt-pdf` | Comprobante operativo POS | Conservado; no usado por Delivery |
| POS HTML | `printThermalReceipt()` | Popup de impresión | Conservado; no usado por Delivery |
| `/deliveries` | `GET /orders/:id/delivery-receipt` | Cuenta Delivery vigente | PASS |
| Estado | `GET /orders/:id/delivery-receipt-status` | Versión/estado/envío | PASS |
| Historial | `GET /orders/:id/delivery-receipt-history` | ACTIVE/REPLACED | PASS |
| Ubicación | `POST /orders/delivery-location-inbox/:id/resolve` | Logistics-only | PASS |

La traza producida por la interacción real del botón está en `/tmp/delivery-real-receipt-validation/evidence/route-trace.md`.

## 4. Correcciones aplicadas

1. `delivery-receipt.renderer.ts`: omite placeholders seed conocidos de dirección/teléfono y evita mostrarlos incluso si llegan al renderer.
2. `orders.service.ts`: normaliza contacto antes de construir QR; un placeholder no genera QR ni aparece en PDF.
3. `orders.service.ts`: el método de pago se imprime solo si existe en la orden; una orden manual sin método ya no inventa Nequi.
4. `delivery-receipt-phase-a.spec.ts`: pruebas de placeholders y método de pago; restauración explícita de mocks y desconexión Prisma en teardown (el handle residual persiste).

No se modificaron `/deliveries`, pricing, ubicación logistics-only, POS, Caja, Stock, Checkout, Sofía ni flags.

| Archivo | Cambio | Motivo |
| --- | --- | --- |
| `apps/api/src/modules/orders/delivery-receipt.renderer.ts` | Normalización defensiva | Omitir datos seed provisionales |
| `apps/api/src/modules/orders/orders.service.ts` | Contacto y pago basados en datos reales | No inventar datos ni QR placeholder |
| `apps/api/src/tests/delivery-receipt-phase-a.spec.ts` | Casos focalizados y teardown | Cubrir regresión e investigar handle |

## 5. Cuenta inicial real

Orden final controlada: `DOMICILIO-1206`. Producto activo persistido: Hamburguesa 2X1; subtotal productos COP 20.000, tarifa real calculada/persistida COP 8.000, total COP 28.000.

| PDF | Criterio | Resultado | Evidencia |
| --- | --- | --- | --- |
| Inicial | Cuenta de domicilio | PASS | `initial-real.pdf/png` |
| Inicial | VERSIÓN 1 / VIGENTE | PASS | texto extraído |
| Inicial | Logo original | PASS visual | `initial-real.png` |
| Inicial | Sin placeholders | PASS | check negativo |
| Inicial | 58 mm / una página | PASS | MediaBox 164.4097 pt / Count 1 |

## 6. Cuenta actualizada real

Se cambió la cantidad de 1 a 2 mediante `PUT /orders/:id/items`. El fee permaneció en COP 8.000; productos pasaron a COP 40.000 y total a COP 48.000. La versión 1 quedó REPLACED y la versión 2 ACTIVE.

| Total | Productos | Domicilio | Total | Estado |
| --- | ---: | ---: | ---: | --- |
| Inicial | COP 20.000 | COP 8.000 | COP 28.000 | PASS |
| Actualizada | COP 40.000 | COP 8.000 | COP 48.000 | PASS |

El PDF muestra `CUENTA ACTUALIZADA DE DOMICILIO`, `VERSIÓN 2`, `VIGENTE` y la nota de reemplazo. El estado de envío es FAILED porque el canal estaba desconectado; no se informó éxito falso ni se realizó envío.

## 7. Ubicación logistics-only

Se creó una entrada controlada de inbox y se resolvió por el endpoint operativo. Cambiaron coordenadas, `deliveryLocationReceivedAt` y revisión técnica. La versión comercial siguió en 2 y no cambió ningún campo de pricing.

| Prueba operativa | Resultado | Evidencia |
| --- | --- | --- |
| Ubicación visible | PASS | `map-location.png` |
| Acción mapa | PASS | panel `/deliveries` |
| Fee preservado | PASS | `protectedPricingUnchanged=true` |
| Total preservado | PASS | auditoría `totalChanged=false` |
| Versión comercial preservada | PASS | 2 antes / 2 después |
| Nueva cuenta por ubicación | No | historial sin cambio |

## 8. Validación visual automatizada

Ambos PDFs fueron descargados desde el endpoint autenticado real, rasterizados con Ghostscript e inspeccionados visualmente. No son muestras del script aislado.

El check textual confirma títulos, versión, vigencia, desglose, total y notas. Confirma ausencia de `COMPROBANTE OPERATIVO POS`, copy de tarifa pendiente, placeholders y caracteres de reemplazo. Evidencia: `/tmp/delivery-real-receipt-validation/evidence/pdf-content-check.txt`.

## 9. Builds y tests

| Test/build | Resultado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `api-typecheck-final.log` |
| API build | PASS | `api-build-final.log` |
| Web typecheck | PASS | `web-typecheck.log` |
| Web build | PASS con warnings preexistentes | `web-build.log` |
| Renderer focalizado actual | 3 PASS, 8 skipped por patrón | `delivery-receipt-renderer-focused.log` |
| Spec completo | Assertions PASS, proceso no termina | logs `delivery-receipt-phase-a-*` |

Se ejecutó el spec completo en tres iteraciones. Los tests reportaron PASS, pero Jest quedó vivo con descriptores Prisma internos (`io_uring`/socket local). `--detectOpenHandles` no produjo identificación adicional. No se usó `forceExit`; los procesos diagnósticos se terminaron manualmente y no se reportan como PASS limpio.

## 10. Seguridad y límites

- Canal WhatsApp de comprobantes desconectado durante cambios comerciales; no hubo envío real.
- No se alteraron flags globales; `no-real-activation-check.log` está vacío.
- No se ejecutó Prisma reset, migrate destructivo, commit ni push.
- No se tocaron POS, Caja, Stock, Checkout, Catálogo, precios, Sofía, QR, DeepSeek o SafetyGuard.
- Las capturas finales se limitan al panel controlado y ocultan el teléfono de prueba.

## 11. Evidencias

Directorio: `/tmp/delivery-real-receipt-validation/evidence/`.

- `system-status.txt`
- `route-trace.md`
- `initial-real.pdf` / `initial-real.png`
- `updated-real.pdf` / `updated-real.png`
- `initial-pdf-text.txt` / `updated-pdf-text.txt`
- `deliveries-initial.png` / `deliveries-updated.png`
- `map-location.png`
- `api-response-headers.txt` / `api-response-headers-updated.txt`
- `build-hashes.txt`
- `pdf-content-check.txt` / `pdf-dimensions.txt`

## 12. Riesgos y decisión

Riesgo residual bloqueante: el spec completo no libera todos sus recursos al finalizar. La funcionalidad operativa y visual es correcta, pero el criterio exige test final concluido sin timeout ni terminación manual.

**DELIVERY REAL RECEIPT VALIDATION: NO-GO**

