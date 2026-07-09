# PHASE-DELIVERY-AUTO-4 — Final Enterprise Hardening Report

Fecha: 2026-06-21
Workspace: /home/wundah/inventario

## 1. Resumen ejecutivo

Resultado final: NO-GO.
Production/V2 readiness: NOT READY.

El core de delivery automático se mantiene funcional en ejecución secuencial: POS display-only PASS, checkout/caja/auditoría PASS, anti-injection previamente cubierto por PHASE-3 PASS, SYS-1 single-flight refresh PASS, Caja/WhatsApp degradable PASS, API test suite PASS, web typecheck/build PASS y health PASS.

El gate enterprise final no puede declararse GO porque quedan P2 abiertos:

- Build reproducible Docker bloqueado por buildx local antiguo.
- Rutas secundarias y stress paralelo disparan Nginx local rate-limit zone auth y/o inestabilidad de harness bajo concurrencia.

Bajo las reglas hardline, no se bajó rate-limit, no se instaló buildx global, no se tocaron secretos, no se desplegó y no se modificó producción.

## 2. Build reproducible / buildx

Evidencia:

- docker buildx version: v0.11.2
- docker compose version: v2.40.3-desktop.1
- docker compose build web: FAIL
- docker compose build api: FAIL

Causa exacta:

```text
compose build requires buildx 0.17 or later
```

Logs:

- /tmp/phase-delivery-auto-4/docker-compose-build-web.log
- /tmp/phase-delivery-auto-4/docker-compose-build-api.log

Acción tomada: no se instaló buildx global sin autorización.

Plan concreto:

1. Actualizar Docker buildx local a >= 0.17 o usar un builder CI compatible.
2. Reejecutar `docker compose build web` y `docker compose build api`.
3. Solo declarar Production/V2 READY cuando ambos builds Docker sean reproducibles.

Estado: P2 abierto, bloquea production-ready.

## 3. Playwright harness

Cambios aplicados:

- `tests/e2e/auth.setup.ts`: login UI robustecido contra hidratación usando `load` + escritura secuencial, sin cambiar auth runtime.
- `tests/e2e/phase-delivery-auto-4-harness-stability.spec.ts`: creado/ajustado para validar storageState aislado en `/tmp/playwright-auth`, no `.auth-storage.json`, refresh cookie httpOnly/path y contextos explícitamente limpios.
- `tests/e2e/phase-delivery-auto-4-cash-whatsapp-degraded.spec.ts`: creado/ajustado y persistencia de storageState después de cada caso para evitar login storms.
- `tests/e2e/phase-delivery-auto-4-secondary-routes.spec.ts`: creado para rutas secundarias desktop/mobile.

Hallazgo:

El harness en comandos separados debe reutilizar `PLAYWRIGHT_AUTH_FILE` estable para evitar login storms. Con storageState persistido, Caja/WhatsApp degradable pasó. Sin embargo, el recorrido masivo de rutas secundarias y el stress paralelo aún disparan rate-limit local.

## 4. Auth SYS-1

Resultado: PASS.

Evidencia:

- /tmp/phase-delivery-auto-4/e2e-sys1-auth.log
- 4/4 tests PASS.
- 401 concurrentes deduplicados en una operación refresh.
- 429/503 no disparan logout automático.

## 5. Delivery automático

Resultado secuencial: PASS.

Evidencia:

- /tmp/phase-delivery-auto-4/e2e-delivery-pos.log
- 2/2 tests PASS.

Cambios mínimos aplicados en POS para estabilidad del gate:

- Se agregó `data-testid="pos-delivery-calculating"` al texto existente de estado de estimación.
- Se agregó `data-testid="pos-delivery-pricing-status"` sr-only con estado normalizado.
- Se agregó `data-testid="pos-delivery-can-checkout"` sr-only con `Habilitado` / `Checkout bloqueado`.
- Se ajustó copy de dirección ambigua a “Corrige la direccion con mas detalle.”
- Se normalizó sanitización de mensajes para typecheck seguro.

No se reintrodujo tarifa manual. No se tocó backend pricing.

## 6. Checkout / Caja / Auditoría

Resultado secuencial: PASS.

Evidencia:

- /tmp/phase-delivery-auto-4/e2e-delivery-checkout-cash.log
- 2/2 tests PASS.

Confirmado:

- LOCAL_FREE checkout/caja PASS.
- AUTO_PRICED checkout/caja PASS.
- NEEDS_ADDRESS_CORRECTION bloqueado.
- PROVIDER_UNAVAILABLE bloqueado.
- Anti-injection cubierto por PHASE-3 sigue en gate PASS secuencial.

## 7. Caja degradable

Resultado: PASS.

Evidencia:

- /tmp/phase-delivery-auto-4/e2e-cash-whatsapp-degraded.log
- 5/5 tests PASS.

Validado:

- dailySummary 503 no tumba Caja.
- operational-log 503 no tumba Caja.
- WhatsApp 503 no tumba Caja.
- currentCash 503 muestra error global claro.
- deliveryFee visible en Caja.

## 8. WhatsApp degradable

Resultado: PASS dentro del spec Caja/WhatsApp.

Evidencia:

- /tmp/phase-delivery-auto-4/e2e-cash-whatsapp-degraded.log

## 9. Rutas secundarias

Resultado: FAIL por rate-limit local.

Evidencia:

- /tmp/phase-delivery-auto-4/e2e-secondary-routes.log
- /tmp/phase-delivery-auto-4/nginx-after-secondary.log

Causa exacta desde Nginx:

```text
limiting requests, excess: 120.xxx by zone "auth"
```

Endpoints afectados durante navegación rápida:

- `/api/reports/*`
- `/api/users`
- `/api/roles`
- `/api/auth/refresh`
- `/api/cash-register/*`
- `/api/orders/*`
- `/api/realtime/operational`

Clasificación: P2 abierto. No se bajó rate-limit por regla hardline.

## 10. Sale delivery reporting decision

Decisión: no ejecutar migración en PHASE-4.

Campos separados faltantes en Sale:

- deliveryPricingStatus
- deliveryPricingConfidence
- providersUsed
- auditId

Alternativa actual válida para operación:

- `Sale.deliveryFee` conserva tarifa backend final.
- `Sale.deliveryPricingBreakdown` conserva metadata relevante.
- `Sale.deliveryCalculationVersion` conserva versión.
- `Sale.orderTicketId` permite join con `DeliveryPricingAudit.orderTicketId` / `saleId`.

Riesgo: no bloquea operación; queda como P3 de reporting/flattening si se requiere exportación directa sin join.

## 11. API/Web build/test

API:

- typecheck PASS: /tmp/phase-delivery-auto-4/api-typecheck.log
- build PASS: /tmp/phase-delivery-auto-4/api-build.log
- test PASS: /tmp/phase-delivery-auto-4/api-test.log

Web:

- typecheck PASS: /tmp/phase-delivery-auto-4/web-typecheck.log
- build PASS: /tmp/phase-delivery-auto-4/web-build.log

Web warnings:

- `@typescript-eslint/no-explicit-any` preexistentes en varios módulos. Clasificación P3.

## 12. E2E

PASS:

- PHASE-2 POS display: /tmp/phase-delivery-auto-4/e2e-delivery-pos.log
- PHASE-3 checkout/cash/audit: /tmp/phase-delivery-auto-4/e2e-delivery-checkout-cash.log
- SYS-1 auth refresh: /tmp/phase-delivery-auto-4/e2e-sys1-auth.log
- PHASE-4 harness stability: /tmp/phase-delivery-auto-4/e2e-harness-stability.log
- PHASE-4 cash/whatsapp degraded: /tmp/phase-delivery-auto-4/e2e-cash-whatsapp-degraded.log

FAIL:

- PHASE-4 secondary routes: /tmp/phase-delivery-auto-4/e2e-secondary-routes.log
- Parallel stress: /tmp/phase-delivery-auto-4/e2e-parallel-stress.log

## 13. Stress paralelo

Resultado: FAIL.

Evidencia:

- /tmp/phase-delivery-auto-4/e2e-parallel-stress.log

Síntomas:

- `net::ERR_CONNECTION_REFUSED` en POS display bajo concurrencia.
- `pos-page` no aparece en checkout/cash audit bajo workers=2.

Clasificación: P2 abierto de harness/infra local bajo concurrencia. No se debe declarar GO.

## 14. Health

Resultado: PASS.

Evidencia:

- /tmp/phase-delivery-auto-4/health.log
- API ok, database ok.

## 15. Bundle

Resultado: PASS.

Evidencia:

- /tmp/phase-delivery-auto-4/bundle-localhost4300.log vacío.

## 16. P0/P1/P2/P3

P0 abiertos: ninguno confirmado.

P1 abiertos: ninguno confirmado en ejecución secuencial crítica.

P2 abiertos:

- Build reproducible Docker bloqueado por buildx < 0.17.
- Rutas secundarias/stress paralelo fallan por rate-limit local `zone auth` y/o inestabilidad de harness bajo concurrencia.

P3 abiertos:

- Warnings `no-explicit-any` frontend.
- Tests legacy/no-gate con waits antiguos detectados en auditoría grep, fuera del gate principal.
- Sale reporting podría beneficiarse de columnas flatten nullable si se requiere BI/export sin join.

## 17. Production/V2 readiness

NOT READY.

Razones:

- Docker build reproducible no está resuelto.
- P2 abierto en rate-limit/harness bajo navegación masiva y stress paralelo.

## 18. Decisión final

PHASE-DELIVERY-AUTO-4 FINAL ENTERPRISE HARDENING: NO-GO

PRODUCTION/V2 READINESS: NOT READY
