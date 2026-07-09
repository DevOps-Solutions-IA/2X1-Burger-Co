# RUNTIME-DELIVERY-GEO-ADDRESS-FIX-1 Report

## 1. Resumen ejecutivo

Se corrigió el flujo runtime de geolocalización de domicilios para que el POS no exponga códigos internos, no muestre `COP 0` cuando el checkout está bloqueado y el backend arme consultas de geocoding con dirección completa: dirección, barrio, ciudad, departamento y país.

Decisión: **GO**.

## 2. Problema visual recibido

El POS mostraba estado `CORREGIR`, mensaje genérico, código interno `DESTINATION_MISSING`, tarifa `COP 0` y toast técnico de coordenadas para una dirección real de Jamundí.

Dirección recibida:

- Dirección: `calle 11 2as # 167`
- Barrio/sector: `portal de jamundi`

## 3. Env runtime masked

| Variable | Estado seguro |
| --- | --- |
| `DELIVERY_EXTERNAL_PROVIDERS_ENABLED` | `true` |
| `DELIVERY_EXTERNAL_SMOKE_ENABLED` | `true` |
| `DELIVERY_GEOCODING_PROVIDER` | `openrouteservice` |
| `DELIVERY_ROUTING_PROVIDER` | `openrouteservice` |
| `DELIVERY_WEATHER_PROVIDER` | `openmeteo` |
| `OPENROUTESERVICE_API_KEY` | `[SET]` |

Evidencia: `/tmp/runtime-delivery-geo-address-fix-1/api-env-masked.log`.

## 4. Causa de `DESTINATION_MISSING`

El backend emitía `DESTINATION_MISSING` / `DESTINATION_COORDINATES_MISSING` cuando no obtenía coordenadas confiables, pero el POS:

- limpiaba solo algunos códigos internos, no `DESTINATION_MISSING`;
- mostraba warnings raw en `pos-delivery-warning`;
- renderizaba `formatCurrency(deliveryFeeValue)` aun cuando `canCheckout=false`;
- mostraba distancia/ETA/zona aunque el resultado no era cobrable.

Adicionalmente, OpenRouteService recibía una query incompleta: `addressText + neighborhood + city + country`, sin departamento y sin fallback progresivo.

## 5. Corrección UI raw codes

Archivo: `apps/web/src/app/(app)/pos/page.tsx`.

Cambios:

- Se agregó saneamiento de códigos internos explícitos y genéricos `MAYUSCULAS_CON_GUIONES`.
- `DESTINATION_MISSING`, `DESTINATION_COORDINATES_MISSING` y `GEOCODING_*` ahora se traducen a: `No se pudo ubicar la dirección. Agrega más detalle.`
- `LOCAL_ZONE_AMBIGUOUS` y `NEEDS_ADDRESS_CORRECTION` se traducen a: `Agrega ciudad, barrio o punto de referencia.`
- `pos-delivery-pricing-status` ahora expone etiquetas operativas: `GRATIS`, `CALCULADA`, `CORREGIR`, `NO DISPONIBLE`, `SIN COBERTURA`, `REINTENTAR`.
- `pos-delivery-warning` ya no imprime raw warnings.

## 6. Corrección COP 0 falso

Archivo: `apps/web/src/app/(app)/pos/page.tsx`.

Reglas aplicadas:

- Si `canCheckout=false`: tarifa visible `—`.
- Si `LOCAL_FREE`: tarifa visible `COP 0`.
- Si `AUTO_PRICED`: tarifa visible en COP.
- Si estado bloqueado: distancia `—`, tiempo `—`, zona `Revisar`.

## 7. Corrección full address geocoding

Archivos:

- `apps/api/src/delivery/providers/provider-types.ts`
- `apps/api/src/delivery/dto/estimate-delivery-pricing.dto.ts`
- `apps/api/src/delivery/delivery-pricing.controller.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.types.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.service.ts`
- `apps/api/src/delivery/providers/delivery-external-data.service.ts`
- `apps/api/src/delivery/providers/openrouteservice-geocoding.provider.ts`
- `apps/api/src/delivery/providers/nominatim-geocoding.provider.ts`

Defaults locales:

- City: `Jamundí`
- State: `Valle del Cauca`
- Country: `Colombia`

Fallback progresivo OpenRouteService:

1. `address + neighborhood + city + state + country`
2. `address + city + state + country`
3. `neighborhood + city + state + country`
4. `reference + neighborhood + city + state + country`

El cache key de geocoding subió a `address-v3` e incluye dirección, barrio, referencia, ciudad, departamento, país y origen.

## 8. Casos smoke A/B/C

Script: `apps/api/scripts/runtime-delivery-address-smoke.ts`.

Ejecución: `/tmp/runtime-delivery-geo-address-fix-1/runtime-address-smoke.log`.

| Caso | Resultado |
| --- | --- |
| POI `Portal de Jamundí` | `AUTO_PRICED`, `finalFee=9000`, `distanceKm=3.1`, `estimatedMinutes=7`, providers `openrouteservice/openmeteo` |
| Dirección compuesta recibida | `OUT_OF_COVERAGE`, `canCheckout=false`, `finalFee=null`, sin `DESTINATION_MISSING` |
| Local free `Condados de la Alborada` | `LOCAL_FREE`, `finalFee=0`, `canCheckout=true` |

## 9. POS visual

Spec: `tests/e2e/runtime-delivery-geo-address-fix-1.spec.ts`.

Validó:

- No se muestra `DESTINATION_MISSING`.
- Warning y toast usan copy limpio.
- Estado bloqueado muestra `—`, no `COP 0`.
- POI auto-priced muestra tarifa, distancia y tiempo.
- Local free mantiene `COP 0` válido.
- Mobile 390px conserva copy limpio.

## 10. Screenshots

Carpeta: `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/runtime-delivery-geo-address-fix-1/`.

| Screenshot | Estado |
| --- | --- |
| `01-destination-missing-no-raw-code-no-cop0.png` | Existe |
| `02-poi-auto-priced-distance-time.png` | Existe |
| `03-local-free-cop0-valid.png` | Existe |
| `04-toast-clean-address-detail.png` | Existe |
| `05-mobile-clean.png` | Existe |

## 11. Regression

| Gate | Estado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `/tmp/runtime-delivery-geo-address-fix-1/api-typecheck.log` |
| API build | PASS | `/tmp/runtime-delivery-geo-address-fix-1/api-build.log` |
| API test | PASS, 12 suites / 201 tests | `/tmp/runtime-delivery-geo-address-fix-1/api-test.log` |
| Web typecheck | PASS | `/tmp/runtime-delivery-geo-address-fix-1/web-typecheck.log` |
| Web build | PASS | `/tmp/runtime-delivery-geo-address-fix-1/web-build.log` |
| E2E POS display | PASS | `/tmp/runtime-delivery-geo-address-fix-1/e2e-pos-display.log` |
| E2E checkout/cash | PASS | `/tmp/runtime-delivery-geo-address-fix-1/e2e-checkout-cash.log` |
| E2E harness stability | PASS | `/tmp/runtime-delivery-geo-address-fix-1/e2e-harness-stability.log` |
| E2E runtime screenshots | PASS | `/tmp/runtime-delivery-geo-address-fix-1/e2e-runtime-geo-address-fix.log` |
| Health | PASS | `/tmp/runtime-delivery-geo-address-fix-1/health.log` |
| Bundle `localhost:4300` | PASS, 0 ocurrencias | `/tmp/runtime-delivery-geo-address-fix-1/bundle-localhost4300.log` |

## 12. Secretos no impresos

- `OPENROUTESERVICE_API_KEY` solo fue reportada como `[SET]`.
- No se imprimieron headers de autorización.
- No se modificó `.env`.
- Secret grep final sin hallazgos: `/tmp/runtime-delivery-geo-address-fix-1/secret-grep-final.log`.

## 13. Riesgos residuales

- La dirección `calle 11 2as # 167, portal de jamundi` fue geocodificada/ruteada por providers reales pero cayó en `OUT_OF_COVERAGE` con distancia muy alta. No se permite checkout y no se inventa tarifa. Esto queda como dato operacional para depurar precisión del input/dirección en una fase posterior si negocio confirma la dirección exacta.
- El smoke local-free conserva `LOCAL_FREE` y `COP 0`; puede incluir metadata externa de contexto, pero pricing final sigue dominado por regla local-free.
- Persisten warnings P3 `no-explicit-any` preexistentes en frontend durante `next build`; no bloquean este hotfix.

## 14. Decisión final

**RUNTIME-DELIVERY-GEO-ADDRESS-FIX-1: GO**
