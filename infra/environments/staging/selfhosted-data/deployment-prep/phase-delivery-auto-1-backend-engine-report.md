# PHASE-DELIVERY-AUTO-1 — Backend Automated Delivery Pricing Engine

Fecha UTC: 2026-06-21

## 1. Resumen ejecutivo

PHASE-DELIVERY-AUTO-1 deja el backend como fuente operativa de verdad para domicilios:

- El engine ya no emite `MANUAL_CONFIRMED` ni acepta `manualFee` como tarifa operativa.
- El endpoint `POST /delivery-pricing/estimate` devuelve contrato automático con `canCheckout`, `requiresAddressCorrection`, `reasonCode`, `humanMessage`, `providersUsed`, `weatherImpact`, `zoneMatch` y `auditId`.
- OrdersService deja de usar `deliveryFee` enviado por frontend como `manualFee`.
- Checkout de DELIVERY queda bloqueado si el snapshot no está en `LOCAL_FREE` o `AUTO_PRICED`.
- Campos legacy manuales se preservan como audit-only/históricos, sin borrar columnas ni migraciones.

Decisión: **GO**.

## 2. Estado recibido

- AUDIT-8G.2: GO.
- SYS-1: GO.
- CLEAN-DELIVERY-UI-DEEPSEEK-0: GO.
- Providers externos siguen controlados por `.env`, sin hardcodear flags.

## 3. Validación segura de `.env`

No se imprimieron secretos. `OPENROUTESERVICE_API_KEY` fue validada solo como `[SET]`.

| Variable | Existe | Valor seguro/masked | Riesgo | Acción |
|---|---:|---|---|---|
| DELIVERY_EXTERNAL_PROVIDERS_ENABLED | Sí | false | Bajo | Mantener controlado por env |
| DELIVERY_EXTERNAL_SMOKE_ENABLED | Sí | false | Bajo | Mantener desactivado |
| DELIVERY_GEOCODING_PROVIDER | Sí | openrouteservice | Bajo | OK |
| DELIVERY_ROUTING_PROVIDER | Sí | openrouteservice | Bajo | OK |
| DELIVERY_WEATHER_PROVIDER | Sí | openmeteo | Bajo | OK |
| DELIVERY_EXTERNAL_TIMEOUT_MS | Sí | 3000 | Bajo | OK |
| DELIVERY_CACHE_ENABLED | Sí | true | Bajo | OK |
| DELIVERY_OPENMETEO_DAILY_LIMIT | Sí | 10000 | Bajo | OK |
| DELIVERY_OPENROUTESERVICE_DIRECTIONS_DAILY_LIMIT | Sí | 2000 | Bajo | OK |
| DELIVERY_OPENROUTESERVICE_GEOCODING_DAILY_LIMIT | Sí | 3000 | Bajo | OK |
| DELIVERY_PROVIDER_QUOTA_SOFT_LIMIT_PERCENT | Sí | 85 | Bajo | OK |
| DELIVERY_PROVIDER_QUOTA_HARD_LIMIT_PERCENT | Sí | 95 | Bajo | OK |
| DELIVERY_CIRCUIT_BREAKER_ERROR_THRESHOLD | Sí | 5 | Bajo | OK |
| DELIVERY_CIRCUIT_BREAKER_COOLDOWN_MINUTES | Sí | 10 | Bajo | OK |
| OPENROUTESERVICE_API_KEY | Sí | [SET] | Bajo | No imprimir |

Evidencia: `/tmp/phase-delivery-auto-1/env-safe-audit.log`.

## 4. Contrato automático del endpoint

Archivo principal: `apps/api/src/delivery/delivery-pricing/delivery-pricing.types.ts`.

Campos agregados/asegurados:

- `currency: "COP"`
- `canCheckout`
- `requiresAddressCorrection`
- `reasonCode`
- `humanMessage`
- `providersUsed`
- `weatherImpact`
- `zoneMatch`
- `auditId`

Estados operativos permitidos:

- `LOCAL_FREE`
- `AUTO_PRICED`
- `NEEDS_ADDRESS_CORRECTION`
- `PROVIDER_UNAVAILABLE`
- `OUT_OF_COVERAGE`
- `ERROR_RETRYABLE`

`MANUAL_QUOTE_REQUIRED` y `MANUAL_CONFIRMED` quedan solo como compatibilidad histórica/audit-only de tipos, no como salida operativa del engine.

## 5. Reglas de negocio implementadas

- Condados / Alborada exactos: `LOCAL_FREE`, `finalFee=0`, `canCheckout=true`.
- “cerca de alborada”, “por alborada”, “vía alborada”: `NEEDS_ADDRESS_CORRECTION`, `finalFee=null`, `canCheckout=false`.
- Dirección faltante: `NEEDS_ADDRESS_CORRECTION`.
- Proveedor/geocoding/routing no disponible: `PROVIDER_UNAVAILABLE`, sin fee inventado.
- Fuera de cobertura: `OUT_OF_COVERAGE`, sin checkout.
- Ruta confiable: `AUTO_PRICED`, tarifa calculada por backend.
- No se aplica mínimo, lluvia, hora pico ni beneficio de subtotal sobre `LOCAL_FREE`.
- Extra km solo después de `includedKm=1.5`.
- No se usa Haversine como tarifa final.
- No se reintrodujo default COP 5.000.

## 6. Providers/cache/usage/circuit breaker

El flujo `estimate` sigue resolviendo contexto por `DeliveryExternalDataService`, que mantiene:

- OpenRouteService geocoding/routing cuando está habilitado por env.
- Open-Meteo para clima.
- Nominatim/OSRM como fallback según configuración.
- ExternalApiCache persistente.
- DeliveryProviderUsage.
- Circuit breaker/cuotas según env.

No se activaron providers por código. No se imprimieron claves.

## 7. Manual legacy audit-only

Se preservan columnas y DTOs legacy:

- `deliveryFeeEdited`
- `deliveryFeeEditReason`
- `manualFee`
- `manualReason`
- `MANUAL_CONFIRMED`

Cambio aplicado:

- El controller no pasa `manualFee`, `manualReason` ni `forceManual` al servicio de estimación.
- El engine ignora `manualFee` como fuente de precio.
- OrdersService ya no pasa `dto.deliveryFee` al cálculo.
- `deliveryFeeEdited` y `deliveryFeeEditReason` quedan en `false/null` para cálculos nuevos.

## 8. Checkout backend validation

Archivo: `apps/api/src/modules/orders/orders.service.ts`.

Validación:

- `LOCAL_FREE`: permite checkout.
- `AUTO_PRICED`: permite checkout.
- `NEEDS_ADDRESS_CORRECTION`, `PROVIDER_UNAVAILABLE`, `OUT_OF_COVERAGE`, `ERROR_RETRYABLE`: bloquea checkout.
- Si frontend manda `deliveryFee` distinto/inventado, backend lo ignora para el snapshot nuevo.
- Sale/Caja siguen leyendo `deliveryFee` final calculado.

## 9. Anti-injection

Prueba agregada en `apps/api/src/tests/app.critical.spec.ts`:

- Envía `deliveryFee: 7000` en domicilio local gratis y backend guarda `deliveryFee=0`.
- Envía `deliveryFee: 7000` en domicilio sin estimación válida y checkout responde `400`.
- Confirma que `deliveryFeeEdited=false` y `deliveryFeeEditReason=null`.

## 10. Tests backend

Resultado:

- `pnpm --filter @inventory-fastfood/api typecheck`: PASS.
- `pnpm --filter @inventory-fastfood/api build`: PASS.
- `pnpm --filter @inventory-fastfood/api test`: PASS.

Suite API:

- 12 suites PASS.
- 200 tests PASS.
- `app.critical.spec.ts`: PASS.

Evidencia:

- `/tmp/phase-delivery-auto-1/api-typecheck.log`
- `/tmp/phase-delivery-auto-1/api-build.log`
- `/tmp/phase-delivery-auto-1/api-test.log`

## 11. Health

`curl -fsS http://localhost/api/health`: PASS.

Evidencia: `/tmp/phase-delivery-auto-1/health.log`.

## 12. Qué queda para PHASE-DELIVERY-AUTO-2

- Adaptar frontend POS para mostrar únicamente resultado automático.
- Eliminar UI operativa de tarifa manual.
- Reemplazar flujo visual manual-first por estados automáticos: `LOCAL_FREE`, `AUTO_PRICED`, `NEEDS_ADDRESS_CORRECTION`, `PROVIDER_UNAVAILABLE`, `OUT_OF_COVERAGE`, `ERROR_RETRYABLE`.
- Actualizar Playwright 8G.2 o crear reemplazo final para el flujo automático sin manual fee.

## 13. Riesgos residuales

- Mientras providers estén deshabilitados por `.env`, domicilios no locales quedan como `PROVIDER_UNAVAILABLE` y no pueden hacer checkout automático. Esto es correcto para evitar tarifas inventadas.
- Frontend aún puede mostrar controles legacy hasta PHASE-DELIVERY-AUTO-2, pero backend ya no los acepta como fuente de verdad.
- No hay metadata `.git` disponible en `/home/wundah/inventario`; `git status` no pudo usarse como evidencia.

## 14. Decisión final

**PHASE-DELIVERY-AUTO-1 BACKEND ENGINE: GO**

Motivo:

- Backend calcula o bloquea todo.
- Contrato automático listo.
- No acepta `deliveryFee` arbitrario.
- No depende de tarifa manual.
- Checkout bloquea sin estimación válida.
- Checkout permite `LOCAL_FREE` y `AUTO_PRICED`.
- Tests backend PASS.
- API build/typecheck PASS.
- Health PASS.
- No secretos impresos.
- `.env` no fue modificado ni commiteado.
