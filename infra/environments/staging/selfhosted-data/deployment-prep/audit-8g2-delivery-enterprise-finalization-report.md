# AUDIT-8G.2 - Delivery Enterprise Finalization + UI Premium + Regression Gate

Fecha: [PHONE_REDACTED]
Proyecto: inventario-fastfood-system / 2X1 Burger Co
Decision: DELIVERY ENTERPRISE FINALIZATION + UI PREMIUM + REGRESSION GATE: GO

## 1. Resumen ejecutivo

AUDIT-8G.2 queda cerrado en GO. La fase finalizo la experiencia operativa de domicilios en POS, valido reglas enterprise del motor, confirmo persistencia completa en OrderTicket y Sale, verifico caja sin banner rojo, dejo durable el ajuste local de Nginx/rate-limit en plantillas fuente, genero 15/15 screenshots y ejecuto el regression gate principal.

No se desplego a produccion. No se tocaron DNS. No se imprimieron secretos. No se modifico `.env`. No se borraron datos reales. Los providers externos quedaron deshabilitados al final.

## 2. Estado recibido

- AUDIT-8G.0 - Delivery Domain Reset: GO.
- AUDIT-8G.0.1 - Delivery External Providers Architecture: GO CONDICIONADO.
- AUDIT-8G.0.2 - Delivery Providers Infra Closure: GO.
- AUDIT-8G.1 - Delivery Pricing Engine 2X1 Enterprise: NO-GO inicial.
- AUDIT-8G.1.1 - Delivery Engine E2E + Cash Operation Stability Closure: GO.

Estado base validado:

- Caja estable despues del fix de rate limit local.
- Delivery E2E previo PASS.
- Smoke externo previo PASS con OpenRouteService y Open-Meteo.
- ExternalApiCache y DeliveryProviderUsage confirmados.
- API tests 199/199 PASS antes de esta fase.
- API/Web build y typecheck PASS antes de esta fase.
- Bundle sin `localhost:4300`.

## 3. Cambios realizados

Archivos modificados:

- `infra/nginx/templates/http.conf.template`
- `infra/nginx/templates/https.conf.template`
- `apps/web/src/app/(app)/pos/page.tsx`
- `tests/e2e/audit8g2-delivery-final.spec.ts`
- `infra/environments/staging/selfhosted-data/deployment-prep/audit-8g2-delivery-enterprise-finalization-report.md`

Cambios principales:

- Rate-limit local de API general/auth quedo durable en plantillas fuente con `300r/m` y `burst=120`.
- Login mantiene regla fuerte: `5r/m` y `burst=3`.
- POS delivery recibio panel premium con estados claros, resumen de tarifa, warnings, motivo manual y test ids estables.
- Se agrego campo visual de barrio/sector para domicilio.
- Se normalizo captura de fee manual como input monetario seguro.
- Se creo E2E final AUDIT-8G.2 con flujo completo de local free, manual quote, motivo requerido, checkout, caja y responsive.

## 4. Durabilidad del fix Nginx/rate-limit

Resultado: PASS.

AUDIT-8G.1.1 habia dejado el ajuste visible en `infra/nginx/generated/default.conf`. En esta fase se verifico que las plantillas fuente seguian con valores antiguos y se corrigieron:

- `infra/nginx/templates/http.conf.template`
- `infra/nginx/templates/https.conf.template`

Estado final:

- API/auth general: `300r/m`.
- API burst: `burst=120`.
- Login: `5r/m`, `burst=3`.
- No quedan `60r/m` ni `burst=20` en plantillas/generado.
- No se bajo seguridad de login.
- No se toco Nginx productivo.

## 5. UI premium POS delivery

Resultado: PASS.

El POS ahora muestra una seccion de domicilios con flujo mas claro para cajero:

- Selector de tipo de pedido con `data-testid="pos-delivery-mode"`.
- Nombre cliente, telefono, direccion/referencia y barrio/sector.
- Boton `Estimar domicilio`.
- Estado visual del calculo.
- Tarifa sugerida.
- Tarifa final.
- Ruta/tiempo si existe.
- Zona local gratis.
- Warnings operativos en lenguaje no tecnico.
- Fee manual.
- Motivo manual obligatorio cuando aplica.

Estados visuales soportados:

- `LOCAL_FREE`
- `AUTO_PRICED`
- `MANUAL_QUOTE_REQUIRED`
- `PROVIDER_UNAVAILABLE`
- `OUT_OF_COVERAGE`
- `AMBIGUOUS_LOCAL_REFERENCE`
- `ERROR_RETRYABLE`
- `PENDING`

Test ids agregados o preservados:

- `pos-page`
- `pos-delivery-mode`
- `pos-delivery-customer-name`
- `pos-delivery-phone`
- `pos-delivery-address`
- `pos-delivery-neighborhood`
- `pos-delivery-reference`
- `pos-delivery-estimate-button`
- `pos-delivery-pricing-status`
- `pos-delivery-suggested-fee`
- `pos-delivery-final-fee`
- `pos-delivery-warning`
- `pos-delivery-manual-fee-input`
- `pos-delivery-manual-reason`
- `pos-delivery-save`
- `pos-open-orders`
- `pos-checkout-button`

## 6. Reglas de negocio delivery

Resultado: PASS.

Reglas validadas por motor/API/E2E:

- Condados de la Alborada fuerte queda `LOCAL_FREE`.
- La Alborada fuerte queda `LOCAL_FREE`.
- Local free tiene `finalFee=0`.
- Local free no aplica minimo.
- Local free no aplica lluvia.
- Local free no aplica recargo horario.
- Local free no aplica beneficio por subtotal.
- "cerca de alborada" no queda gratis.
- "por alborada" queda como referencia ambigua/manual quote segun motor.
- Fee manual sin motivo se rechaza.
- Fee manual con motivo se guarda.
- No se reintrodujo default silencioso COP 5.000 para desconocidas.
- No se reintrodujo formula vieja `baseRate + km`.
- Haversine no gobierna tarifa final enterprise.

## 7. Local free

Resultado: PASS.

Evidencia E2E:

- `Condados de la Alborada` -> `LOCAL_FREE`, final COP 0.
- `La Alborada` -> `LOCAL_FREE`, final COP 0.

Screenshots:

- `02-pos-delivery-local-free-condados.png`
- `03-pos-delivery-local-free-alborada.png`
- `14-delivery-local-free-no-surcharges.png`

## 8. Ambiguous manual quote

Resultado: PASS.

Evidencia E2E:

- `cerca de alborada` no se acepta como zona gratis.
- El sistema muestra cotizacion manual requerida.
- El warning operativo queda visible para cajero.

Screenshot:

- `04-pos-delivery-ambiguous-manual-required.png`

## 9. Manual override con motivo

Resultado: PASS.

Evidencia E2E:

- Fee manual COP 7.000 sin motivo muestra bloqueo.
- Con motivo `Zona fuera de cobertura automatica validada por operador` se permite guardar.
- Al reabrir la comanda, fee y motivo se conservan.

Screenshots:

- `05-pos-delivery-manual-fee-reason-required.png`
- `06-pos-delivery-manual-fee-saved.png`
- `07-pos-delivery-reopened-metadata.png`

## 10. Provider externo controlado

Resultado: PASS.

Estado final de `.env`:

- `DELIVERY_EXTERNAL_PROVIDERS_ENABLED=false`
- `DELIVERY_EXTERNAL_SMOKE_ENABLED=false`

No se imprimio `OPENROUTESERVICE_API_KEY`.

El smoke externo real ya habia quedado PASS en AUDIT-8G.1.1 con OpenRouteService y Open-Meteo. En esta fase no se reactivo el flag al final y se valido el flujo de provider disabled/manual quote desde UI.

Screenshot:

- `13-delivery-provider-unavailable-manual.png`

## 11. Cache

Resultado: PASS.

ExternalApiCache persistente confirmado desde la fase anterior y revalidado por estado de registros:

- `openmeteo` / `WEATHER_CURRENT` / `SUCCESS`
- `openrouteservice` / `GEOCODE_ADDRESS` / `SUCCESS`
- `openrouteservice` / `ROUTE_DISTANCE` / `SUCCESS`

No se guardaron API keys ni secretos.

## 12. Quota manager

Resultado: PASS.

DeliveryProviderUsage confirmado:

- `openmeteo/weather`: request 1, success 1, errors 0.
- `openrouteservice/geocoding`: request 1, success 1, errors 0.
- `openrouteservice/routing`: request 1, success 1, errors 0.

No se observo cuota disparada ni abuso de proveedor.

## 13. Circuit breaker

Resultado: PASS.

Estado observado:

- `circuit_open_until` sin valor activo para los providers verificados.
- No se detecto circuito abierto.
- Proveedores disabled no rompen POS ni checkout.

## 14. Auditoria delivery

Resultado: PASS.

El flujo mantiene version de calculo y metadata:

- `deliveryCalculationVersion=2x1-delivery-pricing-v1`.
- `deliveryPricingStatus`.
- `deliveryPricingConfidence`.
- `deliveryPricingBreakdown`.
- Motivo manual cuando aplica.

## 15. OrderTicket metadata

Resultado: PASS.

Campos confirmados en `order_tickets`:

- `delivery_fee`
- `delivery_fee_suggested`
- `delivery_fee_edited`
- `delivery_fee_edit_reason`
- `delivery_pricing_status`
- `delivery_pricing_confidence`
- `delivery_pricing_breakdown`
- `delivery_calculation_version`
- `delivery_requires_manual_quote`
- provider fields
- `delivery_estimated_minutes`

Evidencia de datos E2E:

- `DOMICILIO-692`: `LOCAL_FREE`, `delivery_fee=0.00`, `delivery_fee_suggested=0.00`, confidence HIGH.
- `DOMICILIO-693`: `MANUAL_CONFIRMED`, `delivery_fee=7000.00`, edited true, motivo guardado.

## 16. Sale metadata

Resultado: PASS.

Campos confirmados en `sales`:

- `deliveryFee`
- `delivery_fee_suggested`
- `delivery_fee_edited`
- `delivery_fee_edit_reason`
- `delivery_pricing_breakdown`
- `delivery_calculation_version`

Evidencia de venta E2E:

- `SAL-[PHONE_REDACTED]`: canal DOMICILIO, `deliveryFee=7000.00`, edited true, motivo guardado.

## 17. Cash deliveryFee

Resultado: PASS.

Caja abre sin banner rojo global y refleja el flujo con deliveryFee final:

- `/cash` responde 200.
- Screenshot `09-cash-delivery-fee-included.png`.
- Screenshot `10-cash-no-global-error-banner.png`.
- No hay reincidencia de rate-limit en logs finales.

## 18. Checkout

Resultado: PASS.

El E2E confirmo:

- Checkout de domicilio manual con COP 7.000.
- `sale.deliveryFee === 7000`.
- Metadata y motivo transferidos.
- Caja permanece estable despues de checkout.

Screenshot:

- `08-pos-checkout-with-delivery-fee.png`

## 19. Backend tests

Resultado: PASS.

Comandos ejecutados:

- `pnpm --filter @inventory-fastfood/api typecheck` -> PASS.
- `pnpm --filter @inventory-fastfood/api build` -> PASS.
- `pnpm --filter @inventory-fastfood/api test` -> PASS.

Resultado suite API:

- 12 suites PASS.
- 199 tests PASS.
- `app.critical.spec.ts` PASS.

## 20. Frontend/E2E

Resultado: PASS.

Comandos ejecutados:

- `pnpm --filter @inventory-fastfood/web typecheck` -> PASS en rerun aislado.
- `pnpm --filter @inventory-fastfood/web build` -> PASS.
- `BASE_URL=http://localhost npx playwright test tests/e2e/audit8g2-delivery-final.spec.ts --config=tests/e2e/playwright.noserver.config.ts --project=chromium` -> PASS.

Nota: el config `playwright.noserver.config.ts` se uso porque el stack local ya estaba levantado por Docker/Nginx en `http://localhost`; el config default intenta levantar servidores de desarrollo alternos.

## 21. Screenshots 15/15

Directorio:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g2-delivery-final/`

| Screenshot | Existe | Evidencia |
| --- | --- | --- |
| `01-pos-delivery-mode-empty.png` | SI | 119K |
| `02-pos-delivery-local-free-condados.png` | SI | 128K |
| `03-pos-delivery-local-free-alborada.png` | SI | 132K |
| `04-pos-delivery-ambiguous-manual-required.png` | SI | 125K |
| `05-pos-delivery-manual-fee-reason-required.png` | SI | 121K |
| `06-pos-delivery-manual-fee-saved.png` | SI | 116K |
| `07-pos-delivery-reopened-metadata.png` | SI | 140K |
| `08-pos-checkout-with-delivery-fee.png` | SI | 142K |
| `09-cash-delivery-fee-included.png` | SI | 99K |
| `10-cash-no-global-error-banner.png` | SI | 110K |
| `11-settings-delivery-config.png` | SI | 113K |
| `12-mobile-delivery-pos-390x844.png` | SI | 579K |
| `13-delivery-provider-unavailable-manual.png` | SI | 125K |
| `14-delivery-local-free-no-surcharges.png` | SI | 130K |
| `15-delivery-final-summary.png` | SI | 127K |

## 22. Smoke externo

Resultado: PASS por evidencia de AUDIT-8G.1.1 y verificacion local de cache/usage.

En AUDIT-8G.2 no se dejo providers enabled. Se valido que:

- Open-Meteo ya tenia cache/usage success.
- OpenRouteService geocoding ya tenia cache/usage success.
- OpenRouteService routing ya tenia cache/usage success.
- Flags finales quedaron false.
- No se imprimio API key.

## 23. Providers false al final

Resultado: PASS.

Verificacion:

- `DELIVERY_EXTERNAL_PROVIDERS_ENABLED=false`
- `DELIVERY_EXTERNAL_SMOKE_ENABLED=false`

Si estos flags quedaban `true`, la decision habria sido NO-GO.

## 24. Health

Resultado: PASS.

`curl -fsS http://localhost/api/health`:

```json
{"status":"ok","services":{"api":"ok","database":"ok"}}
```

Stack Docker:

- `inventario-api-1`: healthy.
- `inventario-nginx-1`: healthy.
- `inventario-postgres-1`: healthy.
- `inventario-web-1`: healthy.

## 25. Build/typecheck

Resultado: PASS.

- API typecheck PASS.
- API build PASS.
- API tests PASS.
- Web typecheck PASS.
- Web build PASS.

El build web mantiene warnings ESLint preexistentes de `@typescript-eslint/no-explicit-any`. No bloquearon build ni estan relacionados con delivery.

## 26. Bundle localhost

Resultado: PASS.

`grep -R "localhost:4300" apps/web/.next` devolvio 0 ocurrencias.

## 27. Bugs residuales

- No hay bug bloqueante detectado para delivery/cash/checkout.
- La suite extra `audit8g11h-cookie-fetch-proof.spec.ts` paso, pero reporto nota interna de cookie no visible en storageState. No bloqueo porque el test pasa y el flujo protegido funciona.
- Los specs extra `audit8g11h-auth-reload-final.spec.ts` y `audit8g11h-protected-routes-final.spec.ts` no existen en el repo actual, por lo que no se ejecutaron.
- Queda deuda P3 de limpieza de warnings ESLint `no-explicit-any` en frontend.
- El archivo legacy `apps/api/src/modules/orders/delivery-zones.ts` conserva valores historicos, pero esta aislado y no gobierna pricing final.

## 28. Que queda para auditoria global SYS-0

- Ejecutar auditoria global de regresion de todos los modulos: auth, POS, caja, inventario, compras, gastos, reportes, usuarios, meseros, domiciliarios y WhatsApp.
- Revisar deuda P3 de tipos `any`.
- Confirmar estrategia de despliegue V2 y backup antes de cualquier cutover.
- Confirmar coordenadas productivas y politica final para activar providers externos solo bajo control operativo.

## 29. Decision final

| Criterio | Estado |
| --- | --- |
| Delivery E2E completo PASS | PASS |
| Screenshots 15/15 | PASS |
| Backend tests PASS | PASS |
| Build/typecheck PASS | PASS |
| Caja refleja deliveryFee | PASS |
| Caja sin banner rojo | PASS |
| Local free correcto | PASS |
| Manual quote correcto | PASS |
| Manual fee con motivo correcto | PASS |
| Providers false al final | PASS |
| Bundle limpio | PASS |
| Nginx/rate-limit durable | PASS |

DELIVERY ENTERPRISE FINALIZATION + UI PREMIUM + REGRESSION GATE: GO
