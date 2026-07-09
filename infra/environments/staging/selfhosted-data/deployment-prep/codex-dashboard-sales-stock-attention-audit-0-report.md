# CODEX-DASHBOARD-SALES-STOCK-ATTENTION-AUDIT-0

## 1. Resumen ejecutivo

Se corrigió la inconsistencia del Dashboard donde la barra superior mostraba unidades vendidas con el copy ambiguo `vendidos hoy`, mientras `Estado del día` mostraba ventas/tickets registrados. La fuente única sigue siendo `/reports/operational`, pero ahora el backend expone explícitamente `sales.itemsSold` además de `sales.count`.

`Atención requerida` dejó de depender de una fuente parcial y ahora consume el bloque `replenishment` del reporte operacional, combinando productos de stock directo e insumos con stock bajo, crítico o agotado. Se agregaron filtros `Todos`, `Productos` e `Insumos`, con contadores derivados de la misma fuente.

Decisión: `GO`.

## 2. Problema 100 vs 99

La barra superior calculaba su número sumando `sales.bestSellers[].quantity`; ese valor representa unidades vendidas. El bloque `Estado del día` usaba `sales.count`, que representa ventas/tickets cerrados. Ambos valores podían ser distintos y el copy hacía parecer que medían lo mismo.

## 3. Fuente anterior de topbar

Archivo: `apps/web/src/components/app-shell.tsx`

Antes:
- Endpoint: `/reports/operational`.
- Fuente: `sales.bestSellers`.
- Cálculo frontend: suma de cantidades del ranking de productos.
- Texto visible: `vendidos hoy`.
- Riesgo: `bestSellers` es ranking/top y además mide unidades, no tickets.

## 4. Fuente anterior de Estado del día

Archivo: `apps/web/src/app/(app)/dashboard/page.tsx`

Antes:
- Endpoint: `/reports/operational`.
- Fuente: `sales.count`.
- Texto visible: `ventas registradas`.
- Criterio: ventas pagadas/finalizadas del periodo operacional.

## 5. Fuente única corregida

Archivo: `apps/api/src/modules/reports/reports.service.ts`

El backend ahora entrega:
- `sales.count`: número de ventas/tickets pagados.
- `sales.itemsSold`: unidades vendidas.
- `sales.canceledCount`: ventas canceladas del periodo.
- `sales.pendingCount`: ventas pendientes del periodo.

El frontend no vuelve a inferir `itemsSold` desde `bestSellers`.

## 6. Definición de ventas hoy

`VENTAS_HOY` queda definido como ventas pagadas/finalizadas dentro de la jornada operacional actual, excluyendo pendientes y canceladas.

`UNIDADES_VENDIDAS_HOY` queda definido como suma de cantidades de ítems vendidos en las ventas pagadas de la jornada.

## 7. Diferencia entre ventas/tickets/itemsSold

- `sales.count`: tickets/ventas registradas.
- `sales.itemsSold`: unidades vendidas.
- `sales.bestSellers`: ranking de productos, no fuente de conteo global.

La barra superior ahora muestra `unidades vendidas hoy`. El bloque `Estado del día` mantiene `ventas registradas`.

## 8. Atención requerida

Archivo: `apps/web/src/app/(app)/dashboard/page.tsx`

Ahora combina, sin duplicados:
- `replenishment.productOutOfStock`
- `replenishment.productCriticalStock`
- `replenishment.productLowStock`
- `replenishment.outOfStock`
- `replenishment.criticalStock`
- `replenishment.lowStock`

## 9. Productos críticos

Los productos activos con stock directo y `currentStock <= stockMin` entran a Atención requerida. Los productos preparados por receta no se clasifican como stock directo falso.

El backend añade metadatos de producto:
- categoría,
- unidad,
- faltante,
- sugerido.

## 10. Insumos críticos

Los insumos activos con `currentStock <= stockMin` entran a Atención requerida. La clasificación se mantiene desde backend:
- agotado,
- crítico,
- bajo.

## 11. Filtros Todos/Productos/Insumos

Se agregaron tabs:
- `Todos (total)`.
- `Productos (productAlertCount)`.
- `Insumos (ingredientAlertCount)`.

Los contadores salen del mismo arreglo normalizado y deduplicado que renderiza las cards.

## 12. Conteos

El E2E `dashboard-sales-stock-attention-audit-0.spec.ts` usa `/api/reports/operational` como oracle y valida que los contadores de la UI coincidan con el reporte real.

## 13. Tests

API:
- `apps/api/src/tests/app.critical.spec.ts`
- Se agregó validación de `sales.itemsSold`, `sales.count`, `canceledCount`, `pendingCount`.
- Se agregó validación de alertas de producto directo e insumo crítico.

E2E:
- `tests/e2e/dashboard-sales-stock-attention-audit-0.spec.ts`
- Valida topbar, Estado del día, tabs, contadores, filtros y ausencia de `undefined|null|NaN`.

## 14. E2E

Resultados:
- Dashboard sales/stock attention: PASS.
- Delivery POS display: PASS en rerun aislado.
- Checkout/cash audit: PASS.

Nota: La primera ejecución de POS display falló por `429` en login del fixture al correr en paralelo con checkout/cash. Se reejecutó aislado sin cambiar rate-limit y pasó.

## 15. Health

`curl -fsS http://localhost/api/health`: PASS.

Evidencia:
- `/tmp/codex-dashboard-sales-stock-attention-audit-0/health.log`
- `/tmp/codex-dashboard-sales-stock-attention-audit-0/health-after-rebuild.log`

## 16. Bundle

`grep -R "localhost:4300" apps/web/.next`: 0 ocurrencias.

Evidencia:
- `/tmp/codex-dashboard-sales-stock-attention-audit-0/bundle-localhost4300.log`

## 17. Docker

`docker compose build api web`: PASS.

Se recrearon localmente `api`, `web` y `nginx` para que Playwright validara el código nuevo servido por `http://localhost`.

Evidencia:
- `/tmp/codex-dashboard-sales-stock-attention-audit-0/docker-compose-build-api-web.log`
- `/tmp/codex-dashboard-sales-stock-attention-audit-0/docker-compose-up-after-build.log`

## 18. Screenshots

Todas las capturas obligatorias fueron generadas:

| Screenshot | Existe | Tamaño | Qué demuestra |
| --- | --- | ---: | --- |
| `01-dashboard-sales-count-consistent.png` | Sí | 152277 bytes | Dashboard sin contradicción entre unidades y ventas |
| `02-topbar-vs-status-day-same-source.png` | Sí | 152277 bytes | Topbar y Estado del día con labels correctos |
| `03-attention-required-all.png` | Sí | 152277 bytes | Filtro Todos |
| `04-attention-required-products.png` | Sí | 153437 bytes | Filtro Productos |
| `05-attention-required-ingredients.png` | Sí | 152084 bytes | Filtro Insumos |
| `06-critical-product-red-state.png` | Sí | 153408 bytes | Producto crítico visible |
| `07-critical-ingredient-red-state.png` | Sí | 152110 bytes | Insumo crítico visible |
| `08-dashboard-mobile-attention-tabs.png` | Sí | 121484 bytes | Responsive mobile |
| `09-final-dashboard-summary.png` | Sí | 11631 bytes | Resumen final |

## 19. Riesgos residuales

- Web build conserva warnings `@typescript-eslint/no-explicit-any` preexistentes en varios módulos, incluyendo Dashboard y Shell.
- No hay metadata Git en el workspace, por lo que `git status` no pudo generar estado de control de cambios.
- El rate-limit de login puede afectar ejecuciones E2E paralelas si se lanzan specs con fixtures de auth simultáneos. No se relajó seguridad.

## 20. Decisión final

`CODEX-DASHBOARD-SALES-STOCK-ATTENTION-AUDIT-0: GO`

