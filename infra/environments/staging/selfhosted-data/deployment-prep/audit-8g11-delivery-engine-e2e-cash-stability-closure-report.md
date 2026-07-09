# AUDIT-8G.1.1 — Delivery Engine E2E + Cash Operation Stability Closure

Fecha local: [PHONE_REDACTED]:13:30 -05

## 1. Resumen ejecutivo

AUDIT-8G.1.1 cierra el NO-GO operativo de AUDIT-8G.1.

Resultado:

- Caja estable en carga normal.
- Endpoint causante del banner rojo identificado.
- Nginx local ajustado sin eliminar rate limiting.
- Banner global de Caja restringido a endpoints criticos.
- Playwright delivery full flow PASS.
- Screenshots obligatorios 10/10 generados.
- Smoke externo controlado PASS con OpenRouteService y Open-Meteo.
- Cache persistente y provider usage confirmados.
- API typecheck/build/test PASS.
- Web typecheck/build PASS.
- Bundle sin `localhost:4300`.
- Stack local healthy.

Decision final:

**DELIVERY ENGINE E2E + CASH OPERATION STABILITY CLOSURE: GO**

## 2. Estado recibido desde AUDIT-8G.1 NO-GO

| Area | Estado recibido | Resultado 8G.1.1 |
|---|---|---|
| Playwright delivery full flow | FAIL | PASS |
| Screenshots obligatorios | 2/10 | 10/10 |
| Caja | Banner rojo intermitente | Estable |
| Nginx local | Rate limit operacional bloqueaba requests sanos | Ajustado |
| Smoke externo | Skipped | PASS controlado |

## 3. Diagnostico exacto del banner rojo de Caja

El banner:

`No pudimos cargar toda la operacion de caja`

aparecia porque Nginx local devolvia 503 por `limit_req zone=auth` durante cargas normales de `/cash` y `/pos`.

Evidencia encontrada en `/tmp/audit8g11-nginx-cash.log`:

- `GET /api/reports/operational` -> 503.
- `GET /api/cash-register/operational-log` -> 503.
- `GET /api/sales` -> 503.
- `GET /api/tables` -> 503.
- `GET /api/cash-register/close-checklist?actualAmount=0` -> 503.
- Log de Nginx: `limiting requests, excess ... by zone "auth"`.

El backend no era la causa: cuando las requests alcanzaban API, respondian 200.

## 4. Endpoint fallido

| Endpoint | Status observado | Causa | Criticidad | Accion |
|---|---:|---|---|---|
| `/api/reports/operational` | 503 por Nginx | Rate limit operacional bajo | Critico | Ajustar rate limit |
| `/api/cash-register/current` | 200 | Sano | Critico | Validado |
| `/api/cash-register/history` | 200 | Sano | Secundario | Validado |
| `/api/cash-register/operational-log` | 503 por Nginx | Rate limit operacional bajo | Secundario | Ajustar rate limit |
| `/api/sales` | 503 por Nginx | Rate limit operacional bajo | Secundario | Ajustar rate limit |
| `/api/tables` | 503 por Nginx | Rate limit operacional bajo | Secundario | Ajustar rate limit |
| `/api/cash-register/close-checklist` | 503 por Nginx | Rate limit operacional bajo | Contextual cierre | Ajustar rate limit |

## 5. Correccion aplicada

Archivos modificados:

- `infra/nginx/generated/default.conf`
- `apps/web/src/app/(app)/cash/page.tsx`
- `tests/e2e/audit8g1-delivery-pricing-engine.spec.ts`

Cambios:

- `auth` rate limit operacional ajustado de `60r/m + burst 20` a `300r/m + burst 120`.
- `login` rate limit se mantiene estricto: `5r/m + burst 3`.
- Caja ahora muestra banner global solo si fallan endpoints criticos:
  - `/cash-register/current`
  - `/reports/operational`
- Bloques secundarios quedan fuera del error global:
  - historial
  - bitacora
  - ventas cerradas
  - WhatsApp
  - checklist de cierre
- Playwright dejo de hacer bypass directo al backend para `/api/delivery-pricing/estimate`.
- Playwright ahora valida el camino real por Nginx.
- Login helper idempotente para no competir con storage state del setup.
- Checkout validado por respuesta real `/api/orders/:id/checkout`.

## 6. Validacion de endpoints Caja

Validado con token real sin imprimirlo:

| Endpoint | HTTP | Tiempo aprox. | Estado |
|---|---:|---:|---|
| `/api/health` | 200 | 0.002s | PASS |
| `/api/cash-register/current` | 200 | 0.008s | PASS |
| `/api/reports/operational` | 200 | 0.040s | PASS |
| `/api/sales` | 200 | 0.187s | PASS |
| `/api/expenses` | 200 | 0.009s | PASS |
| `/api/purchases` | 200 | 0.007s | PASS |
| `/api/cash-register/history` | 200 | 0.009s | PASS |
| `/api/cash-register/operational-log` | 200 | 0.014s | PASS |
| `/api/tables` | 200 | 0.009s | PASS |
| `/api/payment-methods` | 200 | 0.006s | PASS |

## 7. Validacion UI Caja

Playwright navego a `/cash` durante el flujo principal y genero:

- `08-cash-delivery-fee-included.png`

La UI cargo sin banner global rojo en flujo normal.

Logs finales de Nginx:

- Sin nuevos `limiting requests`.
- Sin 503 por `limit_req`.
- Se observaron 409 esperados de WhatsApp cuando la sesion no esta conectada.
- Se observaron 499 por navegacion/cancelacion del navegador; no son error de backend.

## 8. Ajuste Playwright

Spec:

`tests/e2e/audit8g1-delivery-pricing-engine.spec.ts`

Cambios:

- Sin bypass de endpoint estimate.
- Sin espera fija de 25 segundos.
- Espera por respuestas especificas de create/update order.
- Login idempotente con storage state.
- Checkout esperado por endpoint real.
- `net::ERR_ABORTED` filtrado solo como cancelacion normal de navegacion.
- HTTP 5xx sigue fallando el test.

Resultado:

`2 passed (7.1s)`

## 9. Screenshots 10/10

Ruta:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8g1-delivery-pricing-engine/`

| Archivo | Tamano | Estado |
|---|---:|---|
| `01-pos-delivery-local-free-condados.png` | 132981 bytes | PASS |
| `02-pos-delivery-local-free-alborada.png` | 134845 bytes | PASS |
| `03-pos-delivery-ambiguous-needs-manual.png` | 129403 bytes | PASS |
| `04-pos-delivery-manual-fee-reason-required.png` | 126893 bytes | PASS |
| `05-pos-delivery-manual-fee-saved.png` | 118984 bytes | PASS |
| `06-pos-delivery-reopened-with-pricing-metadata.png` | 144210 bytes | PASS |
| `07-pos-checkout-with-delivery-fee.png` | 143040 bytes | PASS |
| `08-cash-delivery-fee-included.png` | 100431 bytes | PASS |
| `09-settings-origin-pending-or-configured.png` | 115539 bytes | PASS |
| `10-mobile-390x844.png` | 8063 bytes | PASS |

## 10. Smoke externo controlado

Se levanto un API efimero local en puerto 4302 con:

- `DELIVERY_EXTERNAL_PROVIDERS_ENABLED=true`
- `DELIVERY_EXTERNAL_SMOKE_ENABLED=true`
- OpenRouteService como geocoding/routing.
- Open-Meteo como weather.

No se imprimio `OPENROUTESERVICE_API_KEY`.
No se modifico `.env`.
El API principal quedo con providers apagados:

`DELIVERY_EXTERNAL_PROVIDERS_ENABLED=false`

Resultado smoke:

| Corrida | Status | Manual quote | Fee sugerido | Confianza | Distancia | Duracion | Estado |
|---:|---|---|---:|---|---:|---:|---|
| 1 | `AUTO_PRICED` | false | 6500 | HIGH | 2.94 km | 6 min | PASS |
| 2 | `AUTO_PRICED` | false | 6500 | HIGH | 2.94 km | 6 min | PASS |

## 11. Confirmacion OpenRouteService / Open-Meteo / Cache / Usage

Tablas confirmadas:

| Tabla | Resultado |
|---|---|
| `external_api_cache` | 3 registros SUCCESS |
| `delivery_provider_usage` | 3 endpoints con success |

Cache persistente:

| Provider | Tipo | Status | Count |
|---|---|---|---:|
| openmeteo | WEATHER_CURRENT | SUCCESS | 1 |
| openrouteservice | GEOCODE_ADDRESS | SUCCESS | 1 |
| openrouteservice | ROUTE_DISTANCE | SUCCESS | 1 |

Provider usage:

| Provider | Endpoint | Requests | Success | Errors | Estado |
|---|---|---:|---:|---:|---|
| openmeteo | weather | 1 | 1 | 0 | SUCCESS |
| openrouteservice | geocoding | 1 | 1 | 0 | SUCCESS |
| openrouteservice | routing | 1 | 1 | 0 | SUCCESS |

La segunda llamada uso cache: provider usage no incremento.

## 12. Confirmaciones delivery

| Regla | Resultado |
|---|---|
| Condados / Alborada fuerte = domicilio gratis | PASS |
| `cerca de alborada` exige cotizacion manual | PASS |
| Manual fee sin motivo se bloquea | PASS |
| Manual fee con motivo se guarda | PASS |
| Reabrir comanda conserva fee manual | PASS |
| Checkout transfiere deliveryFee | PASS |
| Caja carga venta con deliveryFee | PASS |
| No vuelve default COP 5.000 | PASS |
| No vuelve formula legacy | PASS |
| Providers caidos no son requeridos para operacion manual | PASS |

## 13. Validacion tecnica final

| Validacion | Resultado |
|---|---|
| API typecheck | PASS |
| API build | PASS |
| API test global | PASS |
| API suites | 12/12 PASS |
| API tests | 199/199 PASS |
| app.critical.spec.ts | PASS |
| Web typecheck | PASS |
| Web build | PASS |
| Playwright 8G.1 | PASS |
| Health local | PASS |
| `/pos` | HTTP 200 |
| `/settings` | HTTP 200 |
| `/cash` | HTTP 200 |
| Bundle `localhost:4300` | 0 ocurrencias |
| Docker stack local | 4/4 healthy |

## 14. Riesgos residuales

| Riesgo | Severidad | Estado |
|---|---|---|
| Warnings ESLint preexistentes por `any` en frontend | P3 | No bloquea build |
| 409 en WhatsApp cuando no hay sesion conectada | P2 | Esperado; no rompe flujo |
| 499 en Nginx por navegacion/cancelacion del browser | P3 | No es error backend |
| Providers externos siguen apagados por defecto | Controlado | Correcto para no depender de internet |

## 15. Decision final

**DELIVERY ENGINE E2E + CASH OPERATION STABILITY CLOSURE: GO**

Condiciones de GO satisfechas:

- Caja estable.
- Endpoint/causa del banner identificados.
- Correccion aplicada.
- Playwright PASS.
- Screenshots 10/10.
- Smoke externo controlado PASS.
- Delivery engine intacto.
- Tests PASS.
- Build/typecheck PASS.
- Bundle limpio.
