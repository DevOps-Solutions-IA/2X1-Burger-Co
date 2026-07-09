# AUDIT-8G.0.2 — Delivery Providers Infra Closure

Fecha: [PHONE_REDACTED]  
Sistema: inventario-fastfood-system / 2X1 Burger Co  
Decisión: DELIVERY PROVIDERS INFRA CLOSURE: GO

## 1. Resumen ejecutivo

Se cerraron los bloqueadores P1 de AUDIT-8G.0.1:

- Cache externo persistente implementado con Prisma.
- Tabla `external_api_cache` agregada mediante migración no destructiva.
- `DeliveryExternalDataService` integrado con cache persistente cuando `DELIVERY_CACHE_ENABLED=true`.
- `InMemoryExternalCache` queda limitado a tests/dev/fallback explícito.
- Harness global de tests API estabilizado con `pg_advisory_xact_lock` durante reset de DB.
- `app.critical.spec.ts` pasó completo.
- Suite API global pasó completa.
- Proveedores externos siguen apagados por defecto.
- No se reintrodujo tarifa automática, default COP 5.000 ni fórmula baseRate/km/bandas.

Esta fase no implementa motor final de precios y no activa proveedores externos en producción.

## 2. Estado inicial desde 8G.0.1

Estado recibido:

- Arquitectura de providers creada.
- Tests delivery con mocks: PASS.
- Reset delivery: PASS.
- API build/typecheck: PASS.
- Web build/typecheck: PASS.
- Bundle sin `localhost:4300`.
- Bloqueadores: cache in-memory, suite API global con deadlock/timeout, origen sin coordenadas reales.

## 3. Cache persistente implementado

Modelo nuevo:

- `ExternalApiCache`

Archivo:

- `prisma/schema.prisma`

Tabla:

- `external_api_cache`

Campos:

- `id`
- `provider`
- `cache_type`
- `cache_key`
- `request_hash`
- `response_json`
- `status`
- `expires_at`
- `created_at`
- `updated_at`

Índices:

- unique `provider + cache_type + cache_key`
- `expires_at`
- `provider`
- `cache_type`
- `status`

## 4. Migración no destructiva

Migración:

- `prisma/migrations/20260620062000_external_api_cache/migration.sql`

Tipo:

- Solo `CREATE TABLE`
- Solo índices nuevos
- No modifica tablas existentes
- No elimina columnas
- No toca `OrderTicket`, `Sale`, `Customer`, `Product`

Estado local:

- `pnpm exec prisma migrate deploy --schema prisma/schema.prisma`: PASS
- `pnpm exec prisma migrate status --schema prisma/schema.prisma`: schema up to date

## 5. PrismaExternalCache

Archivo:

- `apps/api/src/delivery/providers/prisma-external-cache.ts`

Implementa:

- `ExternalCache.get(entry)`
- `ExternalCache.set(entry, value, ttlSeconds)`
- `ExternalCache.delete(entry)`

Comportamiento:

- `get` usa unique key `provider/cacheType/cacheKey`.
- Cache vencido retorna `null`.
- Cache vencido marca registro como `STALE`.
- `set` usa `upsert`, evita duplicados.
- `responseJson` conserva payload mínimo útil.
- `status` se escribe como `SUCCESS`.
- `requestHash` se genera con SHA-256 de la llave compuesta.

## 6. Interfaz ExternalCache

Archivo:

- `apps/api/src/delivery/providers/external-cache.interface.ts`

Se cambió de string plano a llave compuesta:

- `provider`
- `cacheType`
- `cacheKey`
- `requestHash?`

Motivo:

- Evita prefijos frágiles.
- Cumple unicidad real.
- Permite auditoría por proveedor y tipo.

## 7. Integración con DeliveryExternalDataService

Archivo:

- `apps/api/src/delivery/providers/delivery-external-data.service.ts`

Cambios:

- Usa `PrismaExternalCache` vía DI si `DELIVERY_CACHE_ENABLED !== false`.
- Mantiene `InMemoryExternalCache` para tests y fallback sin Prisma inyectado.
- Weather consulta cache antes de provider.
- Geocoding consulta cache antes de provider.
- Routing consulta cache antes de provider.
- Coordenadas se redondean para route/weather cache.
- Si cache falla, agrega `CACHE_UNAVAILABLE` y continúa.
- No cachea errores como éxito.
- No calcula tarifa final.

TTL:

- Weather: 15 minutos.
- Geocode: 90 días.
- Route: 14 días.

## 8. Estado InMemoryExternalCache

Archivo:

- `apps/api/src/delivery/providers/in-memory-external-cache.ts`

Estado:

- Sigue disponible para unit tests/dev/fallback.
- Adaptado a llave compuesta.
- No es la implementación principal cuando Prisma cache está inyectado.

## 9. Corrección deadlock test harness

Archivo:

- `apps/api/src/tests/helpers/test-data.ts`

Causa raíz:

- Reset compartido de DB de tests usando `TRUNCATE ... RESTART IDENTITY CASCADE` podía competir con conexiones/suites que aún cerraban operaciones, generando deadlock PostgreSQL y timeout de `beforeEach`.

Corrección:

- Se agregó `pg_advisory_xact_lock([PHONE_REDACTED])` dentro de la transacción de reset.
- El TRUNCATE queda serializado por DB.
- Se agregaron `maxWait` y `timeout` de 60 segundos al reset.
- Se agregó `external_api_cache` al listado de tablas de reset.

No se hizo:

- No se saltaron tests.
- No se marcó ningún test como skip.
- No se eliminó `app.critical.spec.ts`.
- No se maquilló el timeout.

## 10. Resultado app.critical.spec.ts

Comando:

- `source infra/scripts/load-env.sh && bash infra/scripts/prepare-test-db.sh && pnpm --dir apps/api exec jest src/tests/app.critical.spec.ts --runInBand --forceExit --detectOpenHandles --testTimeout=30000`

Resultado:

- PASS
- 62 tests PASS
- 1 suite PASS
- Tiempo: 202.907 s

## 11. Resultado suite API global

Comando:

- `pnpm --filter @inventory-fastfood/api test`

Resultado:

- PASS
- 9 suites PASS
- 170 tests PASS
- 0 fail
- Tiempo: 386.418 s

## 12. Tests cache persistente

Archivo:

- `apps/api/src/delivery/providers/prisma-external-cache.spec.ts`

Resultado:

- PASS
- 9 tests PASS

Casos cubiertos:

- set + get antes de expiración.
- get expirado retorna null.
- expirado marca `STALE`.
- upsert por unique key.
- delete exacto.
- `responseJson` conservado.
- falla de cache no rompe consumidor.
- TTL weather 15 min.
- TTL geocode 90 días.
- TTL route 14 días.

## 13. Regresión delivery reset

Archivos:

- `apps/api/src/delivery/providers/delivery-external-data.service.spec.ts`
- `apps/api/src/delivery/delivery-pricing/delivery-pricing.spec.ts`

Resultado focal:

- PASS
- 25 tests PASS

Confirmado:

- Dirección desconocida no genera COP 5.000 automático.
- baseRate/costPerKm no determinan `finalFee`.
- `delivery-zones` legacy no se importa para pricing final.
- Condados/Alborada no aplica tarifa automática.
- Haversine solo es referencia, no pricing.
- Fee manual sigue siendo el camino seguro.

## 14. Estado origen del local

Variables:

- `DELIVERY_ORIGIN_LAT=`
- `DELIVERY_ORIGIN_LNG=`
- `DELIVERY_ORIGIN_LABEL=2X1 Burger Co`
- `DELIVERY_ORIGIN_ADDRESS=`

Estado:

- Pendiente de coordenadas reales.
- No se inventaron coordenadas.
- Si faltan lat/lng, `DeliveryExternalDataService` retorna `ORIGIN_COORDINATES_MISSING` y `requiresManualQuote=true`.

Settings:

- `/settings` responde 200.
- Muestra bloque “Ubicación base de domicilios”.
- Mantiene estado pendiente si no hay coordenadas.

Riesgo residual:

- P2: para 8G.1 con ruta real se deben configurar coordenadas reales del local.

## 15. Proveedores externos

Estado:

- `DELIVERY_EXTERNAL_PROVIDERS_ENABLED=false` por defecto en `.env.example`.
- `apps/api/src/config/env.ts` mantiene default `false`.
- No se activaron providers en producción.
- Tests unitarios no dependen de internet.

## 16. Validación técnica

API:

- `pnpm --filter @inventory-fastfood/api typecheck`: PASS
- `pnpm --filter @inventory-fastfood/api build`: PASS
- `pnpm --filter @inventory-fastfood/api test`: PASS

Web:

- `pnpm --filter @inventory-fastfood/web typecheck`: PASS
- `pnpm --filter @inventory-fastfood/web build`: PASS

Nota:

- Web build mantiene warnings preexistentes de `@typescript-eslint/no-explicit-any`; no bloquean build.

## 17. Health local

Comando:

- `curl http://localhost/api/health`

Resultado:

- `status=ok`
- `api=ok`
- `database=ok`

## 18. Rutas frontend críticas

Validación HTTP local:

- `/pos`: 200
- `/settings`: 200
- `/cash`: 200

## 19. Bundle localhost

Comando:

- `rg "localhost:4300" apps/web/.next`

Resultado:

- 0 ocurrencias.

## 20. Riesgos residuales

P2:

- Coordenadas reales del local pendientes.

P2:

- Providers siguen deshabilitados hasta smoke controlado de 8G.1/8G.1.x.

P3:

- Warnings preexistentes de `any` en frontend.

## 21. Qué queda pendiente para 8G.1

- Motor final de precios.
- Política de tarifa por ruta real.
- Política de lluvia.
- Política de zona local gratis.
- Validación de coordenadas reales del local.
- Smoke controlado con providers externos habilitados en entorno seguro.
- Reglas para cache STALE si se decide permitir lectura degradada.

## 22. Decisión final

DELIVERY PROVIDERS INFRA CLOSURE: GO

Razón:

- Cache persistente existe y está probado.
- Suite API global pasa completa.
- `app.critical.spec.ts` pasa completo.
- Delivery reset no regresó.
- Build/typecheck pasan.
- Bundle limpio.
- POS, Settings y Cash responden.
- Providers externos siguen apagados por defecto.
- No hay pricing automático ni COP 5.000 silencioso.
