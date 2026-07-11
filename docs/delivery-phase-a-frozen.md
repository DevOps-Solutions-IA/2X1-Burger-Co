# Delivery Phase A — CONGELADA

Fecha de congelamiento: 2026-07-10. Esta fase define el comportamiento estable del flujo de cuentas de domicilio. **No modificar nada de lo aquí descrito sin una nueva fase aprobada explícitamente por el owner.**

## Reglas definitivas

1. La tarifa de domicilio (`deliveryFee`) se calcula **una sola vez al crear la orden** vía `resolveDeliverySnapshot()` → `deliveryPricingService`.
2. `subtotal` de una orden DELIVERY = subtotal de productos + `deliveryFee`. **`subtotal` ES el total a cobrar.** Ninguna vista debe sumar `deliveryFee` de nuevo.
3. La ubicación compartida por WhatsApp es **logistics-only**: guarda coordenadas y metadata, nunca toca pricing ni genera cuenta.
4. Los cambios comerciales (`replaceItems`) conservan el `deliveryFee` persistido, recalculan el subtotal de productos y regeneran la cuenta.
5. Solo existe **una cuenta vigente** por orden: la de la última versión comercial. Las anteriores quedan REPLACED (representado por auditoría + generación determinística desde el estado vigente de la orden; no se persisten PDFs como entidades).

## Versionado

- **Versión comercial** = `1 + count(auditLog action='DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED' por orden)`. Implementada en `OrdersService.getDeliveryCommercialVersion()`.
- **`revision` (columna) es técnica, NO comercial**: también se incrementa por ubicación logistics-only y otros eventos. Nunca usarla como número de versión de cuenta.
- El PDF muestra `VERSIÓN N` y estado `VIGENTE`. La cuenta actualizada muestra además "Esta cuenta reemplaza las versiones anteriores del pedido."
- En `replaceItems`, el audit `REFRESHED` se registra **antes** de generar el PDF (la versión se deriva contando esos eventos; así el PDF sale numerado con la versión que estrena).

## Campos protegidos (la ubicación NO puede tocarlos)

`deliveryFee`, `deliveryFeeSuggested`, `deliveryDistanceKm`, `deliveryZoneLabel`, `deliveryPricingBreakdown`, `deliveryCalculationVersion`, `deliveryPricingStatus`, `deliveryPricingConfidence`, `deliveryRequiresManualQuote`, `subtotal`, `items`, versión comercial.

La ubicación solo actualiza: `deliveryLatitude`, `deliveryLongitude`, `deliveryLocationSource`, `deliveryLocationReceivedAt`, `deliveryCustomerId`, `deliveryStatusUpdatedAt`, `revision` (técnica) + auditoría + realtime.

## Eventos de auditoría del flujo

| Evento | Cuándo |
|---|---|
| `DELIVERY_RECEIPT_INITIAL_GENERATED` | Al generar la cuenta inicial en el flujo de envío |
| `DELIVERY_RECEIPT_INITIAL_SEND_REQUESTED` / `_SENT` / `_SEND_FAILED` | Envío inicial (REQUESTED incluye `skippedReason: 'ALREADY_SENT'` si aplica) |
| `DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED` | Cambio comercial real (define la nueva versión) |
| `DELIVERY_RECEIPT_REPLACED` | La versión anterior pasa a REPLACED, la nueva a ACTIVE |
| `DELIVERY_UPDATED_RECEIPT_SEND_REQUESTED` / `_SENT` / `_SEND_FAILED` | Autoenvío de la cuenta actualizada |
| `DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY` | Ubicación recibida (solo logística) |

Los payloads llevan `phoneMasked` (nunca teléfono completo), `receiptVersion`, `idempotencyKey`, totales y `failureReason` sanitizado.

## Idempotencia

- Inicial: `DELIVERY_RECEIPT_INITIAL_SENT:{orderId}` — máximo un envío exitoso por orden; el reintento devuelve `alreadySent: true` sin tocar el socket.
- Actualizada: `DELIVERY_RECEIPT_UPDATED_SENT:{orderId}:{revision}` — máximo un envío por revisión, verificado contra auditLog.
- Un cambio sin diferencia real (`areCommercialItemsEqual`) no incrementa versión, no regenera PDF, no envía.
- El fallo de envío nunca revierte la orden; queda auditado para reintento controlado. Sin teléfono → `CUSTOMER_PHONE_MISSING` (UI: "Sin teléfono"), sin romper la actualización.

## PDF térmico (58 mm)

- Renderer puro: `apps/api/src/modules/orders/delivery-receipt.renderer.ts` (datos planos → Buffer; sin DB). Muestras sin tocar órdenes reales: `apps/api/scripts/render-delivery-receipt-samples.ts`.
- Impresión **negra pura** (#000), sin fondos de color. Logo original en `apps/api/src/assets/brand-logo.png` (derivado de `apps/web/public/brand/sidebar-logo.png`, variante de impresión: invertido a negro-sobre-blanco, umbralizado). Copiado a `dist/assets/` vía `nest-cli.json`.
- Página única continua (papel térmico): la altura se calcula con una pasada de medición; pedidos largos no generan saltos de página.
- Sanitización WinAnsi obligatoria (`sanitizeForReceipt`): elimina emoji/caracteres no imprimibles conservando acentos españoles. Cubre el caso conocido del producto con `U+1F488` en la DB.
- Textos obligatorios: nota de tarifa calculada por el sistema, nota de ubicación solo logística, y en actualizadas la nota de reemplazo.

## Endpoints

- `GET /orders/:id/delivery-receipt` — PDF de la cuenta vigente (renderiza el estado actual; determinístico, imposible servir una versión vieja). Roles: admin, cashier, supervisor, delivery.
- `GET /orders/:id/delivery-receipt-status` — versión vigente, total, estado de envío (`NOT_REQUESTED|PENDING|SENT|FAILED|SKIPPED_NO_PHONE|SKIPPED_CHANNEL_BLOCKED`), última actualización.
- `GET /orders/:id/delivery-receipt-history` — versiones con resumen de cambios (derivado de auditoría CREATE/UPDATE_ITEMS/REFRESHED), totales y estado ACTIVE/REPLACED.

## Frontend /deliveries

- El total mostrado es `order.subtotal` (regla 2). Prohibido volver a sumar `deliveryFee`.
- Panel "Cuenta de domicilio": versión vigente, chip VIGENTE, estado de envío, última actualización y acción "Ver cuenta vigente" (blob del endpoint del PDF).

## Pruebas obligatorias

`apps/api/src/tests/delivery-receipt-phase-a.spec.ts` (renderer puro + versionado/idempotencia/endpoints) y los tests delivery de `apps/api/src/tests/app.critical.spec.ts` (fee preservado, no-duplicados, ubicación sin recálculo, fallos de canal). Correr contra la DB `_test` únicamente.

## Qué NO se puede cambiar sin nueva fase aprobada

- Recalcular tarifa por ubicación (en cualquier forma).
- Sumar sandbox/ubicación al pricing.
- Cambiar el esquema de versionado o las claves de idempotencia.
- Eliminar eventos de auditoría del flujo o degradar `phoneMasked` a teléfono completo.
- Cambiar el diseño del PDF a colores o quitar versión/VIGENTE.
- Introducir persistencia de PDFs como entidades (decisión explícita: generación determinística).
