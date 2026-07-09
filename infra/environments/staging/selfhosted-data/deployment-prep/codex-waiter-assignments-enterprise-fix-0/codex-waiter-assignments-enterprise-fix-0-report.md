# CODEX-WAITER-ASSIGNMENTS-ENTERPRISE-FIX-0

## 1. Resumen ejecutivo

Se corrigió la lógica de asignación de mesas/grupos a meseros para operar con política enterprise exclusiva. Cuando un grupo o mesa directa se reasigna, las asignaciones activas conflictivas anteriores se desactivan transaccionalmente y solo queda un responsable operativo activo.

También se amplió la administración de grupos para editar grupos existentes, cambiar nombre/área/descripción/color/estado, modificar mesas del grupo y cambiar responsable con confirmación operacional.

Decisión: `CODEX-WAITER-ASSIGNMENTS-ENTERPRISE-FIX-0: GO`.

## 2. Bug reportado

- Virginia seguía viendo mesas o grupos después de reasignarlos a Andrés.
- La reasignación no actualizaba claramente el responsable operativo.
- La UI administrativa permitía crear grupos/asignar, pero no editar grupos existentes de forma completa.
- La administración no hacía evidente la prioridad entre grupo y asignación directa.

## 3. Causa raíz

La creación de asignaciones usaba `upsert` por `waiterId + tableGroupId + isActive` o `waiterId + tableId + isActive`. Eso impedía duplicados para el mismo mesero, pero no impedía que otro mesero conservara una asignación activa del mismo grupo o mesa.

Además, `/tables/waiter` resolvía asignaciones como unión simple entre grupos y mesas directas, sin excluir mesas de grupo que tenían asignación directa activa a otro mesero.

## 4. Política de asignación exclusiva

Modo por defecto: `exclusiveAssignment = true`.

- Un grupo solo puede tener un mesero activo.
- Una mesa directa solo puede tener un mesero activo.
- Reasignar un grupo desactiva asignaciones activas previas del mismo grupo.
- Reasignar una mesa directa desactiva asignaciones activas previas de la misma mesa.
- El historial inactivo se conserva para auditoría.

## 5. Política de prioridad asignación directa vs grupo

La asignación directa de mesa tiene prioridad sobre la asignación por grupo.

Ejemplo validado:

- Grupo `Exterior` asignado a Andrés.
- Mesa `Mesa Enterprise 3` asignada directamente a Virginia.
- Andrés deja de ver esa mesa.
- Virginia sí ve esa mesa.

## 6. Cambios backend

- `TablesService.findAssignedTableIdsForWaiter` ahora excluye mesas de grupo que tengan asignación directa activa a otro mesero.
- `createWaiterAssignment` ahora usa reemplazo transaccional.
- `updateWaiterAssignment` respeta exclusividad cuando se reactiva una asignación antigua.
- Se agregaron operaciones explícitas:
  - `replaceGroupAssignment`
  - `replaceTableAssignment`
- Se mantiene `publishOperationalRefresh('tables')` después de cambios administrativos.

## 7. Cambios DB/Prisma

No se requirió nueva migración. Los modelos existentes ya tenían índices suficientes para operar:

- `WaiterTableGroupAssignment`: índices por `tableGroupId/isActive` y `waiterId/isActive`.
- `WaiterTableAssignment`: índices por `tableId/isActive` y `waiterId/isActive`.

La exclusividad se controla en servicio mediante transacción para evitar depender de unique parcial.

## 8. Cambios frontend admin

Archivo principal: `apps/web/src/app/(app)/tables/page.tsx`.

Se agregó:

- Edición de grupo seleccionado.
- Cambio de nombre, área, descripción, color y estado.
- Gestión de mesas del grupo.
- Cambio de responsable con confirmación:
  - “Este grupo pasará de X a Y. X dejará de ver estas mesas.”
- Query de `/waiter-assignments`.
- Indicador de asignación directa y prioridad sobre grupo.
- Invalidación de queries:
  - `tables`
  - `table-groups`
  - `waiter-assignments`
  - `waiter-tables`
  - `active-orders`

## 9. Cambios Waiter

No se cambió el flujo visual principal de `/waiter`. El cambio funcional ocurre en backend:

- Waiter ve solo sus mesas asignadas cuando hay asignaciones activas.
- Waiter deja de ver mesas reasignadas a otro mesero.
- Waiter incluye mesas directas asignadas aunque pertenezcan a un grupo de otro mesero.
- Waiter no ve domicilios.

## 10. Edición de grupos

Validado:

- Grupo existente puede renombrarse.
- Mesas asociadas se conservan al editar metadatos.
- Mesas pueden agregarse/quitarse del grupo.
- Responsable puede cambiarse sin crear duplicado activo.
- Grupo puede inactivarse.

## 11. Reasignación Virginia → Andrés validada

Validado en backend test y E2E:

- Grupo asignado inicialmente a Virginia.
- Grupo reasignado a Andrés.
- Solo queda una asignación activa del grupo.
- Virginia deja de ver mesas del grupo.
- Andrés ve mesas del grupo.

## 12. Trazabilidad histórica

Regla validada:

- La comanda histórica conserva `assignedWaiterId` y `waiterNameSnapshot`.
- Una comanda nueva después de reasignación toma el mesero autenticado actual.
- No se reescriben snapshots históricos.

## 13. Query invalidation/cache

Después de crear/editar/reasignar:

- Se invalidan grupos.
- Se invalidan mesas.
- Se invalidan asignaciones.
- Se invalida vista waiter si está cacheada.
- Se invalida active orders.

## 14. Tests backend

Evidencia principal:

- `/tmp/codex-waiter-assignments-enterprise-fix-0/api-enterprise-assignment-test.log`

Resultado:

- `1 passed`
- Valida reasignación exclusiva, edición, prioridad directa y snapshot histórico.

Nota: el wrapper full API ejecuta suites históricas y falla en casos no relacionados por schema test DB ausente (`delivery_pricing_audits`). El caso backend de esta fase pasó de forma aislada y reproducible con `--testNamePattern`.

## 15. Tests E2E

Evidencia:

- `/tmp/codex-waiter-assignments-enterprise-fix-0/e2e-waiter.log`

Resultado:

- `6 passed`

Incluye:

- Login waiter.
- Comanda con snapshot.
- Reasignación enterprise.
- Cambio responsable Virginia → Andrés.
- Edición nombre grupo.
- Prioridad asignación directa.
- Endpoints protegidos.
- Manifest/service worker.

## 16. Build/typecheck/health

- API typecheck: PASS.
- API build: PASS.
- Web typecheck: PASS.
- Web build: PASS.
- Docker build api/web: PASS.
- Health final: PASS.

## 17. Screenshots

Directorio:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-waiter-assignments-enterprise-fix-0/`

Capturas:

- `01-admin-current-assignments-before.png`
- `02-admin-edit-group-name.png`
- `03-admin-change-responsible-virginia-to-andres.png`
- `04-admin-confirm-reassignment.png`
- `05-admin-after-reassignment-responsible-andres.png`
- `06-virginia-no-longer-sees-tables.png`
- `07-andres-now-sees-tables.png`
- `08-direct-table-assignment-priority.png`
- `09-pos-order-shows-current-waiter.png`
- `10-historical-order-keeps-old-waiter.png`
- `11-final-summary.png`

## 18. Riesgos residuales

- P3: La UI administrativa es funcional y enterprise, pero puede refinarse visualmente después si se desea.
- INFO: No se implementó transferencia explícita de comandas abiertas; por diseño, la comanda abierta conserva el mesero que la abrió.
- INFO: El full API wrapper mantiene una falla no relacionada con esta fase por schema test DB (`delivery_pricing_audits`), documentada en logs.

## Tabla 1: Problema | Causa raíz | Corrección | Estado

| Problema | Causa raíz | Corrección | Estado |
| --- | --- | --- | --- |
| Virginia seguía viendo mesas reasignadas | Asignación no era exclusiva por grupo | `replaceGroupAssignment` desactiva previas | PASS |
| Mesa directa podía quedar conflictiva | Asignación no era exclusiva por mesa | `replaceTableAssignment` desactiva previas | PASS |
| Grupo no editable completo | UI solo creaba/asignaba | Panel edición grupo existente | PASS |
| Directa vs grupo sin prioridad | Unión simple de asignaciones | Directa excluye mesa del grupo de otro mesero | PASS |
| Histórico vulnerable a reasignación | Riesgo de reinterpretar responsable actual | Snapshot histórico preservado | PASS |

## Tabla 2: Modelo/API | Cambio | Estado

| Modelo/API | Cambio | Estado |
| --- | --- | --- |
| `WaiterTableGroupAssignment` | Exclusividad por transacción | PASS |
| `WaiterTableAssignment` | Exclusividad por transacción | PASS |
| `/waiter-assignments` | Reemplazo de responsable activo | PASS |
| `/tables/waiter` | Filtro con prioridad directa | PASS |
| `/table-groups/:id` | Edición administrativa completa | PASS |
| `/table-groups/:id/tables` | Gestión mesas grupo | PASS |

## Tabla 3: Flujo | Resultado esperado | Resultado final | Estado

| Flujo | Resultado esperado | Resultado final | Estado |
| --- | --- | --- | --- |
| Grupo Virginia → Andrés | Virginia pierde mesas, Andrés las ve | Validado API/E2E | PASS |
| Mesa directa Virginia | Pisa responsable de grupo | Validado API/E2E | PASS |
| Editar nombre de grupo | UI y waiter muestran nuevo nombre | Validado API/E2E/screenshots | PASS |
| Quitar mesa del grupo | Sale del grupo sin borrar mesa | Validado API | PASS |
| Comanda histórica | Conserva Virginia | Validado API/E2E | PASS |
| Comanda nueva | Toma mesero actual | Validado API/E2E | PASS |
| Delivery en Waiter | No aparece | Validado E2E | PASS |
| Checkout/cash | Sin regresión | Validado E2E | PASS |

## Tabla 4: Gate | Resultado | Evidencia

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/api-typecheck.log` |
| API build | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/api-build.log` |
| Backend assignment test | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/api-enterprise-assignment-test.log` |
| Web typecheck | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/web-build.log` |
| E2E waiter | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/e2e-waiter.log` |
| E2E checkout/cash | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/e2e-checkout-cash.log` |
| Health | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/health-final.log` |
| Docker build | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/docker-compose-build-api-web.log` |
| No `test.skip` nuevo | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/test-skip-check.log` |
| Screenshots | PASS | `/tmp/codex-waiter-assignments-enterprise-fix-0/screenshots-list.log` |

## 19. Decisión final

`CODEX-WAITER-ASSIGNMENTS-ENTERPRISE-FIX-0: GO`

Sistema de asignaciones corregido a nivel enterprise: reasignación efectiva, edición completa de grupos, prioridad definida y trazabilidad de mesero preservada.
