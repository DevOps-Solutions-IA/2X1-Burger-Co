# SYS-2 — Global Stability Remediation Complete

Fecha: 2026-06-20

## 1. Resumen ejecutivo

SYS-2 cerró remediaciones importantes de estabilidad global, pero no puede declararse GO completo porque el stress paralelo obligatorio con 2 workers sigue fallando.

Resultado final:

**SYS-2 GLOBAL STABILITY REMEDIATION COMPLETE: NO-GO**

Motivo NO-GO:

- El stress paralelo exigido por SYS-2 no pasa de forma estable.
- Resultado último stress: 7/10 PASS, 3/10 FAIL.
- Fallos restantes concentrados en harness/auth bajo paralelismo y estado degradado de WhatsApp.

## 2. Estado recibido

- AUDIT-8G.2: GO.
- AUDIT-SYS-0: NEEDS REMEDIATION.
- SYS-1: GO.

## 3. Bugs SYS-0 abordados

| ID | Estado |
|---|---|
| SYS0-P1-002 Playwright harness comparte storageState/origins | Parcialmente cerrado; queda falla bajo stress paralelo 2 workers |
| SYS0-P2-001 Caja error global por dailySummary | Cerrado |
| SYS0-P2-002 waits frágiles/networkidle | Reducido en specs críticos tocados |
| SYS0-P2-003 API lenta/sensible a locks | Auditado; suite PASS pero lenta |
| SYS0-P2-004 waiters/drivers/WhatsApp coverage | Cobertura mínima agregada |

## 4. SYS-1 intacto

Validación:

- `tests/e2e/sys1-auth-refresh-concurrency.spec.ts`: PASS 4/4.
- `tests/e2e/sys1-session-navigation-regression.spec.ts`: PASS.
- `tests/e2e/sys1-cash-stability-regression.spec.ts`: PASS.

Evidencia:

- `/tmp/sys2/e2e-sys1-concurrency-fixed3.log`
- `/tmp/sys2/e2e-session-navigation.log`
- `/tmp/sys2/e2e-cash-stability.log`

## 5. Playwright harness antes

Problemas encontrados:

- `tests/e2e/playwright.noserver.config.ts` usaba `tests/e2e/.auth-storage.json` compartido.
- `tests/e2e/auth.setup.ts` usaba `networkidle`.
- Specs críticos dependían de auth state stale con refresh token rotado.
- Specs paralelos con fallback login podían golpear rate-limit.

## 6. Playwright harness después

Cambios:

- `playwright.noserver.config.ts` mueve auth state a `/tmp/playwright-auth/local-noserver/worker-0.json`.
- `auth.setup.ts` reutiliza auth state temporal válido y solo hace login si hace falta.
- `auth.setup.ts` reemplaza `networkidle` por espera determinística.
- Specs críticos agregan recuperación controlada si una ruta protegida aterriza en `/login`.
- `sys2-auth-harness-isolation.spec.ts` valida que no se usa `.auth-storage.json`.

Estado:

- Aislamiento focal PASS.
- Stress paralelo sigue FAIL por auth/rate-limit en fallback concurrente.

## 7. Caja degradable

Cambio principal:

- `apps/web/src/app/(app)/cash/page.tsx` cambió error global de:
  - `currentCash.error ?? dailySummary.error`
- A:
  - `currentCash.error`

Resultado:

- `dailySummary` degrada en `cash-daily-summary-error`.
- `operationalLog` degrada en `cash-operational-log-error`.
- WhatsApp degrada en `cash-whatsapp-warning` cuando aplica.
- `currentCash` sigue siendo error global real.

Validación:

- `tests/e2e/sys2-cash-degraded-errors.spec.ts`: PASS 5/5 en ejecución focal.
- Evidencia: `/tmp/sys2/e2e-cash-degraded-fixed.log`

## 8. Waiters / drivers / WhatsApp

Cobertura agregada:

- `tests/e2e/sys2-secondary-modules-coverage.spec.ts`

Valida:

- `/deliveries`, `/settings`, `/tables` cargan y recargan sin logout.
- `/waiter/login` y `/delivery/login` son alcanzables.
- WhatsApp 409/503 no se trata como logout.

Ejecución focal:

- PASS 4/4.
- Evidencia: `/tmp/sys2/e2e-secondary-modules-sixth.log`

## 9. Delivery regression

Validación:

- `tests/e2e/audit8g2-delivery-final.spec.ts`: PASS.
- Se ajustó el test para validar códigos técnicos desde response y etiquetas UI reales:
  - `LOCAL_FREE` en API.
  - `GRATIS` en UI.
  - `REVISAR` para ambiguo.
  - `SIN PROVEEDOR` para provider disabled.

Evidencia:

- `/tmp/sys2/e2e-delivery-final.log`

## 10. API test suite lock/speed audit

Resultado:

- API typecheck PASS.
- API build PASS.
- API global tests PASS.
- 12 suites PASS.
- 199 tests PASS.

Observación:

- La suite sigue lenta: `app.critical.spec.ts` tomó ~207s y total ~398s.
- No se aplicó refactor destructivo del harness API en SYS-2.

Evidencia:

- `/tmp/sys2/api-typecheck.log`
- `/tmp/sys2/api-build.log`
- `/tmp/sys2/api-test.log`

## 11. Web build/typecheck

Resultado:

- Web typecheck PASS.
- Web build PASS.

Warnings:

- Persisten warnings P3 `@typescript-eslint/no-explicit-any` en múltiples pantallas.
- No bloquean build.

Evidencia:

- `/tmp/sys2/web-typecheck.log`
- `/tmp/sys2/web-build.log`

## 12. Screenshots

Directorio:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/sys2-global-stability-remediation/`

Capturas generadas:

| Screenshot | Tamaño | Demuestra |
|---|---:|---|
| 01-dashboard-stable.png | 104618 | Dashboard estable |
| 02-pos-stable.png | 115542 | POS estable |
| 03-cash-stable-no-banner.png | 100431 | Caja sin banner global |
| 04-cash-daily-summary-degraded-local-error.png | 117389 | dailySummary degradado localmente |
| 05-cash-whatsapp-degraded-local-warning.png | 120437 | WhatsApp degradado localmente |
| 06-delivery-regression-pass.png | 116325 | POS delivery estable |
| 07-settings-stable.png | 115539 | Settings estable |
| 08-tables-stable.png | 99379 | Tables estable |
| 09-deliveries-stable.png | 112699 | Deliveries estable |
| 10-final-regression-summary.png | 103488 | Resumen final visual |

## 13. Regression gate

PASS:

- API typecheck/build/test.
- Web typecheck/build.
- SYS-1 concurrency.
- SYS-1 navigation.
- SYS-1 cash stability.
- Delivery 8G.2.
- Cash degraded focal.
- Secondary modules focal.
- Auth harness isolation focal.
- Screenshots.
- Health.
- Rutas HTTP.
- Bundle sin `localhost:4300`.

FAIL:

- Stress paralelo obligatorio:
  - `tests/e2e/sys1-session-navigation-regression.spec.ts`
  - `tests/e2e/audit8g2-delivery-final.spec.ts`
  - `tests/e2e/sys2-cash-degraded-errors.spec.ts`
  - `tests/e2e/sys2-secondary-modules-coverage.spec.ts`
  - `--workers=2`

Último resultado:

- 7 passed.
- 3 failed.

Fallos:

- `sys2-cash-degraded-errors`: WhatsApp warning no siempre aparece en paralelo.
- `sys2-secondary-modules-coverage`: fallback login concurrente sigue fallando por espera de dashboard/rate-limit/auth state.

Evidencia:

- `/tmp/sys2/e2e-parallel-isolation-stress-final-retry.log`

## 14. Health / rutas / bundle

Health:

- `curl -fsS http://localhost/api/health`: OK.

Rutas HTTP:

- `/dashboard`: 200.
- `/pos`: 200.
- `/cash`: 200.
- `/tables`: 200.
- `/settings`: 200.
- `/inventory`: 200.
- `/products`: 200.
- `/purchases`: 200.
- `/expenses`: 200.
- `/reports`: 200.
- `/users`: 200.
- `/deliveries`: 200.

Bundle:

- `grep -R "localhost:4300" apps/web/.next`: 0 ocurrencias.

## 15. Archivos modificados

- `apps/web/src/app/(app)/cash/page.tsx`
- `apps/web/src/components/ui/card.tsx`
- `tests/e2e/playwright.noserver.config.ts`
- `tests/e2e/auth.setup.ts`
- `tests/e2e/sys1-auth-refresh-concurrency.spec.ts`
- `tests/e2e/sys1-cash-stability-regression.spec.ts`
- `tests/e2e/audit8g2-delivery-final.spec.ts`
- `tests/e2e/audit-sys0-cookie-fetch-proof.spec.ts`
- `tests/e2e/audit-sys0-session-navigation.spec.ts`
- `tests/e2e/sys2-cash-degraded-errors.spec.ts`
- `tests/e2e/sys2-secondary-modules-coverage.spec.ts`
- `tests/e2e/sys2-auth-harness-isolation.spec.ts`
- `tests/e2e/sys2-screenshots.spec.ts`

## 16. Bugs cerrados

- Caja no muestra error global por fallo secundario de `dailySummary`.
- Caja degrada bitácora localmente.
- WhatsApp degradado no tumba Caja.
- Specs focales usan auth recovery controlado.
- StorageState ya no usa `.auth-storage.json` compartido del repo.
- Specs críticos usan `http://localhost` como origen Docker/Nginx.
- Delivery final sigue PASS.

## 17. Bugs residuales

| ID | Severidad | Módulo | Descripción | Estado |
|---|---|---|---|---|
| SYS2-P1-001 | P1 | Playwright harness | Stress paralelo 2 workers falla por auth/rate-limit/fallback login | Abierto |
| SYS2-P2-001 | P2 | Playwright/Cash | WhatsApp warning no es determinístico bajo stress paralelo mixto | Abierto |
| SYS2-P3-001 | P3 | Frontend | Warnings `no-explicit-any` existentes | Abierto |
| SYS2-P3-002 | P3 | API tests | Suite API PASS pero lenta | Abierto |

## 18. Qué queda para Codex

SYS-3 recomendado:

- Implementar auth fixture real por worker, no solo storageState único.
- Crear `/tmp/playwright-auth/<run-id>/worker-<workerIndex>.json`.
- Evitar fallback UI login dentro de specs paralelos.
- Separar tests mutadores/degradados de stress paralelo o aislarlos por worker/context/data.
- Hacer que WhatsApp degraded assertion sea determinística en paralelo.

## 19. Qué puede hacer DeepSeek

- Reducir warnings P3 `no-explicit-any` en pantallas no críticas.
- Documentar matriz de specs críticos/obsoletos.
- Agregar data-testid secundarios.
- Mejorar textos visuales no críticos.

## 20. Riesgos antes de producción

- No se debe pasar a producción/V2 final mientras el stress paralelo exigido siga fallando.
- Los flujos operativos pasan de forma focal/secuencial, pero el harness paralelo todavía no prueba aislamiento real por worker.
- El rate-limit local puede seguir afectando specs que intentan re-login concurrente.

## 21. Decisión final

**SYS-2 GLOBAL STABILITY REMEDIATION COMPLETE: NO-GO**

Criterio que impide GO:

- Stress paralelo obligatorio no pasa.
- El requisito del usuario indica NO-GO si aparece redirect falso a login, falla stress paralelo por auth, o sigue storage/auth contaminado bajo pruebas críticas.
