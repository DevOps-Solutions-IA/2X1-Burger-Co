# DELIVERY-WEATHER-RAIN-SURCHARGE-GOOGLE-0 Report

## 1. Resumen ejecutivo

Se validó que Google sigue como proveedor principal de ruta y Open-Meteo sigue alimentando el contexto climático del pricing backend. El engine aplica recargo por lluvia sólo en `AUTO_PRICED`, no lo aplica en `LOCAL_FREE`, conserva breakdown explícito y el POS muestra copy limpio sin códigos internos.

Decisión final: **GO**.

## 2. Estado recibido

- `DELIVERY-GOOGLE-MAPS-CORE-0`: GO.
- Google Maps Platform: provider principal para Places, resolve y routes.
- Open-Meteo: provider climático activo.
- Backend: fuente única de pricing.
- POS: display-only.

## 3. Google route + Open-Meteo weather

Evidencia runtime masked:

- `/tmp/delivery-weather-rain-surcharge-google-0/api-env-masked.log`

Resultado:

- `DELIVERY_PROVIDER_PRIMARY=google`
- `DELIVERY_ROUTING_PROVIDER=google`
- `DELIVERY_WEATHER_PROVIDER=openmeteo`
- `GOOGLE_MAPS_API_KEY=[SET]`
- `OPENROUTESERVICE_API_KEY=[SET]`

Smoke real:

- `/tmp/delivery-weather-rain-surcharge-google-0/google-weather-rain-surcharge-smoke.log`

Resultado:

- Google route: `AUTO_PRICED`.
- Distancia: `3.08 km`.
- ETA: `9 min`.
- Weather provider: `openmeteo`.
- Weather actual: `NONE`.
- Surcharge real actual: `0`.

## 4. Recargo lluvia aplicado

Test mock backend agregado en `apps/api/src/delivery/delivery-pricing/delivery-pricing.spec.ts`.

Caso lluvia moderada:

- Route provider: `google`.
- Weather provider: `openmeteo`.
- `rainIntensity=MODERATE`.
- `WEATHER_SURCHARGE=1500`.
- Final fee esperado: `9500`.
- `canCheckout=true`.

Resultado: PASS.

## 5. Caso sin lluvia

Test mock backend:

- Route provider: `google`.
- Weather provider: `openmeteo`.
- `rainIntensity=NONE`.
- `WEATHER_SURCHARGE=0`.
- Final fee esperado: `8000`.
- `canCheckout=true`.

Smoke real confirmó el mismo comportamiento para clima actual sin lluvia.

Resultado: PASS.

## 6. Caso con lluvia mock

La lluvia no se forzó en el smoke real. Se validó con mock backend determinístico:

- `isRaining=true`.
- `rainIntensity=MODERATE`.
- `precipitationMm=4.2`.
- Recargo: `1500`.
- Breakdown: `WEATHER_SURCHARGE`.

Resultado: PASS.

## 7. Caso local free con lluvia

Test backend y smoke real validaron:

- Dirección: `Condados de la Alborada`.
- `LOCAL_FREE`.
- `finalFee=0`.
- `weatherSurcharge=0`.
- `canCheckout=true`.
- `googleUsageDelta=0`.

Resultado: PASS.

## 8. Breakdown

El breakdown de `AUTO_PRICED` conserva:

- `BASE_FARE`.
- `DISTANCE_CHARGE`.
- `TIME_CHARGE`.
- `WEATHER_SURCHARGE`.
- `SCHEDULE_SURCHARGE`.
- `LOGISTICS_SURCHARGE`.
- `SUBTOTAL_BENEFIT`.

La ausencia de lluvia queda explícita con `WEATHER_SURCHARGE=0`. La lluvia moderada queda explícita con `WEATHER_SURCHARGE=1500`.

## 9. POS copy

Cambio aplicado:

- Si backend devuelve `weatherImpact.surcharge > 0`, POS muestra `Incluye recargo por lluvia`.
- Si no hay lluvia, no muestra ruido operativo.
- Si `LOCAL_FREE`, no muestra recargo lluvia.
- No se muestran códigos `GOOGLE_*`, `WEATHER_*`, `EXTERNAL_*` ni otros códigos internos.

Archivo:

- `apps/web/src/app/(app)/pos/page.tsx`

## 10. Secretos no impresos

Validación:

- `/tmp/delivery-weather-rain-surcharge-google-0/secret-grep-final.log`

Resultado:

- Sin claves hardcodeadas en `apps`, `infra`, `tests`, `scripts`, `prisma`.
- `.env` real fue excluido del grep para no imprimir secretos.
- No se imprimieron headers ni API keys.

## 11. Regresión

Validaciones ejecutadas:

- API typecheck: PASS.
- API build: PASS.
- API test: 204/204 PASS.
- Web typecheck: PASS.
- Web build: PASS.
- E2E POS display: PASS.
- E2E checkout/cash: PASS.
- E2E Google core: PASS.
- E2E weather screenshots: PASS.
- E2E SYS-1 auth refresh: PASS.
- Health: PASS.
- Bundle `localhost:4300`: 0 ocurrencias.
- Docker build `api web`: PASS.

## 12. Screenshots

| Screenshot | Existe | Tamaño | Qué demuestra |
|---|---:|---:|---|
| 01-google-route-weather-present.png | Sí | 133771 bytes | Google route + weather presente |
| 02-rain-surcharge-mock-breakdown.png | Sí | 130858 bytes | Recargo lluvia mock visible |
| 03-no-rain-no-surcharge.png | Sí | 134796 bytes | Sin lluvia no aplica recargo |
| 04-local-free-rain-no-surcharge.png | Sí | 132302 bytes | LOCAL_FREE domina y queda COP 0 |
| 05-pos-clean-weather-copy.png | Sí | 132517 bytes | Copy limpio de lluvia |
| 06-final-summary.png | Sí | 134497 bytes | Estado final visual |

## 13. Riesgos residuales

- P3: warnings frontend `no-explicit-any` preexistentes siguen visibles en build.
- P3: el smoke real depende del clima del momento; hoy Open-Meteo reportó `NONE`, por eso la lluvia real se complementó con mock backend determinístico.

No quedan P0/P1/P2 abiertos para esta fase.

## 14. Decisión final

**DELIVERY-WEATHER-RAIN-SURCHARGE-GOOGLE-0: GO**
