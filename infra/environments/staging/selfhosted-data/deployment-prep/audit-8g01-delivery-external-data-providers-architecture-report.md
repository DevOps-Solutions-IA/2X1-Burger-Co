# AUDIT-8G.0.1 — Delivery External Data Providers Architecture

Fecha: 2026-06-20  
Sistema: inventario-fastfood-system / 2X1 Burger Co  
Decisión: DELIVERY EXTERNAL DATA PROVIDERS ARCHITECTURE: GO CONDICIONADO

## 1. Resumen ejecutivo

Se creó una arquitectura desacoplada para preparar datos externos de domicilios antes del motor final de precios. Esta fase no implementa tarifa final automática, no reintroduce default silencioso de COP 5.000, no reactiva bandas legacy y no acopla OrdersService ni POS a proveedores externos.

El sistema queda con contratos explícitos para clima, geocodificación, rutas y cache, más un servicio de resolución de contexto de domicilio. Los proveedores reales quedan preparados detrás de variables de entorno y deshabilitados por defecto. Los tests unitarios usan mocks y no hacen llamadas reales a internet.

La decisión es GO CONDICIONADO porque el cache implementado es in-memory inicial y queda como deuda P1 crear persistencia tipo ExternalApiCache antes de producción. Además, la suite API global falló por deadlock/timeout en el reset de DB de `app.critical.spec.ts`, aunque los tests focales de delivery y build/typecheck pasaron.

## 2. Estado base después de AUDIT-8G.0

- La lógica vieja de domicilios quedó desactivada.
- No hay cálculo automático final por baseRate/km/bandas.
- No hay fallback automático COP 5.000 activo.
- OrdersService usa `DeliveryPricingService` como boundary para pricing reset.
- POS mantiene fee manual.
- Checkout conserva `deliveryFee` manual y lo transfiere a Sale.
- Caja/comprobantes siguen leyendo `deliveryFee`.
- Settings ya no presenta el sistema viejo como completo.

## 3. Contratos creados

Archivos:

- `apps/api/src/delivery/providers/provider-types.ts`
- `apps/api/src/delivery/providers/provider-errors.ts`
- `apps/api/src/delivery/providers/weather-provider.interface.ts`
- `apps/api/src/delivery/providers/geocoding-provider.interface.ts`
- `apps/api/src/delivery/providers/routing-provider.interface.ts`
- `apps/api/src/delivery/providers/external-cache.interface.ts`

Contratos:

- `WeatherProvider.getCurrentWeather(request)`
- `GeocodingProvider.geocodeAddress(request)`
- `GeocodingProvider.reverseGeocode(request)`
- `RoutingProvider.getRoute(request)`
- `ExternalCache.get/set/delete`
- `DeliveryExternalDataService.resolveDeliveryContext(request)`

## 4. WeatherProvider

Implementación preparada:

- `apps/api/src/delivery/providers/open-meteo-weather.provider.ts`

Reglas implementadas:

- No calcula recargos.
- Usa timeout vía `fetchJsonWithTimeout`.
- Devuelve `isRaining`, `precipitationMm`, `rainIntensity`, `confidence` y warnings.
- Si falla, `DeliveryExternalDataService` agrega `WEATHER_UNAVAILABLE`.
- La falla de clima no bloquea operación manual si ruta/destino son confiables.

## 5. GeocodingProvider

Implementación preparada:

- `apps/api/src/delivery/providers/nominatim-geocoding.provider.ts`

Reglas implementadas:

- Normaliza request con dirección, barrio, ciudad y país.
- Usa timeout.
- Usa User-Agent configurable.
- `NOT_FOUND` y `AMBIGUOUS` fuerzan cotización manual.
- Nunca se persisten coordenadas desde este servicio.
- Coordenadas ambiguas no se tratan como confiables.

## 6. RoutingProvider

Implementación preparada:

- `apps/api/src/delivery/providers/osrm-routing.provider.ts`

Reglas implementadas:

- Usa ruta real como fuente de distancia/tiempo.
- Usa timeout.
- `ROUTING_UNAVAILABLE` fuerza cotización manual si no hay alternativa confiable.
- Haversine solo queda como referencia de contexto, no como base de tarifa.

## 7. ExternalCache

Implementación actual:

- `apps/api/src/delivery/providers/in-memory-external-cache.ts`

Interfaz:

- `ExternalCache.get(cacheKey)`
- `ExternalCache.set(cacheKey, value, ttlSeconds)`
- `ExternalCache.delete(cacheKey)`

TTLs usados:

- Weather: 15 minutos.
- Geocoding: 90 días.
- Route: 14 días.

Riesgo:

- Cache no es persistente todavía.
- Requisito para GO completo: tabla `ExternalApiCache` o implementación persistente equivalente.

## 8. DeliveryExternalDataService

Archivo:

- `apps/api/src/delivery/providers/delivery-external-data.service.ts`

Responsabilidad:

- Resolver contexto operativo de domicilio.
- Coordinar origen, destino, geocoding, route, weather y zona local.
- Consolidar warnings y confianza.
- Decidir si requiere cotización manual.
- No calcular tarifa final.

Salida incluye:

- `origin`
- `destination`
- `geocoding`
- `route`
- `weather`
- `localZoneMatch`
- `confidence`
- `requiresManualQuote`
- `warnings`

## 9. Variables de entorno

Agregadas en `.env.example` y `apps/api/src/config/env.ts`:

- `DELIVERY_EXTERNAL_PROVIDERS_ENABLED=false`
- `DELIVERY_WEATHER_PROVIDER=openmeteo`
- `DELIVERY_GEOCODING_PROVIDER=nominatim`
- `DELIVERY_ROUTING_PROVIDER=osrm`
- `DELIVERY_EXTERNAL_TIMEOUT_MS=3000`
- `DELIVERY_CACHE_ENABLED=true`
- `DELIVERY_ORIGIN_LAT=`
- `DELIVERY_ORIGIN_LNG=`
- `DELIVERY_ORIGIN_LABEL=2X1 Burger Co`
- `DELIVERY_ORIGIN_ADDRESS=`
- `DELIVERY_GEOCODING_USER_AGENT=2x1burger-delivery-context/1.0`

Los proveedores externos quedan deshabilitados por defecto.

## 10. Origen del local

Estado: pendiente.

No se inventaron coordenadas.

Si `DELIVERY_ORIGIN_LAT` y `DELIVERY_ORIGIN_LNG` no están configuradas:

- `origin.configured=false`
- `requiresManualQuote=true`
- warning `ORIGIN_COORDINATES_MISSING`

Settings recibió bloque mínimo:

- “Ubicación base de domicilios”
- Dirección del local
- Latitud
- Longitud
- Estado pendiente
- Mensaje de que las tarifas deben confirmarse manualmente por ahora

## 11. Local zone match preparatorio

Archivo:

- `apps/api/src/delivery/providers/local-zone-match.ts`

Detecta:

- Condados
- Alborada
- Condados de la Alborada
- La Alborada
- Barrio Alborada
- Condados Alborada

Normaliza:

- Tildes
- Mayúsculas
- Espacios dobles
- Puntuación

Reglas:

- Alias fuerte: `matched=true`, `confidence=HIGH`.
- “cerca de alborada” o “por alborada”: `ambiguous=true`, `matched=false`.
- No calcula tarifa gratis ni aplica descuento.

## 12. Fallbacks seguros

Implementados:

- Sin coordenadas de origen: `ORIGIN_COORDINATES_MISSING`, cotización manual.
- Sin dirección ni coordenadas de destino: `DESTINATION_MISSING`, cotización manual.
- Dirección ambigua: `GEOCODING_AMBIGUOUS`, cotización manual.
- Dirección no encontrada: `GEOCODING_NOT_FOUND`, cotización manual.
- Routing fallido: `ROUTING_UNAVAILABLE`, cotización manual si no hay ruta confiable.
- Weather fallido: `WEATHER_UNAVAILABLE`, no bloquea operación manual.
- Proveedores deshabilitados: `EXTERNAL_PROVIDERS_DISABLED`, sin fallback de tarifa.

## 13. Adaptadores preparados

Archivos:

- `apps/api/src/delivery/providers/open-meteo-weather.provider.ts`
- `apps/api/src/delivery/providers/nominatim-geocoding.provider.ts`
- `apps/api/src/delivery/providers/osrm-routing.provider.ts`
- `apps/api/src/delivery/providers/provider-http.ts`

Los adaptadores usan timeout y quedan detrás de configuración. No se agregaron API keys reales.

## 14. Tests con mocks

Archivo:

- `apps/api/src/delivery/providers/delivery-external-data.service.spec.ts`

Resultado:

- PASS 18/18

Casos cubiertos:

- Clima sin lluvia.
- Clima con lluvia.
- Timeout/falla de clima.
- Geocoding exacto.
- Geocoding ambiguo.
- Geocoding no encontrado.
- Ruta exitosa.
- Routing timeout.
- Haversine solo como referencia.
- Origen sin coordenadas.
- Destino con coordenadas intenta route.
- Condados/Alborada alias fuerte.
- “cerca de alborada” ambiguo.
- Todo falla requiere cotización manual.
- Cache evita geocoding repetido.
- No se restaura fallback COP 5.000.
- OrdersService no importa `delivery-zones`.
- Legacy pricing sigue marcado como no activo.

## 15. Regresión de reset

Archivo:

- `apps/api/src/delivery/delivery-pricing/delivery-pricing.spec.ts`

Resultado:

- PASS 7/7

Confirmado:

- Dirección desconocida no genera COP 5.000 automático.
- Barrio no reconocido requiere cotización manual.
- Input vacío queda inválido/manual pendiente.
- ManualFee 7000 con motivo es aceptado.
- ManualFee sin motivo genera warning.
- baseRate/costPerKm no determinan `finalFee`.
- Condados/Alborada no usa pricing legacy automático.

## 16. Resultado typecheck/build

API:

- `pnpm --filter @inventory-fastfood/api typecheck`: PASS
- `pnpm --filter @inventory-fastfood/api build`: PASS

Web:

- `pnpm --filter @inventory-fastfood/web typecheck`: PASS
- `pnpm --filter @inventory-fastfood/web build`: PASS

Nota:

- Web build muestra warnings preexistentes de `@typescript-eslint/no-explicit-any`, sin fallo.

## 17. Suite API global

Comando:

- `pnpm --filter @inventory-fastfood/api test`

Resultado:

- FAIL por `src/tests/app.critical.spec.ts`
- 7 suites PASS
- 159 tests PASS
- 2 tests FAIL

Causa observada:

- Timeout de hook en `beforeEach`.
- Deadlock detectado por PostgreSQL durante `TRUNCATE` en `tests/helpers/test-data.ts`.

Evaluación:

- No apunta a la arquitectura nueva de delivery.
- Los tests focales de delivery y reset pasaron.
- Debe corregirse como deuda de estabilidad del harness de pruebas críticas.

## 18. Bundle localhost

Comando:

- `rg "localhost:4300" apps/web/.next`

Resultado:

- 0 ocurrencias.

## 19. Health local

Comando:

- `curl http://localhost/api/health`

Resultado:

- `status=ok`
- `api=ok`
- `database=ok`

## 20. Riesgos residuales

P1:

- Cache externo aún no es persistente. Implementar `ExternalApiCache` con TTL, status, requestHash y responseJson antes de habilitar proveedores en producción.

P1:

- Suite API global tiene flake/deadlock en `app.critical.spec.ts` durante reset de DB de pruebas. Debe endurecerse el harness de test para evitar locks cruzados.

P2:

- Origen del local pendiente de coordenadas reales.

P2:

- Proveedores externos están preparados pero deshabilitados por defecto; no hay smoke contra proveedor real en esta fase por regla hardline.

## 21. Qué NO se implementó todavía

- Motor final de precios.
- Tarifa automática por clima/ruta/zona.
- Recargo lluvia.
- Zona gratis por geopolígono.
- Persistencia de cache en DB.
- Llamadas externas desde POS.
- Guardado automático de coordenadas geocodificadas.
- Activación productiva de proveedores.

## 22. Próximo paso recomendado

AUDIT-8G.1 — DELIVERY PRICING ENGINE 2X1 ENTERPRISE FROM SCRATCH.

Antes de AUDIT-8G.1 productivo:

- Crear cache persistente.
- Configurar coordenadas reales del local.
- Corregir deadlock/timeout de `app.critical.spec.ts`.
- Mantener `DELIVERY_EXTERNAL_PROVIDERS_ENABLED=false` hasta completar smoke controlado.

## 23. Decisión final

DELIVERY EXTERNAL DATA PROVIDERS ARCHITECTURE: GO CONDICIONADO

Razón:

- Contratos, servicio, adaptadores, fallbacks, cache inicial y tests con mocks están listos.
- Reset de AUDIT-8G.0 no regresó.
- Build/typecheck pasan.
- Bundle limpio.
- No hay pricing automático nuevo.
- No hay COP 5.000 silencioso activo.
- Condicionado por cache no persistente y flake/deadlock en suite API global.
