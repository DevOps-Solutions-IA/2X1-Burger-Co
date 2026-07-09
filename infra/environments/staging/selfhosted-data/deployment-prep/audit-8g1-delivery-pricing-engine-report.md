# AUDIT-8G.1 — DELIVERY PRICING ENGINE 2X1 ENTERPRISE

Fecha: [PHONE_REDACTED]  
Sistema: inventario-fastfood-system / 2X1 Burger Co.  
Decisión final: **DELIVERY PRICING ENGINE 2X1 ENTERPRISE: NO-GO**

## 1. Resumen ejecutivo

Se implementó el motor real de cálculo de domicilios bajo el boundary `apps/api/src/delivery/`, con zona local gratis, contrato de cálculo versionado, endpoint de estimación, auditoría, metadata en `OrderTicket`/`Sale`, provider usage con cuota/circuit breaker, providers OpenRouteService preparados y POS mínimo para estimar/mostrar tarifa.

La validación técnica backend quedó en PASS:

- API typecheck: PASS.
- API build: PASS.
- Web typecheck: PASS.
- Web build: PASS.
- Suite API global: PASS, 12 suites / 199 tests.
- Motor/proveedores/cache: PASS, 6 suites / 62 tests.
- `app.critical.spec.ts`: PASS, 63/63.
- Bundle: 0 ocurrencias de `localhost:4300`.

La fase queda **NO-GO estricto** porque el Playwright end-to-end completo no logró PASS y solo se generaron 2 de 10 screenshots requeridos. El bloqueo observado no fue el motor backend, sino el entorno E2E local con nginx rate limiting y estado operacional POS/caja durante la prueba visual.

## 2. Estado recibido desde 8G.0 / 8G.0.1 / 8G.0.2

- Reset delivery 8G.0 preservado: no se reintrodujo default silencioso COP 5.000.
- Providers 8G.0.1 preservados: externos desacoplados y disabled por defecto.
- Infra 8G.0.2 preservada: `ExternalApiCache` persistente y `PrismaExternalCache` funcionando.
- `OrdersService` no contiene llamadas directas a APIs externas.
- POS mantiene fee manual.
- Checkout/caja siguen usando `deliveryFee` final.

## 3. Configuración del motor

Archivo principal: `apps/api/src/delivery/delivery-pricing/delivery-pricing.config.ts`

Configuración implementada:

- `calculationVersion`: `2x1-delivery-pricing-v1`
- Moneda: COP
- Redondeo: COP 500
- Base: COP 5.000
- Kilómetros incluidos: 1.5 km
- Extra por km: COP 1.000
- Min fare: COP 5.000
- Máximo automático: COP 15.000
- Máxima distancia automática: 8 km
- Máxima duración automática: 45 min
- Lluvia: LIGHT/MODERATE/HEAVY
- Horario: NORMAL/PEAK/NIGHT/WEEKEND_PEAK
- Beneficio subtotal: >=80.000 y >=120.000 sin bajar de mínimo.

## 4. Zona local gratis

Implementado en `delivery-pricing.engine.ts`.

PASS:

- `Condados`
- `Alborada`
- `Condados de la Alborada`
- `La Alborada`
- Variantes con mayúsculas, tildes y espacios.

Reglas implementadas:

- Match fuerte: `LOCAL_FREE`, finalFee 0.
- No aplica mínimo.
- No aplica lluvia.
- No aplica hora pico.
- No aplica distancia.
- Texto ambiguo como `cerca de alborada` o `por alborada`: `MANUAL_QUOTE_REQUIRED`, no gratis.

## 5. Open-Meteo

Open-Meteo se mantiene como provider preparado desde fases anteriores. El motor consume el contexto de `DeliveryExternalDataService`. Si clima no está disponible:

- `rainIntensity=UNKNOWN`
- surcharge 0
- no bloquea venta
- no inventa lluvia

## 6. OpenRouteService

Providers agregados:

- `apps/api/src/delivery/providers/openrouteservice-geocoding.provider.ts`
- `apps/api/src/delivery/providers/openrouteservice-routing.provider.ts`

Reglas:

- API key solo por env.
- No se imprime key.
- Si falta key, provider unavailable/fallback controlado.
- Tests con mocks.
- No llamadas reales en unit tests.

## 7. Nominatim fallback

Nominatim queda como fallback controlado desde `DeliveryExternalDataService` cuando el provider principal no está configurado y el fallback está habilitado por env.

## 8. Cache persistente

Se preserva `ExternalApiCache` y `PrismaExternalCache`.

PASS:

- cache hit evita provider.
- cache miss llama provider.
- expirado retorna null.
- upsert no duplica.
- fallos de cache no rompen POS.

## 9. Quota manager

Archivo: `apps/api/src/delivery/providers/delivery-provider-usage.service.ts`

Implementado:

- Conteo por provider/endpoint/día.
- Soft limit warning.
- Hard limit evita llamada.
- Registro success/error.
- Circuit breaker por errores consecutivos.

Modelo Prisma:

- `DeliveryProviderUsage`

## 10. Circuit breaker

Implementado dentro de `DeliveryProviderUsageService`.

Reglas:

- Abre circuito tras umbral configurable.
- Evita llamadas mientras `circuitOpenUntil` esté activo.
- Degrada a fallback/manual quote.
- No bloquea POS ni venta manual.

## 11. Cálculo por ruta

El motor solo autoprecifica si hay ruta confiable:

- `distanceKm`
- `durationMinutes`
- `confidence` no LOW
- origen configurado
- destino confiable

No usa Haversine para tarifa final enterprise.

## 12. Política de lluvia

Implementada:

- NONE: 0
- LIGHT: +1000
- MODERATE: +1500
- HEAVY: +2500
- UNKNOWN: 0

No aplica sobre `LOCAL_FREE`.

## 13. Política de horario

Implementado detector:

- NORMAL
- PEAK
- NIGHT
- WEEKEND_PEAK

No aplica sobre `LOCAL_FREE`.

## 14. Política de subtotal

Implementado:

- >= COP 80.000: -1000
- >= COP 120.000: -2000
- nunca baja de `minFare`
- no aplica sobre `LOCAL_FREE`

## 15. Manual quote

Implementado:

- dirección ambigua => manual quote
- sin origen => manual quote
- sin destino => manual quote
- ruta no disponible => manual quote
- distancia/duración fuera de cobertura => manual quote

## 16. Manual override y motivo

Endurecido durante esta fase:

- POS exige motivo si `requiresManualQuote=true` y se ingresa fee manual > 0.
- POS exige motivo si fee manual difiere de sugerida.
- Backend rechaza manual fee sin motivo real cuando requiere cotización.
- Se eliminó el default silencioso `"Tarifa confirmada manualmente en POS."` como motivo inventado para casos nuevos.

## 17. Auditoría

Modelo creado:

- `DeliveryPricingAudit`

Guarda:

- request sanitizado
- resultado
- suggestedFee/finalFee
- manualEdited/manualEditReason
- calculationVersion
- provider summary
- warnings/confidence

No guarda API keys.

## 18. Migraciones no destructivas

Migración:

- `prisma/migrations/20260620070000_delivery_pricing_engine/migration.sql`

Cambios:

- agrega metadata delivery a `order_tickets`
- agrega metadata delivery a `sales`
- crea `delivery_provider_usage`
- crea `delivery_pricing_audits`

No renombra ni elimina campos existentes.

## 19. Persistencia OrderTicket/Sale

Implementado:

- `deliveryFee` se mantiene como valor final para caja.
- `deliveryFeeSuggested`
- `deliveryFeeEdited`
- `deliveryFeeEditReason`
- `deliveryPricingStatus`
- `deliveryPricingConfidence`
- `deliveryPricingBreakdown`
- `deliveryCalculationVersion`
- providers usados
- estimated minutes

Checkout transfiere metadata relevante a `Sale`.

## 20. Endpoint estimate

Endpoint:

- `POST /delivery-pricing/estimate`

Estado:

- Protegido por JWT + roles.
- Devuelve HTTP 200.
- No guarda pedido.
- No falla 500 por providers externos disabled.
- Si no puede calcular, devuelve manual quote.

Validación directa:

- `Condados de la Alborada` => 200, `LOCAL_FREE`, finalFee 0.
- `cerca de alborada` => manual quote.

## 21. Integración POS mínima

Implementado:

- Botón `Estimar domicilio`.
- Muestra tarifa sugerida/final.
- Muestra warnings.
- Muestra estado local free/manual quote.
- Campo fee manual.
- Campo motivo manual.
- No consulta mientras se escribe.

Limitación:

- UI premium completa queda para 8G.2.
- Playwright full flow no quedó en PASS por entorno E2E local.

## 22. Tests unitarios

PASS:

- `delivery-pricing.spec.ts`
- Local free exacto.
- Ambigüedad local.
- Distancia extra después de 1.5 km.
- Tiempo por bloques.
- Lluvia.
- Horario.
- Subtotal benefit.
- Max distance/duration.
- Low confidence.
- Routing unavailable.
- Manual fee con/sin motivo.
- No default COP 5.000.
- Haversine no calcula tarifa final.

## 23. Tests providers/quota/cache

PASS:

- `delivery-provider-usage.spec.ts`
- `openrouteservice-routing.provider.spec.ts`
- `openrouteservice-geocoding.provider.spec.ts`
- `delivery-external-data.service.spec.ts`
- `prisma-external-cache.spec.ts`

Total focal delivery/providers/cache:

- 6 suites PASS
- 62 tests PASS

## 24. Tests integración order/sale/caja

PASS en `app.critical.spec.ts`:

- manual delivery pricing se conserva.
- shared live location no recalcula fee manual.
- delivery pricing endpoint local free / ambiguous.
- checkout/cash flows existentes siguen pasando.

`app.critical.spec.ts`:

- 63/63 PASS.

## 25. Playwright

Archivo creado:

- `tests/e2e/audit8g1-delivery-pricing-engine.spec.ts`

Resultado:

- FAIL.

Evidencia:

- El endpoint funciona directo.
- El flujo visual generó screenshots 01 y 02.
- El flujo completo no llegó a PASS por combinación de:
  - nginx local rate limiting en ráfagas del POS,
  - estado operacional persistente de caja/comandas en el stack local,
  - esperas inestables al guardar pedido desde UI.

No se declara GO porque Playwright y screenshots completos eran criterios hardline.

## 26. Screenshots

Generados:

- `01-pos-delivery-local-free-condados.png`
- `02-pos-delivery-local-free-alborada.png`

Faltantes:

- `03-pos-delivery-ambiguous-needs-manual.png`
- `04-pos-delivery-manual-fee-reason-required.png`
- `05-pos-delivery-manual-fee-saved.png`
- `06-pos-delivery-reopened-with-pricing-metadata.png`
- `07-pos-checkout-with-delivery-fee.png`
- `08-cash-delivery-fee-included.png`
- `09-settings-origin-pending-or-configured.png`
- `10-mobile-390x844.png`

## 27. External smoke

Skipped.

Razón:

- No hay `OPENROUTESERVICE_API_KEY` segura configurada.
- No hay coordenadas reales del local autorizadas.
- Providers externos siguen disabled por defecto.

Esto no bloquea unit/integration porque los providers tienen mocks.

## 28. Resultado typecheck/build

PASS:

- `pnpm --filter @inventory-fastfood/api typecheck`
- `pnpm --filter @inventory-fastfood/api build`
- `pnpm --filter @inventory-fastfood/web typecheck`
- `pnpm --filter @inventory-fastfood/web build`

Warnings:

- Warnings existentes de `@typescript-eslint/no-explicit-any` en varias pantallas.
- No bloquean build.

## 29. Suite API global

PASS:

- 12 suites.
- 199 tests.
- 0 failed.

## 30. Health local

PASS:

- `http://localhost/api/health` respondió `status=ok`.
- Docker local reconstruido parcialmente para validar endpoint nuevo.

## 31. Bundle localhost

PASS:

- `rg "localhost:4300" apps/web/.next` => 0 ocurrencias.

## 32. Riesgos residuales

P1:

- Playwright full flow de 8G.1 no pasa todavía.
- Screenshots obligatorios incompletos.
- El entorno local por nginx rate limiting no es estable para este E2E de POS.

P2:

- Coordenadas reales del local siguen pendientes.
- External smoke con OpenRouteService pendiente por API key y origen real.
- UI premium de domicilios pendiente para 8G.2.
- Warnings `no-explicit-any` siguen en frontend.

## 33. Qué queda para AUDIT-8G.2

- Rediseñar UI premium de domicilios.
- Separar test harness E2E POS del nginx rate-limited o crear perfil test sin rate-limit.
- Configurar origen real del local.
- Ejecutar smoke externo con OpenRouteService/Open-Meteo si hay env seguro.
- Completar screenshots 03-10.

## 34. Decisión final

**DELIVERY PRICING ENGINE 2X1 ENTERPRISE: NO-GO**

Motivo:

- Motor/backend: PASS.
- Persistencia/auditoría/endpoint/cache/quota/circuit breaker: PASS.
- POS mínimo implementado: PASS técnico.
- Playwright full flow: FAIL.
- Screenshots completos: FAIL.

No se autoriza GO mientras el E2E visual funcional y las capturas obligatorias no cierren.
