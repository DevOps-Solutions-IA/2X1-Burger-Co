# DELIVERY-GOOGLE-MAPS-CORE-0 Report

## 1. Resumen ejecutivo

Google Maps Platform quedó integrado como proveedor operativo principal backend para búsqueda, resolución de coordenadas y cálculo de ruta de domicilios. Las reglas locales gratis se evalúan antes de Google y no consumen proveedor externo. El POS sigue siendo display-only: captura dirección, muestra sugerencias, resuelve ubicación y muestra tarifa calculada por backend sin permitir tarifa manual ni `deliveryFee` arbitrario.

Decisión final: **GO**.

## 2. Decisión de arquitectura

- Proveedor principal: `google`.
- Places/search: backend only.
- Place details/resolve: backend only.
- Routes: backend only.
- Pricing final: backend only.
- POS: captura y visualización, sin cálculo local.
- OpenRouteService: conserva compatibilidad/fallback configurado por entorno, pero no es proveedor principal de esta fase.

## 3. Env/config masked

Evidencia:

- `/tmp/delivery-google-maps-core-0/env-masked.log`
- `/tmp/delivery-google-maps-core-0/api-container-env-masked.log`

Resultado seguro:

- `GOOGLE_MAPS_API_KEY=[SET]`
- `OPENROUTESERVICE_API_KEY=[SET]`
- `DELIVERY_PROVIDER_PRIMARY=google`
- `DELIVERY_PLACES_PROVIDER=google`
- `DELIVERY_GEOCODING_PROVIDER=google`
- `DELIVERY_ROUTING_PROVIDER=google`
- Google Places/Geocoding/Routes enabled en runtime.

No se imprimieron valores de claves.

## 4. Local free antes de Google

Reglas protegidas:

- Condados.
- Alborada.
- Condados de la Alborada.
- La Alborada.

Resultado esperado y validado:

- `status=LOCAL_FREE`
- `finalFee=0`
- `canCheckout=true`
- `googleUsageDelta=0`

Evidencia: `/tmp/delivery-google-maps-core-0/google-jamundi-smoke.log`.

## 5. Google Places search

Endpoint agregado:

- `POST /delivery-location/search`

Características:

- Ejecuta Google desde backend.
- No expone API key.
- No devuelve payload crudo de Google.
- Cachea por query normalizada con `ExternalApiCache`.
- Registra provider usage endpoint `places`.
- Aplica mínimo de 3 caracteres desde frontend.

Smoke:

- Query: `portal de jamundi`
- Resultado: sugerencias Google disponibles para Jamundí.
- Provider usage: `google/places SUCCESS`.

## 6. Google resolve

Endpoint agregado:

- `POST /delivery-location/resolve`

Características:

- Place ID usa Google Place Details.
- Fallback text usa Google Geocoding.
- Devuelve coordenadas y confianza sanitizadas.
- Mensaje limpio si no hay ubicación confiable.

Smoke:

- Resolve con Place ID: coordenadas presentes, `confidence=HIGH`.
- Provider usage: `google/place-details SUCCESS`.

## 7. Google routes

Proveedor agregado:

- `GoogleRoutesProvider`

Características:

- Usa backend Google Routes.
- Devuelve `distanceKm`, `estimatedMinutes`, `routeConfidence`.
- No usa Haversine como tarifa final.
- Si falla ruta, no inventa tarifa.

Smoke:

- `distanceKm=3.08`
- `estimatedMinutes=9`
- Provider usage: `google/routing SUCCESS`

## 8. Backend pricing

`POST /delivery-pricing/estimate` acepta ubicación confiable:

- `provider`
- `placeId`
- `formattedAddress`
- `latitude`
- `longitude`
- `confidence`

Reglas:

- Local free domina y evita llamada Google.
- Ubicación confiable usa ruta real.
- Sin ubicación confiable: checkout bloqueado y `finalFee=null`.
- No acepta `deliveryFee` arbitrario desde frontend.

Smoke estimate:

- `status=AUTO_PRICED`
- `finalFee=9000`
- `canCheckout=true`
- `providersUsed.geocodingProvider=google`
- `providersUsed.routingProvider=google`

## 9. POS display-only

Cambios:

- Campo “Dirección o punto de referencia”.
- Search con debounce.
- Sugerencias limpias.
- Resolve al seleccionar sugerencia.
- Botón “Calcular domicilio”.
- Resultado muestra fee/km/min/status desde backend.
- Sin tarifa manual.
- Sin códigos internos visibles.
- Sin `COP 0` falso cuando `canCheckout=false`.

Evidencia visual: screenshots en `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/delivery-google-maps-core-0/`.

## 10. Control de costos

Implementado/validado:

- Cache para Places search: `PLACE_SEARCH`.
- Cache para Place details: `PLACE_DETAILS`.
- Cache para geocoding: `GEOCODE_ADDRESS`.
- Cache para routes: `ROUTE_DISTANCE`.
- Provider usage: `places`, `place-details`, `geocoding`, `routing`.
- Google daily limit: `DELIVERY_GOOGLE_DAILY_LIMIT`.
- Soft/hard limit Google: `DELIVERY_GOOGLE_SOFT_LIMIT_PERCENT`, `DELIVERY_GOOGLE_HARD_LIMIT_PERCENT`.
- Circuit breaker integrado vía `DeliveryProviderUsage`.
- Logs sin headers ni claves.

## 11. Smoke Google Jamundí

Script:

- `apps/api/scripts/google-jamundi-smoke.ts`

Evidencia:

- `/tmp/delivery-google-maps-core-0/google-jamundi-smoke.log`

Resultados:

- Env Google masked: PASS.
- Local free sin Google: PASS.
- Places search: PASS.
- Resolve: PASS.
- Routes: PASS.
- Estimate AUTO_PRICED: PASS.
- Caso inválido bloqueado: PASS.
- Provider usage/cache/cuota/circuit breaker evidenciado: PASS.

## 12. Regresión

API:

- Typecheck: PASS.
- Build: PASS.
- Test: 201/201 PASS.

Web:

- Typecheck: PASS.
- Build: PASS con warnings P3 `no-explicit-any` preexistentes.

E2E:

- `phase-delivery-auto-2-pos-display`: PASS.
- `phase-delivery-auto-3-checkout-cash-audit`: PASS.
- `phase-delivery-auto-4-harness-stability`: PASS.
- `phase-delivery-auto-4-secondary-routes`: PASS.
- `sys1-auth-refresh-concurrency`: PASS.
- `delivery-google-maps-core-0`: PASS.

## 13. Screenshots

| Screenshot | Existe | Tamaño | Qué demuestra |
|---|---:|---:|---|
| 01-google-search-suggestions.png | Sí | 124366 bytes | Sugerencias Google limpias |
| 02-google-place-selected.png | Sí | 132433 bytes | Lugar seleccionado y resuelto |
| 03-google-auto-priced.png | Sí | 136834 bytes | AUTO_PRICED con tarifa/km/min |
| 04-local-free-no-google-needed.png | Sí | 128826 bytes | LOCAL_FREE COP 0 válido |
| 05-invalid-address-checkout-blocked.png | Sí | 127997 bytes | Dirección inválida bloqueada sin COP 0 falso |
| 06-mobile-clean.png | Sí | 1638966 bytes | Vista móvil limpia |

## 14. Secretos no impresos

Validación:

- `/tmp/delivery-google-maps-core-0/secret-grep-final.log`

Resultado:

- Sin claves hardcodeadas en `apps`, `infra`, `tests`, `scripts`, `prisma`.
- `.env` real fue excluido explícitamente del grep para evitar imprimir secretos.
- `.env` real no fue modificado.

## 15. Health

Evidencia:

- `/tmp/delivery-google-maps-core-0/health.log`

Resultado:

- `status=ok`
- API OK.
- Database OK.

## 16. Bundle

Evidencia:

- `/tmp/delivery-google-maps-core-0/bundle-localhost4300.log`

Resultado:

- 0 ocurrencias de `localhost:4300`.

## 17. Docker build reproducible

Evidencia:

- `/tmp/delivery-google-maps-core-0/docker-compose-build-api-web.log`

Resultado:

- `inventario-api Built`
- `inventario-web Built`

## 18. Riesgos residuales

- P3: warnings frontend `no-explicit-any` preexistentes siguen visibles en build.
- P3: Google Places para `portal de jamundi` devolvió una sugerencia municipal usable; el negocio puede refinar sesgo/tipos de Places si quiere una selección más específica de POI.
- P3: OpenRouteService queda como fallback documentado/configurable, no como provider principal.

No quedan P0/P1/P2 abiertos para esta fase.

## 19. Decisión final

**DELIVERY-GOOGLE-MAPS-CORE-0: GO**
