# PROVIDER-LIVE-GEO-0 report

## Resumen ejecutivo

Se validó el flujo real del backend contra proveedores externos con variables temporales de proceso, sin modificar `.env` y sin imprimir secretos. El smoke obtuvo `AUTO_PRICED` para una dirección controlada en Jamundí usando OpenRouteService para geocoding/routing y Open-Meteo para clima.

## Estado recibido

- Delivery automático backend: GO.
- POS display-only: GO.
- Checkout/Caja anti-injection: GO.
- SYS-1 refresh single-flight: GO.

## `.env` auditado masked

- `OPENROUTESERVICE_API_KEY`: `[SET]`.
- Providers externos: desactivados por defecto en `.env`.
- Cache: habilitada.
- Origin lat/lng: configurados.
- Quotas/circuit breaker: configurados.

No se imprimieron valores secretos ni se modificó `.env`.

## Providers configurados

- OpenRouteService geocoding: existe y se usa con boundary country Colombia.
- OpenRouteService routing: existe.
- Open-Meteo weather: existe.
- Nominatim/OSRM fallback: existe.
- ExternalApiCache: existe.
- DeliveryProviderUsage: existe.
- Quota manager y circuit breaker: existen.

## Smoke ejecutado

Script: `apps/api/scripts/provider-live-geo-smoke.ts`.

Comando ejecutado con env temporal:

```bash
DELIVERY_EXTERNAL_PROVIDERS_ENABLED=true DELIVERY_EXTERNAL_SMOKE_ENABLED=true pnpm --filter @inventory-fastfood/api exec ts-node -r tsconfig-paths/register scripts/provider-live-geo-smoke.ts
```

Dirección de prueba: `Alfaguara Mall, Jamundi, Valle del Cauca`.

Resultado:

- Status: `AUTO_PRICED`.
- `finalFee`: calculado por backend.
- `distanceKm`: presente.
- `estimatedMinutes`: presente.
- `providersUsed`: `openrouteservice` y `openmeteo`.
- `calculationVersion`: presente.
- `breakdown`: presente.
- `canCheckout`: coherente con `AUTO_PRICED`.

## Geocoding result

OpenRouteService respondió con confianza suficiente para Jamundí, Colombia. Se ajustó el provider para usar `boundary.country=COL` y foco por origin, evitando resultados ambiguos fuera de Colombia.

## Routing result

OpenRouteService calculó ruta real con distancia y ETA mayores a cero. No se usó Haversine como tarifa final.

## Weather result

Open-Meteo respondió; weather impact quedó presente y sin surcharge para el caso probado.

## Cache result

La primera llamada creó entradas en `ExternalApiCache` para geocoding, routing y weather. La segunda llamada confirmó reutilización/cache estable.

## Provider usage result

`DeliveryProviderUsage` registró éxitos para geocoding, routing y weather. No hubo errores ni circuit breaker abierto.

## Quota/circuit breaker result

Quota no excedida. Circuit breaker cerrado.

## Estado final de flags

Los flags se usaron solo como variables temporales de proceso. No se hardcodearon providers ni se modificó `.env`.

## Validación de secretos

Grep de secretos/hardcode: sin API key impresa y sin hardcode operativo de providers.

## Validaciones

- API typecheck: PASS.
- API build: PASS.
- API test: PASS, 12 suites / 201 tests.
- Web typecheck: PASS.
- Web build: PASS con warnings P3 existentes `no-explicit-any`.
- E2E POS display: PASS aislado.
- E2E checkout/cash: PASS aislado.
- SYS-1 regression: PASS.
- Health: PASS.
- Bundle `localhost:4300`: 0 ocurrencias.

## Riesgos residuales

- El smoke depende de disponibilidad externa de OpenRouteService/Open-Meteo.
- PHASE-4.1 mantiene NO-GO por stress paralelo, no por provider live.

## Recomendación para PHASE-4

Mantener providers disabled por defecto y ejecutar smoke live solo como gate controlado. Corregir stress paralelo antes de production readiness.

## Decisión final

PROVIDER-LIVE-GEO-0: GO
