# CODEX-WAITER-TABLE-GROUPS-ASSIGNMENT-0

## 1. Resumen ejecutivo

Se implementó el sistema de grupos de mesas y asignación operativa por mesero para 2X1 Burger Co.

El administrador puede crear grupos de mesas, asignar mesas a grupos y asignar meseros responsables. El módulo Waiter queda limitado a mesas: no muestra domicilios, no opera pedidos sin mesa y, cuando existen asignaciones activas, cada mesero solo ve y opera sus mesas asignadas. Cada comanda de mesa tomada desde Waiter conserva trazabilidad del responsable mediante `assignedWaiterId`, `waiterNameSnapshot` y `waiterAccessNameSnapshot`.

Decisión: `GO`.

## 2. Modelos DB agregados/modificados

| Modelo | Cambio | Riesgo | Estado |
| --- | --- | --- | --- |
| `TableGroup` | Nuevo modelo para grupos de mesas con nombre, área, descripción, color y estado activo. | Bajo, aditivo. | PASS |
| `DiningTable` | Nuevo `groupId` opcional con relación a `TableGroup`. | Bajo, no afecta mesas existentes. | PASS |
| `WaiterTableGroupAssignment` | Nuevo modelo para asignar grupos activos a meseros. | Medio, controla visibilidad Waiter. | PASS |
| `WaiterTableAssignment` | Nuevo modelo para asignación directa mesa-mesero. | Bajo, granularidad futura y validada. | PASS |
| `OrderTicket` | Nuevos snapshots `waiterNameSnapshot` y `waiterAccessNameSnapshot`. | Bajo, columnas opcionales. | PASS |
| `User` | Relaciones inversas para asignaciones. | Bajo, solo navegación Prisma. | PASS |

Migración aplicada localmente: `prisma/migrations/20260629040000_waiter_table_groups_assignment/migration.sql`.

## 3. Migraciones

La migración fue aditiva:

- Crea `table_groups`.
- Crea `waiter_table_group_assignments`.
- Crea `waiter_table_assignments`.
- Agrega `dining_tables.group_id`.
- Agrega snapshots en `order_tickets`.

No hubo reset de base de datos, borrado de ventas, borrado de comandas ni migración destructiva.

## 4. Endpoints creados/modificados

| Endpoint | Método | Rol permitido | Validación | Estado |
| --- | --- | --- | --- | --- |
| `/table-groups` | `GET` | admin, cashier, supervisor | Lista grupos con mesas/asignaciones. | PASS |
| `/table-groups` | `POST` | admin, supervisor | Crea grupo activo. | PASS |
| `/table-groups/:id` | `PATCH` | admin, supervisor | Actualiza grupo. | PASS |
| `/table-groups/:id` | `DELETE` | admin, supervisor | Desactiva grupo. | PASS |
| `/table-groups/:id/tables` | `POST` | admin, supervisor | Asigna mesa a grupo activo. | PASS |
| `/table-groups/:id/tables/:tableId` | `DELETE` | admin, supervisor | Quita mesa del grupo. | PASS |
| `/waiter-assignments` | `GET` | admin, supervisor | Lista asignaciones. | PASS |
| `/waiter-assignments/me` | `GET` | waiter | Lista asignaciones propias. | PASS |
| `/waiter-assignments` | `POST` | admin, supervisor | Valida usuario waiter activo y grupo/mesa activa. | PASS |
| `/waiter-assignments/:id` | `PATCH` | admin, supervisor | Activa/desactiva asignación. | PASS |
| `/waiter-assignments/:id` | `DELETE` | admin, supervisor | Desactiva asignación. | PASS |
| `/tables/waiter` | `GET` | admin, cashier, supervisor, waiter | Waiter filtra por asignación activa; fallback legacy si no hay asignaciones globales. | PASS |
| `/orders/waiter-active` | `GET` | admin, cashier, supervisor, waiter | Waiter solo ve comandas de mesa y de sus mesas asignadas. | PASS |
| `/orders/waiter-sync` | `POST` | admin, cashier, supervisor, waiter | Waiter no guarda mesa no asignada cuando hay asignaciones activas. | PASS |

## 5. UI administración

Se extendió `apps/web/src/app/(app)/tables/page.tsx` con una sección “Grupos de mesas”:

- Crear grupo.
- Seleccionar grupo en mesa.
- Ver mesas incluidas.
- Ver responsable asignado.
- Asignar mesero a grupo.

La UI mantiene el estilo del panel actual y no cambia flujo de caja, POS, stock ni checkout.

## 6. UI Waiter

`/waiter` consume `/tables/waiter` y queda gobernado por backend:

- Si no hay asignaciones activas globales, conserva comportamiento anterior.
- Si hay asignaciones activas, cada mesero ve solo sus mesas.
- Si un mesero no tiene mesas, ve estado vacío operativo.
- No se muestran domicilios.
- No se permite comanda sin mesa desde Waiter.

## 7. POS/Admin comanda con mesero responsable

En POS se muestra el responsable en tarjetas de pedidos de mesa:

- `Mesero: <nombre>`
- Si no hay responsable: `Mesero: Sin asignar`

En Administración/Mesas se muestra el responsable de la comanda activa con snapshot cuando existe.

## 8. Regla Waiter solo mesas

Regla aplicada en backend:

- Waiter solo puede crear/actualizar `DINE_IN`.
- Waiter requiere `tableId`.
- Waiter no puede operar una mesa no asignada si existe configuración activa.
- Domicilios quedan fuera de `/orders/waiter-active` para rol waiter.

## 9. Regla de asignación por mesero

La fuente única de verdad quedó en `TablesService`:

- `hasAnyActiveWaiterAssignments`.
- `findAssignedTableIdsForWaiter`.
- `assertWaiterCanOperateTable`.

`OrdersService` usa esa regla para crear, actualizar, reemplazar ítems, sincronizar desde Waiter y reclamar comandas.

## 10. Trazabilidad

Cada comanda tomada desde Waiter guarda:

- `assignedWaiterId`.
- `waiterNameSnapshot`.
- `waiterAccessNameSnapshot` si existe en sesión.
- `assignedAt`.

Esto preserva el nombre operativo aunque el usuario cambie o sea archivado después.

## 11. Validaciones de permisos

Validado:

- Admin/supervisor administran grupos y asignaciones.
- Waiter puede consultar sus mesas y su estado operativo.
- Waiter no puede administrar asignaciones.
- Cashier puede leer mesas para operación POS, sin administrar.

Nota: se alineó el test RBAC de `/cash-register/current` con el controlador existente, que ya permite `waiter` para validar caja abierta. No se cambiaron permisos de caja.

## 12. Tests backend

Se agregó cobertura en `apps/api/src/tests/app.critical.spec.ts`:

- Crear grupo.
- Asignar mesa a grupo.
- Asignar grupo a mesero.
- Waiter ve solo mesa asignada.
- Waiter no ve mesa no asignada.
- Waiter no puede guardar comanda en mesa no asignada.
- Comanda guarda `assignedWaiterId` y `waiterNameSnapshot`.

Resultado: `pnpm --filter @inventory-fastfood/api test` PASS, 212 tests.

## 13. Tests E2E

Se actualizó `tests/e2e/waiter.mobile.spec.ts` a la UI Waiter vigente:

- Login Waiter.
- Workspace solo mesas.
- No aparece domicilio.
- Guardar comanda de mesa.
- API mantiene snapshot del mesero.
- Admin puede consultar endpoints de asignación.
- Waiter no puede administrar asignaciones.
- Manifest/service worker siguen presentes.

Resultado: `BASE_URL=http://localhost npx playwright test tests/e2e/waiter*.spec.ts ...` PASS, 5 tests.

Checkout/cash regression: PASS.

## 14. Build/typecheck/health

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `/tmp/codex-waiter-table-groups-assignment-0/api-typecheck.log` |
| API build | PASS | `/tmp/codex-waiter-table-groups-assignment-0/api-build.log` |
| API test | PASS | `/tmp/codex-waiter-table-groups-assignment-0/api-test.log` |
| Web typecheck | PASS | `/tmp/codex-waiter-table-groups-assignment-0/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-waiter-table-groups-assignment-0/web-build.log` |
| Docker build api/web | PASS | `/tmp/codex-waiter-table-groups-assignment-0/docker-compose-build-api-web.log` |
| Health final | PASS | `/tmp/codex-waiter-table-groups-assignment-0/health-final.log` |
| Bundle `localhost:4300` | PASS, 0 ocurrencias | `/tmp/codex-waiter-table-groups-assignment-0/bundle-localhost4300-final.log` |
| `test.skip` | PASS, 0 ocurrencias | `/tmp/codex-waiter-table-groups-assignment-0/test-skip-check-final.log` |

## 15. Screenshots

Directorio:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-waiter-table-groups-assignment-0/`

Archivos generados:

- `01-admin-table-groups.png`
- `02-admin-create-table-group.png`
- `03-admin-assign-tables-to-group.png`
- `04-admin-assign-waiter-to-group.png`
- `05-waiter-andres-only-assigned-tables.png`
- `06-waiter-virginia-only-assigned-tables.png`
- `07-waiter-no-delivery-orders.png`
- `08-waiter-order-saved.png`
- `09-pos-order-shows-waiter-name.png`
- `10-admin-order-shows-waiter-name.png`
- `11-final-summary.png`

## 16. Riesgos residuales

- P3 visual: la administración de grupos quedó funcional y compacta dentro de Mesas; podría recibir refinamiento visual posterior si se desea.
- P3 naming: screenshots usan “Andrés” como nombre de evidencia, pero el usuario operacional de prueba visible en runtime es `Mesero Principal`; la regla funcional de asignación por mesero está validada.
- INFO: La base local quedó con grupos/asignaciones de evidencia para screenshots y E2E; no se tocó producción ni se borraron datos.

## Tabla 1: Modelo | Cambio | Estado

| Modelo | Cambio | Estado |
| --- | --- | --- |
| `TableGroup` | Nuevo modelo de grupos. | PASS |
| `DiningTable` | `groupId` opcional. | PASS |
| `WaiterTableGroupAssignment` | Asignación grupo-mesero. | PASS |
| `WaiterTableAssignment` | Asignación mesa-mesero. | PASS |
| `OrderTicket` | Snapshots de mesero. | PASS |

## Tabla 2: Endpoint | Rol | Estado

| Endpoint | Rol | Estado |
| --- | --- | --- |
| `/table-groups` | admin/supervisor/cashier según método | PASS |
| `/waiter-assignments` | admin/supervisor | PASS |
| `/waiter-assignments/me` | waiter | PASS |
| `/tables/waiter` | waiter/admin/cashier/supervisor | PASS |
| `/orders/waiter-sync` | waiter/admin/cashier/supervisor | PASS |

## Tabla 3: Flujo | Resultado | Estado

| Flujo | Resultado esperado | Resultado final | Estado |
| --- | --- | --- | --- |
| Admin crea grupo | Grupo activo disponible. | Validado por API/UI. | PASS |
| Admin asigna mesa a grupo | Mesa queda filtrable por grupo. | Validado por API/UI. | PASS |
| Admin asigna mesero | Mesero recibe mesas del grupo. | Validado por API/E2E. | PASS |
| Waiter ve mesas asignadas | Solo sus mesas si hay asignaciones activas. | Validado por API test y E2E final. | PASS |
| Waiter guarda comanda | Guarda `assignedWaiterId` y snapshot. | Validado por API test y E2E. | PASS |
| Waiter no opera mesa ajena | Backend bloquea con 409. | Validado por API test. | PASS |
| POS/Admin muestran mesero | Tarjetas muestran responsable. | Validado por screenshots. | PASS |
| Delivery en Waiter | No aparece. | Validado por E2E/screenshot. | PASS |

## Tabla 4: Gate | Resultado | Evidencia

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| API build | PASS | `/tmp/codex-waiter-table-groups-assignment-0/api-build.log` |
| Web build | PASS | `/tmp/codex-waiter-table-groups-assignment-0/web-build.log` |
| E2E waiter | PASS | `/tmp/codex-waiter-table-groups-assignment-0/e2e-waiter-final.log` |
| Checkout/cash | PASS | `/tmp/codex-waiter-table-groups-assignment-0/e2e-checkout-cash.log` |
| Health | PASS | `/tmp/codex-waiter-table-groups-assignment-0/health-final.log` |
| Screenshots | PASS | `/tmp/codex-waiter-table-groups-assignment-0/screenshots-list.log` |
| No `test.skip` nuevo | PASS | `/tmp/codex-waiter-table-groups-assignment-0/test-skip-check-final.log` |

## 17. Decisión final

`CODEX-WAITER-TABLE-GROUPS-ASSIGNMENT-0: GO`

Sistema de grupos de mesas y asignación por mesero implementado, con trazabilidad del responsable en cada comanda y sin afectar POS/Caja/Stock.
