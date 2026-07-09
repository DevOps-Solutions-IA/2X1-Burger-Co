# SYS-1 — Auth Session Single-Flight Refresh

Fecha: 2026-06-20  
Sistema: inventario-fastfood-system / 2X1 Burger Co  
Decisión: GO

## 1. Resumen ejecutivo

SYS0-P1-001 queda corregido. El frontend ahora usa refresh single-flight: múltiples respuestas 401 concurrentes comparten una sola operación `/auth/refresh`, las requests rezagadas reutilizan el refresh exitoso reciente, y los fallos transitorios 429/5xx no se convierten en logout automático.

No se cambió backend, cookies, refresh rotation, storage strategy ni lógica delivery.

## 2. Estado recibido desde SYS-0

| Hallazgo | Estado recibido | Acción SYS-1 |
|---|---|---|
| Refresh concurrente sin dedupe | P1 abierto | Corregido |
| Backend rota refresh token | Correcto, pero exigía frontend single-flight | Preservado |
| Cierre intermitente al navegar | Riesgo por 401 paralelos | Mitigado |
| 429/503 podían degradar visualmente | No logout directo, pero refresh fallaba agresivo | Refresh transitorio ya no borra sesión |

## 3. Causa raíz SYS0-P1-001

Antes, `apiFetch`, `apiFetchBlob` y realtime llamaban `tryRefreshToken()` de forma independiente. Si varias queries protegidas recibían 401 al mismo tiempo, cada una podía disparar `/auth/refresh`. Como el backend revoca el refresh token anterior en cada rotación, las llamadas simultáneas podían invalidarse entre sí y provocar logout falso.

## 4. Código anterior

| Área | Comportamiento anterior | Riesgo |
|---|---|---|
| `apiFetch` | 401 -> `tryRefreshToken()` directo -> retry recursivo | Múltiples refresh simultáneos |
| `apiFetchBlob` | Misma lógica duplicada | Mismo riesgo |
| `tryRefreshToken` | Cualquier `!response.ok` o network error limpiaba token y podía emitir session expired | 503/429 podían degradar como sesión vencida |
| Realtime | 401 -> refresh directo | Otro punto de carrera |

## 5. Código corregido

Archivo principal:

- `apps/web/src/lib/api.ts`

Cambios:

- `refreshInFlight: Promise<RefreshSessionResult> | null`.
- `refreshSessionSingleFlight()` comparte la misma promesa activa.
- `executeRefreshSession()` distingue `unauthorized` vs `transient`.
- `notifySessionExpiredOnce()` evita eventos duplicados.
- `lastSuccessfulRefreshAt` + ventana de 1500 ms evita segundo refresh para 401 rezagados de la misma ola.
- `apiFetch` y `apiFetchBlob` reintentan una sola vez con `hasRetriedAfterRefresh`.
- El segundo 401 después del retry expira sesión de forma controlada.
- 429/500/502/503 de refresh no borran sesión ni emiten logout.

## 6. Single-flight refresh

| Caso | Resultado |
|---|---|
| No hay refresh activo | Inicia una llamada `/auth/refresh` |
| Ya hay refresh activo | Reutiliza la misma promesa |
| Refresh OK | Actualiza access token en memoria |
| 401/403 en refresh | Expira sesión una sola vez |
| 429/5xx/network en refresh | Retorna fallo transitorio sin logout automático |
| 401 rezagado justo después del refresh | Reintenta con token nuevo sin abrir otro refresh |

## 7. Manejo 401

| Situación | Comportamiento |
|---|---|
| Request protegida recibe 401 | Ejecuta `handleUnauthorizedResponse()` |
| Refresh OK | Reintenta request una sola vez |
| Retry vuelve 401 | Limpia access token y emite session-expired una sola vez |
| Refresh inválido 401/403 | Limpia sesión y emite session-expired una sola vez |
| Refresh transitorio 503/0 | Lanza error manejable sin logout |

## 8. Manejo 429/503

| Código | Resultado |
|---|---|
| 429 en request normal | No llama refresh, no logout |
| 503 en refresh | No logout automático |
| 500/502/503 en request normal | Error de API normal, no session-expired |

## 9. Session-expired

`auth:session-expired` ahora se emite de forma idempotente para expiración normal. Esto evita múltiples toasts y múltiples limpiezas cuando varias requests fallan juntas.

## 10. apiFetch

Validado:

- Usa `credentials: include`.
- Mantiene access token solo en memoria.
- No usa localStorage.
- Reintenta una sola vez.
- No entra en loop infinito.

## 11. apiFetchBlob

Quedó alineado con `apiFetch`:

- Mismo single-flight.
- Mismo control de retry.
- Mismo manejo de fallo transitorio.
- Mismo session-expired idempotente.

## 12. Tests concurrentes

Archivo:

- `tests/e2e/sys1-auth-refresh-concurrency.spec.ts`

Resultado:

| Caso | Resultado | Evidencia |
|---|---|---|
| 401 concurrentes en Caja | PASS | `/tmp/sys1/sys1-auth-refresh-concurrency-pass6.log` |
| Una sola llamada refresh | PASS | mismo log |
| 503 en refresh no redirige a login | PASS | mismo log |
| 429 normal no llama refresh | PASS | mismo log |

Resultado Playwright: 4/4 PASS.

## 13. E2E navegación

Archivo:

- `tests/e2e/sys1-session-navigation-regression.spec.ts`

Resultado:

| Ruta | Estado |
|---|---|
| Dashboard | PASS |
| POS | PASS |
| Caja | PASS |
| Tables | PASS |
| Settings | PASS |
| Reloads | PASS |
| Sin login inesperado | PASS |

Evidencia: `/tmp/sys1/sys1-session-navigation-regression.log`

## 14. E2E Caja

Archivo:

- `tests/e2e/sys1-cash-stability-regression.spec.ts`

Resultado:

| Validación | Estado |
|---|---|
| `/cash` carga | PASS |
| Sin banner rojo global | PASS |
| Endpoints críticos 200 | PASS |
| Sin logout | PASS |

Evidencia: `/tmp/sys1/sys1-cash-stability-regression.log`

## 15. Regression delivery 8G.2

Archivo:

- `tests/e2e/audit8g2-delivery-final.spec.ts`

Resultado: PASS.

Evidencia: `/tmp/sys1/audit8g2-delivery-final-regression.log`

## 16. Build/typecheck/test

| Validación | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/sys1/api-typecheck.log` |
| API build | PASS | `/tmp/sys1/api-build.log` |
| API tests | PASS, 199/199 | `/tmp/sys1/api-test.log` |
| Web typecheck | PASS | `/tmp/sys1/web-typecheck.log` |
| Web build | PASS | `/tmp/sys1/web-build.log` |
| Docker web local rebuild | PASS | `/tmp/sys1/docker-build-web-after-grace.log` |

Nota: Web build conserva warnings preexistentes `no-explicit-any`; no son regresión SYS-1.

## 17. Health

| Check | Resultado | Evidencia |
|---|---|---|
| `/api/health` | PASS | `/tmp/sys1/health-final.log` |
| `/dashboard` | 200 | `/tmp/sys1/dashboard-head.log` |
| `/pos` | 200 | `/tmp/sys1/pos-head.log` |
| `/cash` | 200 | `/tmp/sys1/cash-head.log` |
| `/tables` | 200 | `/tmp/sys1/tables-head.log` |
| `/settings` | 200 | `/tmp/sys1/settings-head.log` |

## 18. Bundle localhost

Resultado:

- `grep -R "localhost:4300" apps/web/.next` dio 0 ocurrencias.

Evidencia:

- `/tmp/sys1/bundle-localhost4300.log`

## 19. Riesgos residuales

| Riesgo | Severidad | Estado |
|---|---:|---|
| Playwright storageState compartido entre archivos | P1 de SYS-0, no pertenece a SYS-1 | Pendiente SYS-3 |
| API test suite lenta | P2 | Pendiente SYS-3 |
| Warnings `no-explicit-any` frontend | P3 | Pendiente hardening |

## 20. Decisión final

SYS-1 AUTH SESSION SINGLE-FLIGHT REFRESH: GO

Criterios GO cumplidos:

- Una sola llamada refresh con múltiples 401 concurrentes.
- Navegación/reload PASS.
- Caja PASS.
- Delivery regression PASS.
- API/Web build/typecheck PASS.
- API tests PASS.
- Bundle limpio.
- No tokens/cookies impresos.
- No cambio inseguro de storage.
