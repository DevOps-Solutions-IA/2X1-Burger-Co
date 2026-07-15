# Engineering Framework Phase 2.3 - Ephemeral Test Platform

Fecha: 2026-07-14.

## 1. Resumen ejecutivo

Se implementó una plataforma efímera ejecutable con `pnpm test:e2e:ephemeral`. Cada run crea identidad, PostgreSQL, usuario, base, red, volumen y puertos propios; valida el destino antes de migrar; aplica 29 migraciones; ejecuta seed determinista; levanta API/web desde artifacts trazables; corre contratos, RBAC, smokes de negocio, safety runtime y Playwright; conserva evidencia; y destruye todos los recursos incluso ante fallo.

La decisión es **GO CONDICIONADO**. La plataforma local pasa repetibilidad 3X y dos runs paralelos, pero el job CI no puede convertirse en required check hasta que el owner configure remote y branch protections.

## 2. Snapshot y artifact

| Elemento | Resultado |
| --- | --- |
| HEAD | `66c54785f6d1383e40f28e66dd825a4db11d6a44` |
| API image | Artifact Phase 2.1 con revisión igual a HEAD |
| Web image | Artifact Phase 2.1 con revisión igual a HEAD |
| Release identity | API/web comparten commit y build ID |
| Dirty artifact | `false` |
| Harness Phase 2.3 | Working tree sin commit; no se hizo push |
| Runtime operativo | Preservado |

## 3. Aislamiento y DB guard

El guard exige simultáneamente marker efímero, run ID válido, project prefix, host autorizado, puerto dinámico no operativo, nombre de DB terminado en `_test` con marker y usuario `e2e_`. Nueve tests negativos/positivos pasan. La URL solo se registra sanitizada.

El compose no monta sesiones, tokens, QR ni volúmenes operativos. Los flags fijan real send, Auto Reply, Auto Safe, producción y QR en OFF. Los puertos `5432`, `55432`, `55433`, `3301`, `3401`, `4300` y `4400` no se reutilizan.

## 4. Migraciones y seed

- 29/29 migraciones aplicadas desde cero en cada run.
- `prisma migrate status` PASS.
- Seed base + fixtures deterministas: PASS.
- Usuarios sintéticos: admin, supervisor, cashier, waiter, inventory, delivery y sin permisos.
- Fixtures: productos/categorías/recetas/stock, caja abierta/cerrada, venta, orden y delivery.
- Correos/teléfonos son sintéticos; no hay sesiones ni API keys reales.

## 5. Contratos y RBAC

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| Contratos runtime | 12/12 PASS | `contract-results.json` |
| RBAC source fail-closed | 249/249 handlers clasificados | `rbac-source-audit.json` |
| RBAC runtime | 70/70 decisiones PASS | `rbac-results.json` |
| RBAC backend | 54 escenarios PASS | `api-regression.log` |
| Rutas sin política | 0 | `phase-2-3-rbac-matrix.md` |

La clasificación reconoce 230 handlers JWT+roles, 6 JWT autenticados, 8 públicos explícitos, 2 con capability token y 3 webhooks con firma verificada. Una ruta nueva sin política reconocida falla el comando.

## 6. E2E UI

Playwright ejecutó 5/5 pruebas PASS sobre Chrome desktop y Pixel 5:

- login admin y navegación por dashboard, Caja, POS, Delivery, Inventory, Users y Sofía;
- login inválido con error honesto;
- estados seguros Sofía/WhatsApp;
- logout;
- carga móvil sin overflow horizontal.

La política conserva screenshots, video y trace cuando falla; el fallo visual reproducido durante el loop dejó los tres artefactos. Los runs exitosos conservan el reporte JSON y logs de red/runtime sin generar video innecesario.

## 7. Business smoke

| Módulo | Escenario | Resultado |
| --- | --- | --- |
| Caja | sesión abierta, movimiento, resumen, cierre, reapertura y auditoría | PASS |
| POS | catálogo, venta sintética, total, PDF y consumo de stock | PASS |
| Delivery | orden, fee persistido, PDF vigente, versión y ubicación sin repricing | PASS |
| Inventory | ajuste, stock resultante y movimiento consultable | PASS |
| Sofía/WhatsApp | flags OFF, QR DISABLED y cero envío | PASS |

Recovery completo de Caja/POS y flujos operativos complejos permanecen correctamente fuera de alcance hasta Phase 2.5.

## 8. Failure injection y teardown

El fallo inyectado después del seed devolvió exit 70 y limpió 0/0/0 recursos. Fallos reales de contratos, business smoke y Playwright durante el loop también conservaron evidencia y limpiaron. Cada `cleanup.json` final reporta:

```text
composeDownExit=0, containers=0, volumes=0, networks=0
```

El teardown está registrado con `trap` para `EXIT`, `INT` y `TERM`.

## 9. Repetibilidad y paralelismo

| Run final | Migraciones | Seed | Ready | Tests | Total | Cleanup |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `run-20260714015033-8135bf4d` | 6 s | 6 s | 9 s | 13 s | 38 s | 0/0/0 |
| `run-20260714015123-c98f5127` | 6 s | 6 s | 10 s | 12 s | 37 s | 0/0/0 |
| `run-20260714015213-10a4c6b2` | 7 s | 6 s | 9 s | 13 s | 37 s | 0/0/0 |

Dos runs paralelos (`47059d02`, `eb604d74`) terminaron PASS con projects, DBs, puertos y evidencia independientes. No se requirió locking.

## 10. Regresión API

Un run aislado adicional detuvo API/web después del E2E y ejecutó Jest sobre su DB efímera:

| Suite | Tests | Duración | Resultado |
| --- | ---: | ---: | --- |
| Critical integration | 91 | 336.882 s | PASS |
| RBAC backend | 54 | 179.228 s | PASS |
| Delivery Phase A | 11 | 17.365 s | PASS |
| Total | 156 | 533.518 s | PASS |

Jest terminó por sí solo, sin `forceExit`. Cleanup posterior: cero recursos.

## 11. Build, typecheck y seguridad

| Check | Resultado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `validation/api-typecheck.log` |
| API build | PASS | `validation/api-build.log` |
| Web build | PASS | `validation/web-build.log` |
| Web typecheck serial | PASS | `validation/web-typecheck-serial.log` |
| Config/provenance | 6/6 PASS | `validation/config-provenance.log` |
| WhatsApp timeout | 3/3 PASS | `validation/whatsapp-timeout.log` |
| DB guard | 9/9 PASS | `validation/db-guard.log` |
| Secret scan | PASS | `validation/secret-scan.log` |

Una ejecución paralela inicial de web typecheck/build falló porque `next build` reemplazó `.next/types` mientras TypeScript lo leía. La validación correcta se repitió serialmente y pasó; CI ya las ejecuta en secuencia.

## 12. CI

Se agregó el job `ephemeral-e2e` después de `quality`. Instala con lockfile congelado, instala Chromium, construye artifacts si no existen, ejecuta el comando único y sube evidencia siempre. No contiene credenciales ni targets inventados.

Estado: **READY / BLOCKED BY OWNER GATE**. El workflow está preparado, pero no puede demostrarse como required sin remote, protections y ejecución GitHub real.

## 13. Performance baseline

Run estándar: 37-38 s. La suite crítica y RBAC backend son el principal costo (533.518 s combinados). El baseline no demuestra capacidad productiva; se usará en Phase 2.4/Performance para budgets y partición segura.

## 14. Archivos de implementación

| Archivo | Cambio |
| --- | --- |
| `infra/testing/run-ephemeral-e2e.sh` | Orquestación, gates, evidencia y teardown |
| `infra/testing/docker-compose.ephemeral.yml` | PostgreSQL/API/web/tools aislados |
| `infra/testing/db-guard.mjs` | Guard multicriterio fail-closed |
| `infra/testing/db-guard.test.mjs` | 9 pruebas de guard |
| `infra/testing/ephemeral-fixtures.ts` | Fixtures deterministas complementarios |
| `infra/testing/contract-tests.mjs` | Contratos runtime |
| `infra/testing/rbac-tests.mjs` | Matriz runtime crítica |
| `infra/testing/rbac-source-audit.mjs` | Inventario fail-closed de handlers |
| `infra/testing/business-smoke.mjs` | Smokes base transversales |
| `infra/testing/playwright.ephemeral.config.ts` | Config UI aislada |
| `tests/e2e/ephemeral/*` | Desktop/mobile E2E |
| `.github/workflows/ci.yml` | Job efímero |
| `package.json` | Comandos estables |

## 15. Riesgos y owner gates

- Remote y branch protections ausentes: el check no es required todavía.
- Staging remoto y registry siguen pendientes.
- Critical/RBAC backend requieren partición para reducir feedback sin perder cobertura.
- Backup/restore, RTO/RPO y observabilidad corresponden a Phase 2.4.
- Recovery completo de Caja/POS/Inventory corresponde a Phase 2.5.
- Los artifacts de aplicación corresponden al HEAD limpio; el harness Phase 2.3 sigue sin commit por instrucción y deberá pasar revisión antes de CI real.

## 16. Decisión

**ENGINEERING PHASE 2.3: GO CONDICIONADO**.

La plataforma local cumple aislamiento, migraciones, seed, contratos, RBAC, E2E, business smoke, repetibilidad, paralelismo y teardown. La condición es exclusivamente externa: convertir `ephemeral-e2e` en required check mediante remote/protections del owner.
