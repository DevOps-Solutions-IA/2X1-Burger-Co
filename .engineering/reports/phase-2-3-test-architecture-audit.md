# Phase 2.3 - Auditoría de arquitectura de pruebas

Fecha: 2026-07-14.

| Componente | Estado inicial | Riesgo | Cambio requerido | Evidencia |
| --- | --- | --- | --- | --- |
| Jest API | Suites críticas existentes y funcionales | Dependencia de URL `_test` administrada externamente | Ejecutarlas contra DB creada y destruida por run | `api-regression.log` |
| Playwright | Muchas suites históricas con configuración heterogénea | Estado, puertos y fixtures podían depender del host | Config dedicada desktop/mobile sin servidor reutilizado | `playwright/report.json` |
| Prisma | 29 migraciones y guard básico `_test` | `_test` por sí solo no impide host/puerto operativo | Guard multicriterio antes de migrar | `db-guard-tests.log` |
| Seed | Seed base amplio y repetible | Faltaban aliases y escenarios explícitos para E2E | Fixtures complementarios deterministas | `fixture-seed.log` |
| Docker Compose | Runtimes operativo/canary persistentes | Colisión o montaje accidental | Project, red, volumen y puertos únicos | `snapshot.json` |
| API/web | Artifacts trazables existentes | Reutilizar runtime activo invalidaría aislamiento | Contenedores efímeros desde artifacts del mismo HEAD | `/version`, `snapshot.json` |
| Contratos | Cubiertos dentro de suites amplias | Falta de gate rápido sanitizado | 12 contratos runtime críticos | `contract-results.json` |
| RBAC | 54 escenarios backend | No existía inventario fail-closed de todos los handlers | Auditor de 249 handlers + matriz runtime de 70 decisiones | `rbac-source-audit.json`, `rbac-results.json` |
| Teardown | Dependía de cada harness | Recursos huérfanos ante fallo | `trap` con `compose down -v` y reconciliación a cero | `cleanup.json` |
| CI | Quality y artifacts, sin E2E efímero | UI/contratos no bloqueaban merge | Job `ephemeral-e2e` preparado | `.github/workflows/ci.yml` |
| Evidencia | Dispersa | Resultados difíciles de reconciliar | Directorio por run con JSON/logs/trazas al fallar | `.engineering/evidence/phase-2-3/runs/` |

## Hallazgos reproducidos durante el loop

1. El contenedor tools no tenía Corepack utilizable; se corrigió el harness para invocar binarios instalados en el artifact.
2. El path inicial de `tsx` no correspondía al workspace del artifact; se alineó con `apps/api/node_modules`.
3. Los fixtures históricos estaban asociados a la caja abierta e impedían su cierre; se movieron a la caja cerrada de referencia.
4. El smoke asumía `currentVersion` donde el contrato vigente devuelve `version`; se corrigió el test, no Delivery.
5. El smoke usaba un filtro Inventory inexistente; se cambió a `search` + `type`, que sí pertenece al DTO público.
6. El selector visual esperaba copy sin puntuación; se alineó con el texto real y honesto de la UI.
7. El auditor RBAC detectó el webhook de pagos sin clasificación; se verificó la firma en el servicio antes de declararlo `PROVIDER_SIGNATURE`.

No se modificó lógica de negocio para resolver estos hallazgos.
