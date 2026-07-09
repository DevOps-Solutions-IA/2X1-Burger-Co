# AUDIT-8G.0 - Delivery Domain Reset + Legacy Pricing Cleanup

Fecha: 2026-06-19
Sistema: inventario-fastfood-system / 2X1 Burger Co.
Alcance: limpieza local de dominio domicilios. Sin despliegue, sin DNS, sin produccion, sin migraciones destructivas.

## 1. Resumen ejecutivo

AUDIT-8G.0 deja desactivado el pricing automatico fragil de domicilios y reemplaza su invocacion activa por un modo seguro temporal: cotizacion manual requerida, sin default silencioso, sin formula por kilometro y sin bandas por alias gobernando el valor final.

El flujo operativo queda preservado:

- POS permite ingresar domicilio manual.
- La comanda conserva `deliveryFee`.
- Checkout sigue transfiriendo `deliveryFee` a venta.
- Caja y comprobantes siguen leyendo `deliveryFee`.
- Settings ya no presenta el panel anterior como sistema completo de tarifas.
- OrdersService ya no calcula pricing complejo; solo invoca el boundary `DeliveryPricingService`.

## 2. Por que la implementacion anterior no era aceptable

La implementacion anterior mezclaba reglas de pricing dentro del flujo de ordenes y mantenia riesgo de decisiones automaticas no confiables:

- Bandas por alias dominaban direcciones con baja confianza.
- Existia riesgo de fallback automatico tipo `5000`.
- La formula de distancia y bandas vivia cerca de OrdersService.
- Settings exponia tarifas como si el sistema estuviera completo.
- No habia contrato de dominio para crecer hacia motor enterprise.

## 3. Inventario de logica delivery encontrada

| Archivo | Logica encontrada | Tipo | Activa | Riesgo | Accion |
| --- | --- | --- | --- | --- | --- |
| `apps/api/src/modules/orders/orders.service.ts` | Creacion, actualizacion, checkout, live location y `deliveryFee` | Integracion critica | Si | Alto si calcula tarifas | Se removio formula; invoca `DeliveryPricingService` |
| `apps/api/src/modules/orders/delivery-zones.ts` | Bandas Jamundi, aliases, distancia, `fee: 5000` | Legacy | No | Alto si se importa | Marcado `LEGACY - NOT ACTIVE`; sin imports activos |
| `apps/api/src/delivery/delivery-pricing/*` | Boundary nuevo de pricing | Dominio nuevo | Si | Bajo | Modo reset: manual quote o fee manual |
| `apps/web/src/lib/delivery-pricing.ts` | Estimador frontend anterior | Legacy | No | Medio | Reemplazado por compat layer que retorna `null` |
| `apps/web/src/app/(app)/pos/page.tsx` | Captura de referencia, fee manual, guardado | Integracion critica | Si | Alto | Conectado a `deliveryFee` manual |
| `apps/web/src/app/(app)/settings/page.tsx` | Panel tarifas domicilio | UI legacy | No | Medio | Sustituido por aviso de motor pendiente |
| `prisma/schema.prisma` | Campos `deliveryFee`, `deliveryDistanceKm`, `deliveryZoneLabel`, `deliveryReference` | Persistencia necesaria | Si | Bajo | Preservado sin migracion destructiva |
| `apps/api/src/modules/sales/sales.service.ts` | Sale, recibo, caja via venta | Integracion critica | Si | Alto | Sin cambios de negocio |
| `apps/api/src/modules/whatsapp/whatsapp.service.ts` | Resumen/comprobante domicilio | Integracion critica | Si | Medio | Sin romper contrato; WhatsApp desconectado genera 409 esperado |

## 4. Que se elimino

- Uso activo de formula `baseRate + km * costPerKm`.
- Uso activo de bandas como decision final.
- Uso activo de fallback automatico de domicilio.
- Estimador frontend que podia sugerir tarifas por alias.
- UI de Settings que aparentaba tener tarifas automaticas finales.

## 5. Que se aislo como legacy

- `apps/api/src/modules/orders/delivery-zones.ts` queda como referencia historica marcada `LEGACY - NOT ACTIVE`.
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.legacy.ts` documenta el legacy desactivado sin exportar estimador ejecutable.

Grep relevante:

- `delivery-zones.ts` conserva `fee: 5000`, pero no hay imports activos hacia OrdersService.
- `estimateDeliveryFee` sigue existiendo como endpoint compatible, pero retorna `DeliveryPricingService.quote(...)`, que exige cotizacion manual y no calcula tarifa.

## 6. Que se preservo

- `OrderTicket.deliveryFee`.
- `OrderTicket.deliveryDistanceKm`.
- `OrderTicket.deliveryZoneLabel`.
- `OrderTicket.deliveryReference`.
- `Sale.deliveryFee`.
- `Sale.deliveryDistanceKm`.
- Cliente, telefono, direccion y referencia.
- Checkout, caja, reportes y comprobantes.

## 7. Nuevo boundary de dominio delivery

Archivos creados:

- `apps/api/src/delivery/delivery.module.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.types.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.constants.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.errors.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.legacy.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.engine.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.service.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.spec.ts`

Contrato actual:

- `manualFee` valido: `READY`, `finalFee = manualFee`, `zoneLabel = Cotizacion manual`.
- Sin manualFee con direccion/coordenadas: `MANUAL_QUOTE_REQUIRED`, `finalFee = null`.
- Sin datos: `INVALID_INPUT`.
- Version: `delivery-reset-pending-engine`.

## 8. Estado temporal seguro

Mientras no exista AUDIT-8G.1:

- El sistema no inventa tarifa.
- El sistema no cobra `5000` por defecto.
- Condados / Alborada no se cobran automaticamente.
- La UI pide cotizacion manual.
- POS conserva y envia el valor manual.

## 9. Confirmacion sin default silencioso

Resultado:

- No hay fallback activo `5000` en flujo de domicilio.
- No hay `max(banda_zona, tarifa_calculada)` activo.
- No hay calculo por km activo.
- `delivery-zones.ts` queda legacy aislado y no importado por OrdersService.

## 10. OrdersService ya no gobierna pricing complejo

OrdersService conserva orquestacion operativa, pero el pricing se reduce a:

- construir snapshot de domicilio,
- pasar `manualFee` al boundary,
- persistir resultado,
- mantener subtotal con `deliveryFee`.

La estimacion publica `/orders/delivery-fee/estimate` se mantiene por compatibilidad, pero devuelve el contrato de reset del `DeliveryPricingService`.

## 11. deliveryFee manual se conserva

Validado por:

- Test unitario del engine.
- Test critico dirigido: `keeps delivery pricing manual during reset and does not recalculate from shared live location`.
- Playwright: guardar pedido domicilio con `7000`, retomarlo y verificar input + panel con `COP 7.000`.

## 12. Checkout / caja

No se cambio la logica de checkout/caja. `deliveryFee` sigue sumando al subtotal y se conserva en Sale. La prueba critica actualizada valida que live location no recalcula ni pisa el fee manual. La suite completa se inicio y mostro PASS en `app.critical.spec.ts`, pero el runner global quedo colgado por handles abiertos preexistentes; se cerro solo el proceso de test y se ejecuto validacion dirigida cerrada con PASS.

## 13. Estado de Settings

El panel anterior de tarifas fue reemplazado por:

> Motor de domicilios en preparacion. Por ahora, las tarifas deben confirmarse manualmente antes de guardar.

No se muestran `Tarifa base (COP)` ni `Costo por kilometro`.

## 14. Tests backend

PASS:

- `pnpm --filter @inventory-fastfood/api typecheck`
- `pnpm --filter @inventory-fastfood/api build`
- `pnpm --filter @inventory-fastfood/api exec jest src/delivery/delivery-pricing/delivery-pricing.spec.ts --runInBand --forceExit`
- `source infra/scripts/load-env.sh && bash infra/scripts/prepare-test-db.sh && pnpm --dir apps/api exec jest src/tests/app.critical.spec.ts -t "keeps delivery pricing manual" --runInBand --forceExit`

Casos cubiertos:

- Direccion desconocida requiere manual quote.
- Barrio no reconocido requiere manual quote.
- Sin direccion retorna estado no definitivo.
- `manualFee = 7000` queda como final.
- `baseRate/costPerKm` no determinan finalFee.
- Condados / Alborada no activan formula vieja.
- Live location no recalcula el fee manual.

## 15. Playwright

PASS:

`BASE_URL=http://localhost npx playwright test tests/e2e/audit8g0-delivery-domain-reset.spec.ts --project=chromium`

Notas:

- Se desactivaron retries del test para no golpear rate limit de login.
- Se filtro ruido esperado de WhatsApp desconectado (`409/503`) porque AUDIT-8G.0 no valida vinculacion WhatsApp.

## 16. Screenshots

Generadas en:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g0-delivery-domain-reset/`

Archivos:

- `01-pos-delivery-unknown-address-manual-required.png`
- `02-pos-delivery-manual-fee-entered.png`
- `03-pos-delivery-saved-with-manual-fee.png`
- `04-pos-delivery-retained-after-reopen.png`
- `05-settings-delivery-legacy-cleaned-or-disabled.png`
- `06-pos-mobile-390x844.png`

## 17. Typecheck / build

PASS:

- API typecheck.
- API build.
- Web build.
- Web typecheck despues de build.

Nota: el primer web typecheck se ejecuto en paralelo con build y fallo por `.next/types` ausente; re-ejecutado en orden paso correctamente.

## 18. Bundle localhost

PASS:

`grep -R "localhost:4300" apps/web/.next` no encontro ocurrencias.

## 19. Backup / checkpoint

Repositorio:

- No hay `.git` disponible en `/home/wundah/inventario`; no se pudo crear checkpoint git.
- Se genero backup local antes de editar.

Backup:

- `backups/audit8g0-pre-reset.dump`
- Size: 874K
- SHA256: `cc7722d9dcc343cf6041fcf08bdf86e3dc85fae23ca208d3a76c50d952f49db6`

## 20. Riesgos residuales

- `delivery-zones.ts` queda en el repo como legacy aislado; recomendable eliminar o migrar a fixtures historicos en AUDIT-8G.1 si ya no se necesita.
- Domiciliarios/admin delivery aun muestran fallback visual tipo `Jamundi urbano` cuando no hay `deliveryZoneLabel`; eso no cobra tarifa, pero debe alinearse visualmente en AUDIT-8G.1.
- WhatsApp desconectado genera 409/503 al intentar enviar resumen de domicilio; no es regresion de pricing, pero debe tratarse en hardening de WhatsApp.
- El runner global de Jest tiene handles abiertos preexistentes; las pruebas dirigidas cerraron en PASS.

## 21. Proximo paso recomendado

AUDIT-8G.1 - DELIVERY PRICING ENGINE 2X1 ENTERPRISE FROM SCRATCH.

Debe implementar motor real con zonas, confianza de direccion, reglas gratuitas Condados/Alborada, cotizacion manual auditada, versionado, trazabilidad y pruebas end-to-end sin reactivar legacy.

## 22. Decision final

DELIVERY DOMAIN RESET + LEGACY PRICING CLEANUP: GO

Razon:

- Formula vieja fuera de uso activo.
- Default silencioso eliminado del flujo.
- Boundary delivery creado.
- Modo manual seguro funcionando.
- POS, Settings y persistencia de `deliveryFee` validados.
- Typecheck/build PASS.
- Playwright PASS.
- Screenshots completos.
- Bundle limpio.
