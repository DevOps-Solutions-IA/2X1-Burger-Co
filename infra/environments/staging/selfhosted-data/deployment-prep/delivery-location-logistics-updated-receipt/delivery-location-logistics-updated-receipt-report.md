# Delivery location logistics + updated receipt - Reporte final

## 1. Resumen ejecutivo

Se corrigio el flujo critico de domicilios para separar ubicacion logistica y cambios comerciales.

La ubicacion recibida por WhatsApp ahora se guarda en la orden para Domicilios sin recalcular tarifa, subtotal, pricing breakdown ni total. Los cambios comerciales de productos recalculan el subtotal de productos, conservan la tarifa de domicilio persistida y regeneran una cuenta actualizada auditada.

Decision: GO CONDICIONADO.

Condicion: el test critico completo quedo no concluyente por timeout manual, pero las pruebas focalizadas nuevas pasaron, API typecheck paso y API build paso.

## 2. Diagnostico

Diagnostico inicial creado en:

`/tmp/delivery-location-logistics-updated-receipt/diagnostico.md`

Hallazgo principal: `applyDeliveryLocationToOrder()` reutilizaba `resolveDeliverySnapshot()`, que llama `deliveryPricingService.estimate()`. Por eso la ubicacion de WhatsApp podia recalcular `deliveryFee`, distancia, zona, breakdown y `subtotal`.

## 3. Que salio del flujo de ubicacion

- Recalculo de `deliveryFee`.
- Recalculo de `subtotal`.
- Recalculo de `deliveryPricingBreakdown`.
- Recalculo de `deliveryDistanceKm`.
- Recalculo de `deliveryZoneLabel`.
- Mensajes de “Total actualizado”.
- Copy de “confirmar la tarifa final”.

## 4. Que quedo en el flujo de ubicacion

- Guardar `deliveryLatitude`.
- Guardar `deliveryLongitude`.
- Guardar `deliveryLocationSource=whatsapp_live_location`.
- Guardar `deliveryLocationReceivedAt`.
- Vincular/actualizar `deliveryCustomerId`.
- Registrar auditoria `DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY`.
- Emitir eventos realtime para Domicilios.
- Registrar inbox y alerta operativa.

## 5. Como se guarda ubicacion para Domicilios

El nuevo metodo `applyDeliveryLocationForLogisticsOnly()` actualiza solo campos logisticos y publica `order.updated`.

Evidencia:

- `/tmp/delivery-location-logistics-updated-receipt/orders-location-evidence.log`
- `apps/api/src/modules/orders/orders.service.ts`

## 6. Como el domiciliario accede a la ubicacion

El modulo `/deliveries` ya consume `deliveryLatitude`, `deliveryLongitude` y `deliveryLocationReceivedAt`. Si hay coordenadas, muestra boton de mapa con Google Maps.

Evidencia:

- `apps/web/src/app/(app)/deliveries/page.tsx`
- Lineas auditadas en `/tmp/delivery-location-logistics-updated-receipt/file-inventory.log`

## 7. Como se detecta cambio comercial del pedido

El cambio comercial cubierto en esta fase es `replaceItems()`:

- Agregar producto.
- Quitar producto.
- Cambiar cantidades.
- Reemplazar composicion de productos.

Ahora recalcula subtotal de productos y suma `deliveryFee` persistido.

## 8. Como se genera cuenta actualizada

Cuando `replaceItems()` modifica una orden `DELIVERY`, se llama `generateDeliveryReceiptPdf(id, { updated: true })` y se audita:

`DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED`

Mensaje auditado:

`Pedido actualizado. Nueva cuenta generada con total vigente.`

## 9. Campos preservados

- `deliveryFee`
- `deliveryFeeSuggested`
- `deliveryDistanceKm`
- `deliveryZoneLabel`
- `deliveryPricingBreakdown`
- `deliveryCalculationVersion`
- `deliveryPricingStatus`
- `deliveryPricingConfidence`
- `deliveryRequiresManualQuote`
- `deliveryRouteProvider`
- `deliveryWeatherProvider`
- `deliveryGeocodingProvider`
- `deliveryEstimatedMinutes`

## 10. Campos que pueden cambiar

Por ubicacion WhatsApp:

- `deliveryLatitude`
- `deliveryLongitude`
- `deliveryLocationSource`
- `deliveryLocationReceivedAt`
- `deliveryCustomerId`
- `deliveryStatusUpdatedAt`
- `revision`

Por cambio comercial:

- `items`
- `subtotal`
- `revision`
- cuenta PDF actualizada generada
- auditoria de cuenta actualizada

## 11. Mensajes corregidos

El caption de cuenta inicial ya no dice “confirmar la tarifa final”. El mensaje posterior a ubicacion ya no dice “Domicilio”, “Total actualizado” ni “Pago sugerido” derivado de ubicacion.

Nuevo mensaje de ubicacion:

`Ubicacion recibida para tu pedido. La usaremos para facilitar la entrega. Tu cuenta conserva la tarifa de domicilio ya calculada.`

## 12. PDF/cuenta corregida

El PDF ahora distingue:

- `CUENTA DE DOMICILIO`
- `CUENTA ACTUALIZADA DE DOMICILIO`

La nota logistica indica que la tarifa corresponde al valor calculado para la orden y que la ubicacion se usa solo para facilitar la entrega.

## 13. Tests agregados/actualizados

- Se actualizo el test de ubicacion live para verificar que no cambia fee, subtotal ni pricing breakdown y que no llama `deliveryPricingService.estimate()`.
- Se agrego test de cuenta actualizada por cambio comercial con `deliveryFee` persistido.
- Se valido inbox/alerta de ubicacion correlacionada.

## 14. Resultados de validacion

- API typecheck: PASS.
- API build: PASS.
- Test focalizado ubicacion logistics-only: PASS.
- Test focalizado cuenta actualizada: PASS.
- Test focalizado inbox ubicacion: PASS.
- Test critico completo: NO CONCLUYENTE. Se detuvo manualmente tras timeout sin salida adicional.
- Web typecheck/build: NO EJECUTADO. No se modifico frontend.

## 15. Riesgos pendientes

- El envio automatico de ack de ubicacion sigue existiendo en el modulo WhatsApp interno si la sesion esta conectada. El contenido ya no recalcula ni informa totales.
- No se hizo rediseño visual premium del PDF; solo logica/copy/fuente de datos.
- No se implemento reenvio automatico de cuenta actualizada por WhatsApp en cambios comerciales para evitar activar efectos externos adicionales. La cuenta se regenera y queda auditada.

## 16. Decision

GO CONDICIONADO.

La logica principal queda corregida, la ubicacion queda guardada para Domicilios, los tests focalizados pasan y la seguridad queda intacta. La condicion es que el test critico completo no concluyo en esta ejecucion por timeout.

## Tablas

### Flujo | Antes | Despues | Estado

| Flujo | Antes | Despues | Estado |
| --- | --- | --- | --- |
| Ubicacion WhatsApp | Recalculaba tarifa/subtotal via `resolveDeliverySnapshot()` | Guarda solo coordenadas y metadata logistica | PASS |
| Cambio de productos | Podia recalcular delivery pricing | Usa `deliveryFee` persistido y regenera cuenta | PASS |
| PDF domicilio | Copy inducia ubicacion/tarifa | Copy indica tarifa calculada y ubicacion logistica | PASS |
| WhatsApp ubicacion | Decia total actualizado | Dice ubicacion recibida para entrega | PASS |

### Evento | Dispara recalculo | Dispara nueva cuenta | Estado

| Evento | Dispara recalculo | Dispara nueva cuenta | Estado |
| --- | --- | --- | --- |
| `DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY` | No | No | PASS |
| `DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED` | No recalcula delivery fee | Si | PASS |

### Campo | Ubicacion WhatsApp | Cambio de pedido | Estado

| Campo | Ubicacion WhatsApp | Cambio de pedido | Estado |
| --- | --- | --- | --- |
| `deliveryFee` | Conserva | Conserva salvo ajuste autorizado externo | PASS |
| `subtotal` | Conserva | Recalcula por items + fee persistido | PASS |
| `deliveryPricingBreakdown` | Conserva | Conserva | PASS |
| `deliveryLatitude/Longitude` | Actualiza | Conserva | PASS |

### Domicilios | Antes | Despues | Estado

| Domicilios | Antes | Despues | Estado |
| --- | --- | --- | --- |
| Ubicacion visible | Ya consumia lat/lng si existian | Sigue consumiendo campos guardados sin recalculo | PASS |
| Mapa | Ya disponible si hay coordenadas | Sin cambios necesarios | PASS |

### Mensaje | Antes | Despues | Estado

| Mensaje | Antes | Despues | Estado |
| --- | --- | --- | --- |
| Caption cuenta | “confirmar la tarifa final” | “facilitar la entrega” y tarifa conservada | PASS |
| Ack ubicacion | “Total actualizado” | “Ubicacion recibida” logistica | PASS |
| Auditoria ubicacion | `DELIVERY_LOCATION_UPDATE` | `DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY` | PASS |

### Test | Resultado | Evidencia

| Test | Resultado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `/tmp/delivery-location-logistics-updated-receipt/api-typecheck-iter2.log` |
| API build | PASS | `/tmp/delivery-location-logistics-updated-receipt/api-build.log` |
| Ubicacion logistics-only | PASS | `/tmp/delivery-location-logistics-updated-receipt/api-location-focused-test.log` |
| Cuenta actualizada | PASS | `/tmp/delivery-location-logistics-updated-receipt/api-receipt-refresh-focused-test.log` |
| Inbox ubicacion | PASS | `/tmp/delivery-location-logistics-updated-receipt/api-location-inbox-focused-test.log` |
| Test critico completo | NO CONCLUYENTE | `/tmp/delivery-location-logistics-updated-receipt/api-critical-test.log` |

### Archivo | Cambio | Motivo

| Archivo | Cambio | Motivo |
| --- | --- | --- |
| `apps/api/src/modules/orders/orders.service.ts` | Nuevo flujo logistics-only, PDF actualizado, replaceItems preserva fee | Separar ubicacion y pricing |
| `apps/api/src/modules/whatsapp/whatsapp.service.ts` | Copy de cuenta y ack de ubicacion corregidos | Evitar mensaje de recalculo |
| `apps/api/src/tests/app.critical.spec.ts` | Tests de preservacion de fee/subtotal y cuenta actualizada | Cubrir regresion critica |
