# Delivery updated receipt auto-send - Reporte final

## 1. Resumen ejecutivo

Se implemento el reenvio automatico de la cuenta actualizada cuando una orden `DELIVERY` cambia comercialmente por productos/cantidades. La ubicacion recibida por WhatsApp se mantiene como flujo logistico: guarda coordenadas, no recalcula tarifa, no cambia subtotal/total y no genera cuenta actualizada.

El bloque funcional delivery queda validado con pruebas focalizadas y con los casos delivery dentro del test critico. El gate final queda `NO-GO` porque el test critico completo sigue fallando por 7 pruebas externas al cambio de delivery.

## 2. Diagnostico

Evidencia principal:

- Diagnostico inicial: `/tmp/delivery-updated-receipt-auto-send/diagnostico.md`.
- Diagnostico de test critico: `/tmp/delivery-updated-receipt-auto-send/critical-test-timeout-diagnosis.md`.

El flujo principal de cambio comercial es `PUT /orders/:id/items`, atendido por `OrdersService.replaceItems()`. Antes regeneraba PDF y auditaba, pero no enviaba la cuenta actualizada al cliente.

## 3. Flujos que modifican ordenes DELIVERY

| Flujo | Antes | Despues | Estado |
| --- | --- | --- | --- |
| Crear orden delivery | Crea orden y el envio inicial queda en flujo existente | Sin cambios | PASS |
| Cambiar productos/cantidades | Recalculaba total y regeneraba PDF actualizado, sin enviar | Regenera PDF actualizado, intenta envio automatico y audita resultado | PASS |
| Actualizacion sin cambio comercial | Podia tratarse como update normal | No cambia revision ni reenvia cuenta duplicada | PASS |
| Ubicacion WhatsApp | Ya era logistics-only desde fase anterior | Sigue sin generar PDF actualizado ni envio de cuenta | PASS |
| WhatsApp no disponible | Podia propagar error si se enviaba directo | Orden queda persistida, PDF generado, fallo auditado | PASS |
| Sin telefono | Podia fallar al enviar | Orden queda persistida, se audita `CUSTOMER_PHONE_MISSING` | PASS |

## 4. Integracion de envio automatico

Archivos modificados:

- `apps/api/src/modules/orders/orders.service.ts`.
- `apps/api/src/modules/whatsapp/whatsapp.service.ts`.
- `apps/api/src/tests/app.critical.spec.ts`.

Cambios principales:

- `OrdersService.replaceItems()` detecta cambios comerciales reales comparando snapshot de items.
- Si la orden es `DELIVERY` y hubo cambio comercial, genera `CUENTA ACTUALIZADA DE DOMICILIO`.
- Luego llama `sendUpdatedDeliveryReceiptAfterCommercialChange()`.
- La llamada al envio usa `WhatsappService.sendDeliveryOrderSummary(orderId, actorId, { updated: true, reason: 'commercial_order_change', idempotencyKey })`.
- Se usa lazy lookup con `ModuleRef` para evitar ciclo de modulos.

## 5. Manejo de canal desconectado

Si el canal falla o no esta disponible:

- La actualizacion comercial no se revierte.
- La cuenta actualizada queda generada.
- Se registra `DELIVERY_UPDATED_RECEIPT_SEND_FAILED`.
- El error se sanitiza.
- No se informa exito falso.

## 6. Prevencion de duplicados

Se usa idempotency key por revision:

```text
DELIVERY_RECEIPT_UPDATED_SENT:{orderId}:{revision}
```

Antes de enviar se revisa auditoria `DELIVERY_UPDATED_RECEIPT_SENT` para esa revision. Si los items no cambian, `replaceItems()` retorna la orden actual sin incrementar revision ni enviar.

## 7. Auditoria

| Evento | Dispara recalculo | Dispara nueva cuenta | Estado |
| --- | --- | --- | --- |
| `DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED` | Solo por cambio comercial | Si | PASS |
| `DELIVERY_UPDATED_RECEIPT_SEND_REQUESTED` | No | Intento de envio | PASS |
| `DELIVERY_UPDATED_RECEIPT_SENT` | No | Envio exitoso | PASS |
| `DELIVERY_UPDATED_RECEIPT_SEND_FAILED` | No | Falla o pendiente | PASS |
| `DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY` | No | No | PASS |

Telefonos en auditoria del envio actualizado quedan enmascarados con `phoneMasked`.

## 8. Ubicacion logistics-only confirmada

`applyDeliveryLocationForLogisticsOnly()` no fue mezclado con el envio de cuenta actualizada. Sigue preservando:

- `deliveryFee`.
- `deliveryFeeSuggested`.
- `deliveryDistanceKm`.
- `deliveryZoneLabel`.
- `deliveryPricingBreakdown`.
- `deliveryCalculationVersion`.
- `deliveryPricingStatus`.
- `subtotal`.
- `total` operacional representado por `subtotal` del ticket.

## 9. Tests focalizados

| Test | Resultado | Evidencia |
| --- | --- | --- |
| DeliveryFee backend source + customer distance | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-deliveryfee-source-after-fix.log` |
| Auto-send cuenta actualizada | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-auto-send-suite-serial-final.log` |
| No duplicado sin cambio comercial | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-auto-send-suite-serial-final.log` |
| Ubicacion no genera cuenta | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-auto-send-suite-serial-final.log` |
| WhatsApp falla sin revertir orden | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-auto-send-suite-serial-final.log` |
| Sin telefono audita fallo | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-auto-send-suite-serial-final.log` |
| Location logistics-only | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-location-suite-serial-after-contamination.log` |

## 10. Test critico completo

| Resultado | Evidencia | Estado |
| --- | --- | --- |
| `84 passed`, `7 failed`, `91 total`, `378.639 s` | `/tmp/delivery-updated-receipt-auto-send/critical-full-detect-open-handles-after-delivery-fix.log` | FAIL |

Los casos delivery relevantes pasan dentro de la corrida completa. Los fallos restantes son:

- 1 conflicto de grupo de mesas por estado de DB acumulado al ejecutar Jest directo sin `prisma migrate reset`.
- 6 fallos Sofia/QR/DeepSeek fuera del alcance delivery.

No se ejecuto el script completo `pnpm --filter @inventory-fastfood/api test` porque ejecuta `prisma migrate reset --force`, prohibido por esta fase.

## 11. Build/typecheck

| Comando | Resultado | Evidencia |
| --- | --- | --- |
| `pnpm --filter @inventory-fastfood/api typecheck` | PASS | `/tmp/delivery-updated-receipt-auto-send/api-typecheck-after-distance-fix.log` |
| `pnpm --filter @inventory-fastfood/api build` | PASS | `/tmp/delivery-updated-receipt-auto-send/api-build-after-distance-fix.log` |

Frontend no se toco en esta fase.

## 12. Seguridad

| Check | Resultado | Evidencia |
| --- | --- | --- |
| No real activation | PASS | `/tmp/delivery-updated-receipt-auto-send/no-real-activation-check.log` |
| Copy prohibido por ubicacion | PASS | `/tmp/delivery-updated-receipt-auto-send/forbidden-copy-check.log` |
| Secret/QR raw | Sin secretos reales; solo referencias de codigo a `qrString` | `/tmp/delivery-updated-receipt-auto-send/secret-check.log` |

No se activaron flags globales de WhatsApp, produccion, auto reply ni Auto Safe productivo.

## 13. Riesgos pendientes

- El gate critico completo no queda en PASS.
- La suite critica directa sin reset destructivo puede contaminar estado, como se vio con el conflicto de grupo `Salon`.
- Hay fallos Sofia/QR/DeepSeek preexistentes al alcance delivery que requieren fase separada.

## 14. Decision

`CIERRE FUNCIONAL FINAL — REENVIO AUTOMATICO DE CUENTA ACTUALIZADA EN ORDENES DELIVERY`: `NO-GO`

Motivo: el cambio funcional delivery esta implementado y validado, pero el criterio de fase exige test critico completo PASS. El test critico completo sigue en FAIL con 7 fallos reproducibles, aunque ninguno corresponde al autoenvio delivery implementado.

## Tablas obligatorias

### Flujo | Antes | Despues | Estado

| Flujo | Antes | Despues | Estado |
| --- | --- | --- | --- |
| Ubicacion WhatsApp | Logistics-only | Se mantiene logistics-only | PASS |
| Cambio comercial | PDF actualizado sin envio | PDF actualizado + envio automatico + auditoria | PASS |
| WhatsApp no disponible | Riesgo de error propagado | Fallo auditado sin revertir orden | PASS |
| Sin telefono | Riesgo de error destructivo | Fallo auditado sin fingir envio | PASS |
| Test critico completo | Timeout/inconcluso reportado | Termina con FAIL reproducible | NO-GO |

### Evento | Dispara recalculo | Dispara nueva cuenta | Estado

| Evento | Dispara recalculo | Dispara nueva cuenta | Estado |
| --- | --- | --- | --- |
| `LOCATION_RECEIVED_LOGISTICS_ONLY` | No | No | PASS |
| `ORDER_UPDATED_COMMERCIAL` | Si, por items | Si | PASS |
| `DELIVERY_RECEIPT_UPDATED_SENT` | No | Resultado de envio | PASS |
| `DELIVERY_UPDATED_RECEIPT_SEND_FAILED` | No | Evidencia de fallo/pendiente | PASS |

### Campo | Ubicacion WhatsApp | Cambio de pedido | Estado

| Campo | Ubicacion WhatsApp | Cambio de pedido | Estado |
| --- | --- | --- | --- |
| `deliveryFee` | Conservado | Conservado si solo cambian productos | PASS |
| `subtotal` | Conservado | Recalculado por items + fee persistido | PASS |
| `deliveryPricingBreakdown` | Conservado | Conservado si solo cambian productos | PASS |
| `deliveryLatitude/Longitude` | Actualizado | Conservado | PASS |
| `revision` | Incrementa por update logistico | Incrementa solo si cambio comercial real | PASS |

### Domicilios | Antes | Despues | Estado

| Domicilios | Antes | Despues | Estado |
| --- | --- | --- | --- |
| Ubicacion visible | Ya disponible por fase anterior | Se conserva | PASS |
| Cuenta actualizada | PDF sin autoenvio | PDF + envio automatico por cambio comercial | PASS |

### Mensaje | Antes | Despues | Estado

| Mensaje | Antes | Despues | Estado |
| --- | --- | --- | --- |
| Ubicacion | Podia inducir tarifa/total | "Ubicacion recibida... tarifa conservada" | PASS |
| Cambio comercial | No enviaba cuenta automaticamente | "Pedido actualizado. Esta es tu nueva cuenta con el total vigente." | PASS |

### Test | Resultado | Evidencia

| Test | Resultado | Evidencia |
| --- | --- | --- |
| Focalizados delivery | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-auto-send-suite-serial-final.log` |
| Focalizados location | PASS | `/tmp/delivery-updated-receipt-auto-send/focused-location-suite-serial-after-contamination.log` |
| API typecheck/build | PASS | logs en `/tmp/delivery-updated-receipt-auto-send/` |
| Critico completo | FAIL | `/tmp/delivery-updated-receipt-auto-send/critical-full-detect-open-handles-after-delivery-fix.log` |

### Archivo | Cambio | Motivo

| Archivo | Cambio | Motivo |
| --- | --- | --- |
| `apps/api/src/modules/orders/orders.service.ts` | Autoenvio actualizado, idempotencia, auditoria, preservacion fee, customer distance | Cumplir regla comercial delivery |
| `apps/api/src/modules/whatsapp/whatsapp.service.ts` | `sendDeliveryOrderSummary()` acepta `updated` y ajusta PDF/copy/auditoria | Reutilizar canal existente de forma segura |
| `apps/api/src/tests/app.critical.spec.ts` | Tests focalizados de autoenvio, duplicados, ubicacion, fallo canal y sin telefono | Validacion funcional |
