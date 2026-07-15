# Phase 2.5.1 - Persistent Audit Contract Remediation

Fecha local: 2026-07-14 (America/Bogota)

## 1. Resumen ejecutivo

Se implementó un contrato persistente v2, aditivo y tipado para `AuditLog`: contexto ALS, redacción central, consulta RBAC, campos de actor/request/correlation/trace/idempotency, snapshots limitados y resultado/reason code. Las 30 migraciones aplican desde cero, los unit tests pasan y API/web compilan.

La fase es **NO-GO**. En la tercera iteración, el E2E operacional demostró que `RBAC_DENIED` persiste `actorId` pero no `actorRole`. Nest ejecuta el guard antes del interceptor que hidrata el actor en ALS. El límite de tres iteraciones impide una cuarta corrección. Tampoco se alcanzaron upgrade drill, rollback, artifact limpio ni tres runs completos.

## 2. Snapshot

| Control | Resultado | Evidencia |
| --- | --- | --- |
| HEAD | `66c54785f6d1383e40f28e66dd825a4db11d6a44` | `checkpoints/phase-2-5-1-before.md` |
| Working tree | Mezclado y respaldado; no se descartaron cambios | `/tmp/phase-2-5-1-audit/` |
| Runtime operativo | Preservado | `evidence/phase-2-5-1/runtime-before.txt` |
| DB operativa | No tocada | runner y cleanup |
| Producción | No modificada | runner |
| WhatsApp real | OFF | configuración efímera |

## 3. Inventario y contrato

El inventario está en `phase-2-5-1-audit-inventory.md` y el contrato en `phase-2-5-1-audit-contract.md`. Se encontraron 85 llamadas legacy a `AuditService` y seis bypasses directos de Sofía. Los seis bypasses fueron migrados al servicio central; el scan final encuentra cero `auditLog.create` fuera de `AuditService`.

| Campo | Implementado | Validación observada | Estado |
| --- | --- | --- | --- |
| eventVersion/timestamp | Sí | Eventos operativos v2 | GO |
| actorId/actorType | Sí | Operaciones y RBAC denied | GO |
| actorRole | Sí en schema/context | Null en `RBAC_DENIED` | NO-GO |
| request/correlation/trace | Sí | Eventos operativos ejecutados | GO |
| idempotencyKey | Sí | Requests mutantes sintéticos | GO |
| before/after | Sí, sanitizados y limitados | Acciones core comprobadas antes del fallo final | GO |
| result/reason | Sí | SUCCESS/REJECTED y reason codes | GO |
| source/environment/release | Sí | Unit/build | CONDICIONADO |

## 4. Schema y migración

La migración `20260714220000_persistent_audit_contract_v2` añade columnas nullable/defaults e índices sin borrar ni renombrar campos legacy. Las 30 migraciones aplicaron desde cero y `prisma migrate status` quedó actualizado.

No se ejecutó el upgrade drill desde una DB Phase 2.5, backup/restore posterior ni rollback por artifact tras el fallo de la tercera iteración. Por ello el gate completo de migración es NO-GO aunque el fresh migration sea PASS.

## 5. Contexto y redacción

`AuditContextService` usa `AsyncLocalStorage`, valida IDs, genera faltantes, define rol efectivo y separa requests concurrentes. El middleware crea el contexto antes de llamar `next`; el interceptor hidrata el usuario autenticado. `AuditService` completa v2, aplica allowlist estructural, límites de profundidad/tamaño, redacción de claves y masking de teléfonos.

La redacción bloqueó secretos/tokens/passwords y el runtime safety conserva idempotencia mediante hash truncado. El scan del scope modificado encontró cero candidatos de secretos, cero activaciones reales y cero nuevos skips/forceExit/process.exit.

## 6. Transaccionalidad

| Acción | Audit transaccional implementado | Estado |
| --- | --- | --- |
| Caja open/close/reopen/movement | Sí | CONDICIONADO por falta 3X |
| Sale create | Sí | CONDICIONADO |
| Purchase create | Sí | CONDICIONADO |
| Inventory adjustment/stock count | Sí | CONDICIONADO |
| Recovery/reopen/reversal restantes | No universal | NO-GO |
| Delivery commercial/location | Centralizado, no universalmente atómico | NO-GO |

`AuditService.log(input, tx)` falla hacia arriba si el insert falla; el unit test confirma fail-closed. La cobertura transaccional universal exigida no se completó.

## 7. API de consulta y legacy

Se implementó `GET /audit`, paginado, con filtros, orden estable y roles `admin`/`supervisor`. El serializer distingue filas legacy y no inventa contexto ausente.

El runner incluía pruebas de consulta, acceso denegado y fila legacy, pero esas assertions estaban después del punto de fallo. No se consideran validadas E2E y el gate queda NO-GO.

## 8. Iteraciones

| Iteración | Resultado | Causa | Cleanup |
| --- | --- | --- | --- |
| 1 | FAIL unit | Idempotency key original en input de runtime safety | No runtime |
| 2 | FAIL runner | Variable `requestId` redeclarada | 0 containers/volumes/networks |
| 3 | FAIL E2E | `RBAC_DENIED.actorRole` null | 0 containers/volumes/networks |

La evidencia completa está en `evidence/phase-2-5-1/iteration-results.md`.

## 9. Tests y builds

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| Audit/context/runtime safety unit | 16/16 PASS | salida de iteración 2 |
| API typecheck | PASS | `api-typecheck.log` |
| API build | PASS | `api-build.log` |
| Web typecheck | PASS | `web-typecheck.log` |
| Web build | PASS con warnings existentes | `web-build.log` |
| 30 migraciones fresh | PASS | run `audit-v2-iter3-01/migrations.log` |
| Contracts | 12/12 PASS | salida run final |
| RBAC matrix | 70/70 PASS | salida run final |
| Audit/core E2E | FAIL | assertion actorRole |
| Repeatability | 0/3 PASS | límite de iteraciones |
| Regresión completa | NO EJECUTADA | gate focalizado falló primero |

## 10. Artifact y release

| Artifact | Commit declarado | BuildId | Digest | Estado |
| --- | --- | --- | --- | --- |
| API test | `66c54785f6d1...` | `0.1.0-66c54785f6d1-phase24-28fda8163e09` | `sha256:4dbdcca58212...` | dirty, no productivo |
| Web test | `66c54785f6d1...` | mismo | `sha256:94205827ec32...` | dirty, no productivo |

No se creó commit porque el changeset no pasó el gate y el worktree contiene dependencias no consolidadas de fases anteriores. No se construyó artifact limpio ni se ejecutó rollback final. No hubo push.

## 11. Reconciliación y seguridad

`audit-reconciliation.json` marca FAIL exclusivamente en `actorRole` para `RBAC_DENIED`; el run había validado los demás campos core antes de esa assertion. No se acepta como reconciliación completa. Los fallos no dejaron contenedores, redes o volúmenes. No se montaron sesiones, QR, proveedores externos ni datos operativos.

## 12. Archivos principales modificados

| Área | Archivos | Cambio |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, migración v2 | Campos e índices aditivos |
| Audit core | `audit.service.ts`, context, interceptor, controller, DTO/types | Contrato v2 central |
| HTTP/RBAC | middleware, `roles.guard.ts` | Propagación y rechazo persistente |
| Core | Caja, sales, purchases, inventory | Integración transaccional parcial |
| Sofía | governance/backups/runtime/feedback/retention/QR | Eliminación de bypasses directos |
| Harness | runner, core E2E, artifact builder | 30 migrations y validación de contrato |
| Governance | framework/report/checkpoint | Estado NO-GO trazable |

## 13. Riesgos y siguiente acción

1. Mover la hidratación del actor a middleware posterior a autenticación pero anterior a autorización, o pasar `actorRole` efectivo explícitamente desde `RolesGuard` mediante el contexto central.
2. Completar auditoría transaccional de recovery/reopen/reversal, Delivery y consumos/rechazos de inventario.
3. Ejecutar upgrade/restore/rollback y compatibilidad legacy real.
4. Ejecutar tres runs audit/core completos y regresión.
5. Crear changeset/commit limpio y artifact trazable solo después de PASS.

## 14. Decisión

**ENGINEERING PHASE 2.5.1: NO-GO**.

Phase 2.6 permanece bloqueada. DB operativa, producción y WhatsApp real permanecen intactos.
