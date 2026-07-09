# AUDIT-SYS-0 — Global Session + Navigation + Operational Stability Root Cause Audit

Fecha: 2026-06-20  
Sistema: inventario-fastfood-system / 2X1 Burger Co  
Decisión: NEEDS REMEDIATION

## 1. Resumen ejecutivo

La operación normal del sistema local quedó estable durante esta auditoría: Docker healthy, API health OK, rutas principales HTTP 200, navegación protegida y reloads sin cierre de sesión, Caja sin banner rojo, delivery regression PASS al ejecutarse aislado, API tests 199/199 PASS y Web/API build/typecheck PASS.

No se reprodujo un P0 de venta, caja, checkout o delivery durante navegación real secuencial.

Sin embargo, el sistema NO puede declararse CLEAN porque hay dos P1 con causa raíz clara:

| ID | Severidad | Hallazgo | Causa raíz | Riesgo |
|---|---:|---|---|---|
| SYS0-P1-001 | P1 | Refresh concurrente sin deduplicación en frontend | `apiFetch` llama `tryRefreshToken()` por cada 401 paralelo, mientras backend rota y revoca refresh tokens | Cierre de sesión intermitente cuando expira access token con múltiples requests simultáneas |
| SYS0-P1-002 | P1 | Harness Playwright comparte `tests/e2e/.auth-storage.json` y mezcla origins/puertos | E2E paralelos o reruns pueden clobber/rotar la cookie refresh | Falsos redirects a login y fallos no deterministas |

Decisión final: GLOBAL SESSION + NAVIGATION + OPERATIONAL STABILITY ROOT CAUSE AUDIT: NEEDS REMEDIATION

## 2. Snapshot técnico

| Área | Estado | Evidencia | Riesgo |
|---|---|---|---|
| Directorio | `/home/wundah/inventario` | `pwd` | Ninguno |
| Git | Sin metadata Git local | `git status`: not a git repository | P2: no hay checkpoint Git verificable |
| Docker | 4/4 healthy | `docker compose ps` | Bajo |
| API health | OK | `/tmp/audit-sys0/health.log` | Bajo |
| Nginx | Healthy | `/tmp/audit-sys0/nginx.log` | Bajo |
| Postgres | Healthy | `/tmp/audit-sys0/postgres.log` | Bajo |
| Logs | Capturados | `/tmp/audit-sys0/api.log`, `web.log`, `nginx.log`, `postgres.log` | Bajo |

## 3. Diagnóstico auth/session

| Archivo | Responsabilidad | Hallazgo | Riesgo | Acción recomendada |
|---|---|---|---|---|
| `apps/web/src/lib/api.ts` | API client, access token, refresh | `apiFetch` reintenta refresh en 401, pero no tiene mutex/dedupe | P1 | Implementar single-flight refresh promise |
| `apps/web/src/features/auth/auth-provider.tsx` | Estado global de usuario | Montaje inicial intenta refresh y luego `meRequest`; correcto para reload secuencial | Bajo | Mantener, pero usar refresh dedup compartido |
| `apps/web/src/app/(app)/layout.tsx` | Protected layout | Espera `loading` antes de redirigir a `/login`; no redirige prematuramente en prueba SYS-0 | Bajo | Mantener |
| `apps/api/src/modules/auth/auth.controller.ts` | Login/refresh/cookie | Cookie `refresh_token` httpOnly con path `/api/auth`; correcto | Bajo | Mantener path, ajustar tests para ese path |
| `apps/api/src/modules/auth/auth.service.ts` | Rotación refresh token | Cada refresh revoca token actual; reuse detection invalida tokens | Alto si frontend refresca en paralelo | Requiere lock frontend |

Respuestas explícitas:

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide cerrar sesión? | `expireCurrentSession()` y `apiFetch()` cuando refresh falla definitivamente; `AuthProvider` escucha `auth:session-expired`. |
| ¿Quién decide redirigir a login? | `apps/web/src/app/(app)/layout.tsx`, cuando `!loading && !user`. |
| ¿Cuándo se ejecuta refresh? | Al montar `AuthProvider` y cuando `apiFetch/apiFetchBlob` reciben 401. |
| ¿ProtectedRoute espera refresh? | Sí, espera `loading`; validado en navegación SYS-0. |
| ¿API client usa credentials include? | Sí, `credentials: 'include'` en `apiFetch` y `apiFetchBlob`. |
| ¿Hay refresh lock/dedup? | No. P1. |
| ¿Hay múltiples refresh simultáneos posibles? | Sí, si varios endpoints devuelven 401 en paralelo. |
| ¿Un 401 secundario puede cerrar sesión completa? | Sí, si su refresh falla; con refresh race puede ser falso negativo. |
| ¿Un 429 puede confundirse con sesión vencida? | No en `apiFetch`; se lanza `ApiError` 429 sin logout. |
| ¿Un 503 puede cerrar sesión? | No directamente; puede mostrar error de módulo. |
| ¿La cookie aplica a `/api/auth/refresh`? | Sí, path `/api/auth`. |
| ¿Hay mezcla de origins/puertos? | Sí en tests: `localhost`, `127.0.0.1`, `4300`, `4301`, `3301`, `3302`. P1 harness. |

## 4. Diagnóstico cookies/refresh

Prueba creada/ejecutada: `tests/e2e/audit-sys0-cookie-fetch-proof.spec.ts`.

Resultado:

| Prueba | Resultado | Evidencia |
|---|---|---|
| Login real | PASS | `/tmp/audit-sys0/cookie-fetch-proof-sequential.log` |
| Cookie refresh existe sin imprimir valor | PASS | `debug-cookie-presence` retorna presencia |
| `fetch('/api/auth/debug-cookie-presence', credentials include)` | PASS | Cookie visible para servidor |
| `fetch('/api/auth/refresh', credentials include)` | PASS | HTTP 201 antes y después de reload |
| `page.reload()` conserva sesión | PASS | Sin redirect login |

Hallazgo adicional: algunos tests históricos buscaban la cookie con URL `http://localhost`, pero la cookie tiene path `/api/auth`; deben consultar cookies sobre `http://localhost/api/auth/refresh`.

## 5. Diagnóstico API client

El API client es correcto en:

- No usa localStorage para access token.
- Usa `credentials: 'include'`.
- No trata 429/503 como logout.
- Reintenta 401 con refresh.

Defecto P1:

- No existe single-flight refresh.
- Con backend que rota refresh tokens, dos refresh simultáneos pueden provocar reuse detection y cierre de sesión completo.

## 6. Diagnóstico ProtectedRoute/AuthProvider

Validado:

- No redirige antes de terminar `loading`.
- Reload de rutas protegidas no mandó a login.
- Waiter/delivery tienen redirección por rol controlada.

Riesgo:

- Depende de que `tryRefreshToken` sea confiable; hoy no está protegido contra concurrencia.

## 7. Diagnóstico navegación entre páginas

Prueba creada/ejecutada: `tests/e2e/audit-sys0-session-navigation.spec.ts`.

| Ruta | Carga inicial | Reload | Redirect indebido | Evidencia |
|---|---|---|---|---|
| `/dashboard` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/pos` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/cash` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/tables` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/settings` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/inventory` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/products` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/purchases` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/expenses` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/reports` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/users` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |
| `/deliveries` | PASS | PASS | No | `/tmp/audit-sys0/session-navigation-final.log` |

No hubo failed requests críticos ni console errors críticos en la prueba final.

## 8. Diagnóstico Caja

Endpoints validados con auth real:

| Endpoint | HTTP | Crítico | Resultado | Riesgo |
|---|---:|---|---|---|
| `/api/cash-register/current` | 200 | Sí | PASS | Bajo |
| `/api/reports/operational` | 200 | Sí/medio | PASS | P2 por error global si falla |
| `/api/sales` | 200 | Medio | PASS | Bajo |
| `/api/expenses` | 200 | Medio | PASS | Bajo |
| `/api/purchases` | 200 | Medio | PASS | Bajo |
| `/api/tables` | 200 | Medio | PASS | Bajo |
| `/api/whatsapp/session` | 200 | Secundario | PASS | Bajo |
| `/api/payment-methods` | 200 | Medio | PASS | Bajo |
| `/api/cash-register/history` | 200 | Secundario | PASS | Bajo |
| `/api/cash-register/operational-log` | 200 | Secundario | PASS | Bajo |
| `/api/cash-register/close-checklist?actualAmount=0` | 200 | Cierre | PASS | Bajo |

UI:

- `/cash` carga y recarga sin banner rojo en SYS-0.
- El fix histórico de rate-limit se mantuvo.
- `pageError = currentCash.error ?? dailySummary.error`; ventas cerradas, historial y bitácora degradan localmente.

Riesgo P2:

- Si `/reports/operational` falla, Caja aún puede mostrar banner global. Recomendación: degradar `dailySummary` por bloques cuando `currentCash` está disponible.

## 9. Diagnóstico POS

Endpoints/flujo:

| Flujo | Resultado | Evidencia | Riesgo |
|---|---|---|---|
| POS carga/reload | PASS | session-navigation | Bajo |
| Delivery 8G.2 final | PASS aislado | `/tmp/audit-sys0/delivery-regression-rerun.log` | P1 harness si se ejecuta en paralelo |
| Guardar/reabrir/checkout delivery | PASS en E2E 8G.2 aislado | log rerun | Bajo app / alto harness |
| Local free y manual quote | PASS en E2E 8G.2 aislado | log rerun | Bajo |

Observación:

- Un primer intento de delivery regression falló porque la página quedó en `/login`; al rerun aislado con setup propio pasó. Se clasifica como harness/storageState compartido, no como bug funcional del motor delivery.

## 10. Diagnóstico Dashboard/Tables/Settings

| Módulo | Estado | Fallos | Riesgo |
|---|---|---|---|
| Dashboard | PASS navegación/reload | Ninguno reproducido | Bajo |
| Tables | PASS navegación/reload | Ninguno reproducido | Bajo |
| Settings | PASS navegación/reload | Ninguno reproducido | Bajo |

## 11. Diagnóstico Inventario/Productos

| Flujo | Resultado | Riesgo |
|---|---|---|
| `/inventory` carga/reload | PASS | Bajo |
| `/products` carga/reload | PASS | Bajo |
| Endpoints products/categories/units/ingredients/stock | 200 | Bajo |

Deuda:

- Warnings `no-explicit-any` en inventory y products no bloquean build, pero reducen rigor de tipos. P3/P2 según archivo.

## 12. Diagnóstico Compras/Gastos/Reportes

| Módulo | Resultado | Riesgo |
|---|---|---|
| Purchases | PASS navegación/reload y endpoint 200 | Bajo |
| Expenses | PASS navegación/reload y endpoint 200 | Bajo |
| Reports | PASS navegación/reload y endpoints 200 | P2 por agregación global de errores |

## 13. Diagnóstico Usuarios/Roles/Meseros/Domiciliarios

| Módulo | Resultado | Riesgo |
|---|---|---|
| Users | PASS navegación/reload y endpoint 200 | Bajo |
| Roles | Endpoint 200 | Bajo |
| Waiter UI | No auditado completo en flujo operacional; build incluye ruta | P2 |
| Delivery drivers UI | `/deliveries` PASS navegación/reload | Bajo |

## 14. Diagnóstico WhatsApp

| Flujo | Resultado | Riesgo | Acción |
|---|---|---|---|
| `/api/whatsapp/session` | 200 | Bajo | Mantener |
| Caja no cae por WhatsApp | PASS | Bajo | Mantener |
| 409/503 visual | No reproducido en SYS-0 | P2 | Agregar E2E de degradación controlada |

## 15. Diagnóstico checkout/deliveryFee

| Área | Estado | Evidencia |
|---|---|---|
| Delivery regression 8G.2 | PASS aislado | `/tmp/audit-sys0/delivery-regression-rerun.log` |
| Checkout deliveryFee | PASS en E2E 8G.2 aislado | log rerun |
| Caja deliveryFee | PASS en E2E 8G.2 aislado | log rerun |

## 16. Diagnóstico nginx/rate-limit

| Regla | Aplica a | Rate | Burst | Estado | Riesgo |
|---|---|---:|---:|---|---|
| `login` | `/api/auth/login` | 5r/m | 3 | Fuente y generado | Correcto para seguridad; tests deben evitar ráfagas |
| `auth` | `/api/` | 300r/m | 120 | Fuente y generado | Correcto para POS/Caja local |
| realtime | `/api/realtime/stream` | N/A | N/A | Timeout largo y buffering off | Correcto |

Archivos fuente validados:

- `infra/nginx/templates/http.conf.template`
- `infra/nginx/templates/https.conf.template`
- `infra/nginx/generated/default.conf`

Respuestas:

| Pregunta | Respuesta |
|---|---|
| ¿Rate-limit puede provocar logout? | No directamente; puede provocar 429/503 en endpoints y generar errores visuales. |
| ¿Rate-limit puede provocar banner rojo? | Sí, históricamente ocurrió en Caja antes del ajuste. |
| ¿Login tiene límite agresivo para tests? | Sí para seguridad; los tests deben usar setup compartido controlado, no ráfagas paralelas. |
| ¿Tests hacen login repetido? | Sí, varios specs y setup pueden hacerlo. |
| ¿Perfil E2E separado recomendado? | Sí: storageState por worker/run y control explícito de auth. |
| ¿Proxy headers correctos? | Sí: Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto. |
| ¿Se preservan Set-Cookie? | Sí, no hay regla que los elimine. |
| ¿Se mezclan puertos/origins? | Sí en tests; P1 harness. |
| ¿Fix 8G.2 en plantillas correcto? | Sí. |

## 17. Diagnóstico Playwright/test harness

| Test/archivo | Estado | Clasificación | Riesgo | Acción |
|---|---|---|---|---|
| `tests/e2e/playwright.noserver.config.ts` | Usa `.auth-storage.json` compartido | P1 | Clobber de sesión entre ejecuciones | Auth state por worker/run |
| `tests/e2e/auth.setup.ts` | Reescribe storageState | P1 | Paralelo puede invalidar refresh token | Serializar o aislar estado |
| `tests/e2e/audit8g2-delivery-final.spec.ts` | PASS aislado, falló cuando storageState estaba contaminado | P1 harness | Falsos NO-GO | Aislar setup |
| `tests/e2e/audit-sys0-session-navigation.spec.ts` | PASS | Útil | Bajo | Mantener |
| `tests/e2e/audit-sys0-cookie-fetch-proof.spec.ts` | PASS | Útil | Bajo | Mantener |
| Tests con `networkidle` en páginas realtime | Riesgo | P2 | Falsos timeouts | Usar waits determinísticos |
| Tests con `localhost`, `127.0.0.1`, `4300`, `4301`, `3302` | Riesgo | P1 | Cookies/origin inconsistentes | Normalizar baseURL |

## 18. Diagnóstico Prisma guard

Resultado:

- `app.critical.spec.ts` PASS.
- Suite API global PASS 12/12, 199/199.
- Tiempo alto: 384.757 s total; `app.critical.spec.ts` 204.287 s y `rbac-auth.spec.ts` 166.905 s.

Riesgo:

- P2: la suite no falló, pero sigue siendo lenta y sensible. Logs históricos de Postgres muestran `TRUNCATE ... CASCADE` y esperas de lock en ciclos anteriores.

## 19. Diagnóstico errores visuales

| Componente/módulo | Error actual | Riesgo UX | Recomendación |
|---|---|---|---|
| Cash | `pageError = currentCash.error ?? dailySummary.error` | P2 | Si `currentCash` existe, degradar dailySummary por bloque |
| Inventory | Agrega varios errores en pageError | P2 | Separar error crítico vs secundario |
| Reports | Agrega múltiples errores | P2 | Mostrar fallos por tarjeta/reporte |
| API client | Mensajes 5xx genéricos | P3 | Mejorar contexto por módulo |
| Build frontend | Muchos warnings `no-explicit-any` | P3/P2 | Tipar progresivamente módulos críticos |

## 20. Regresión delivery post 8G.2

| Ejecución | Resultado | Evidencia | Clasificación |
|---|---|---|---|
| Primer intento | FAIL, quedó en `/login` | `/tmp/audit-sys0/delivery-regression.log` | Harness/storageState |
| Rerun aislado | PASS | `/tmp/audit-sys0/delivery-regression-rerun.log` | App delivery estable |

Conclusión: delivery no queda marcado como bug funcional, pero el harness sí queda P1.

## 21. Validación base

| Validación | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/audit-sys0/api-typecheck.log` |
| API build | PASS | `/tmp/audit-sys0/api-build.log` |
| API test | PASS, 199/199 | `/tmp/audit-sys0/api-test.log` |
| Web typecheck | PASS | `/tmp/audit-sys0/web-typecheck.log` |
| Web build | PASS con warnings ESLint | `/tmp/audit-sys0/web-build.log` |
| Health | PASS | `/tmp/audit-sys0/health.log` |
| `/dashboard` HEAD | 200 | `/tmp/audit-sys0/dashboard-head.log` |
| `/pos` HEAD | 200 | `/tmp/audit-sys0/pos-head.log` |
| `/cash` HEAD | 200 | `/tmp/audit-sys0/cash-head.log` |
| `/tables` HEAD | 200 | `/tmp/audit-sys0/tables-head.log` |
| `/settings` HEAD | 200 | `/tmp/audit-sys0/settings-head.log` |
| Bundle `localhost:4300` | 0 ocurrencias | `/tmp/audit-sys0/bundle-localhost4300.log` |

## 22. Lista completa de bugs y riesgos

| ID | Severidad | Módulo | Causa | Evidencia | Acción recomendada | Responsable sugerido |
|---|---:|---|---|---|---|---|
| SYS0-P1-001 | P1 | Auth/API client | Refresh sin mutex/dedupe con backend de refresh rotation | `apps/web/src/lib/api.ts`, `apps/api/src/modules/auth/auth.service.ts` | Implementar single-flight refresh y tests concurrentes | Codex |
| SYS0-P1-002 | P1 | Playwright harness | StorageState compartido y origins mezclados | `tests/e2e/playwright.noserver.config.ts`, delivery fail inicial | Estado por worker/run y baseURL único | Codex |
| SYS0-P2-001 | P2 | Cash | `dailySummary.error` sigue como pageError global | `apps/web/src/app/(app)/cash/page.tsx:250` | Degradar por bloque si caja actual carga | Codex |
| SYS0-P2-002 | P2 | Test harness | Uso de `networkidle` en páginas con realtime/polling | SYS-0 ajuste requerido para `/deliveries` | Waits por UI/API determinísticos | Codex/DeepSeek |
| SYS0-P2-003 | P2 | API tests | Suite PASS pero lenta y sensible a locks | `api-test.log`, 384.757 s | Optimizar reset DB/advisory lock/fixtures | Codex |
| SYS0-P2-004 | P2 | Waiters/Drivers | No hubo flujo operativo completo, solo navegación | SYS-0 alcance | Agregar E2E operativo por rol | DeepSeek con revisión Codex |
| SYS0-P3-001 | P3 | Frontend typing | Warnings `no-explicit-any` en módulos críticos | `web-build.log` | Tipar progresivamente | DeepSeek |
| SYS0-P3-002 | P3 | UX errores | Mensajes genéricos 5xx por módulo | `apps/web/src/lib/api.ts` | Mensajes contextuales por pantalla | DeepSeek |

## 23. Plan de remediación

| Fase | Objetivo | Cambios | Riesgo | Tests | Responsable |
|---|---|---|---|---|---|
| SYS-1 | Auth/session/navigation hard fix | Single-flight refresh, evitar logout por refresh paralelo, test concurrente 401 | Medio | Unit API client + E2E reload/nav | Codex |
| SYS-2 | Caja/POS operational stability | Separar errores críticos/secundarios, smoke Caja/POS con endpoints parciales | Medio | E2E Caja/POS, API endpoint checks | Codex |
| SYS-3 | Playwright/test harness cleanup | StorageState por worker/run, baseURL único, no parallel shared auth, eliminar origin mix | Medio | Suite E2E completa noserver | Codex |
| SYS-4 | Frontend error boundaries + UX stability | Data-testid faltantes, mensajes por módulo, typing gradual | Bajo | Visual/E2E secundarios | DeepSeek |
| SYS-5 | Regression gate before production/V2 | Gate final auth/cash/pos/delivery/reportes | Medio | Full regression + screenshots | Codex |

## 24. Qué debe hacer Codex

- Implementar refresh single-flight en `apps/web/src/lib/api.ts`.
- Agregar prueba de múltiples 401 concurrentes.
- Rediseñar harness Playwright para no compartir refresh cookie entre comandos/worker.
- Normalizar baseURL en E2E Docker.
- Corregir degradación de errores en Caja/POS.
- Optimizar test DB reset si vuelve a aparecer lock/deadlock.
- Ejecutar SYS-5 antes de producción.

## 25. Qué puede delegarse a DeepSeek sin riesgo

- Agregar data-testid faltantes.
- Mejorar mensajes visuales de módulos secundarios.
- Reducir warnings `no-explicit-any` en pantallas no críticas bajo revisión.
- Documentar matriz de rutas/endpoints.
- Añadir E2E secundarios para waiters/drivers/WhatsApp, sin tocar auth core.

## 26. Qué NO se debe tocar

- No tocar lógica delivery 8G.2 salvo regresión medida.
- No bajar rate-limit productivo.
- No desactivar refresh rotation.
- No guardar access token en localStorage.
- No cambiar cookie httpOnly/path sin prueba.
- No mezclar origins para “hacer pasar” tests.
- No ocultar banners sin separar causa crítica/secundaria.
- No borrar datos reales ni resetear base real.

## 27. Riesgos antes de producción/V2

| Riesgo | Severidad | Estado |
|---|---:|---|
| Cierre intermitente por refresh race | P1 | Requiere SYS-1 |
| E2E no determinista por auth shared state | P1 | Requiere SYS-3 |
| Caja puede mostrar error global si falla daily summary | P2 | Requiere SYS-2 |
| Suite API lenta/sensible a locks | P2 | Requiere SYS-3 |
| Cobertura funcional incompleta de meseros/domiciliarios | P2 | Requiere SYS-4 |
| Warnings TypeScript/ESLint de `any` | P3 | Requiere hardening gradual |

## 28. Decisión final

GLOBAL SESSION + NAVIGATION + OPERATIONAL STABILITY ROOT CAUSE AUDIT: NEEDS REMEDIATION

Justificación:

- No hay P0 reproducido.
- Navegación protegida y reloads pasaron.
- Caja no mostró banner rojo en carga normal.
- POS y delivery regression pasaron aislados.
- API/Web build/typecheck/test pasaron.
- Pero hay P1 abiertos con causa raíz clara en refresh concurrente y harness E2E, por lo tanto no cumple criterio CLEAN.
