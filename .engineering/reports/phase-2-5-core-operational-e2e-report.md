# Phase 2.5 - Core Operational E2E Report

Fecha: 2026-07-14 (America/Bogota)

## 1. Resumen ejecutivo

Se construyó y ejecutó una suite operacional mutante sobre PostgreSQL efímero para Caja, POS, Delivery e Inventario. Los flujos, contratos, RBAC, PDFs, concurrencia, rollback y UI pasan de forma repetible. Durante el loop se reprodujeron dos carreras reales: reapertura concurrente de Caja y reapertura concurrente de pedidos. Ambas se corrigieron con serialización transaccional y revalidación posterior al lock.

La decisión global es **NO-GO**. No existe fallo funcional en los cuatro flujos, pero el gate solicitado exige que cada operación persista actor, rol, requestId, correlationId, idempotency key, before/after, resultado y timestamp. El schema actual de `AuditLog` no persiste universalmente rol, requestId, correlationId ni idempotency key. Los IDs de request/correlation sí aparecen en logs estructurados, pero eso no satisface el contrato persistente solicitado.

## 2. Snapshot y aislamiento

| Control | Resultado | Evidencia |
| --- | --- | --- |
| HEAD | `66c54785f6d1383e40f28e66dd825a4db11d6a44` | `checkpoints/phase-2-5-before.md` |
| Artifact API | `sha256:6caee5e66b8e...` | `evidence/phase-2-5/artifact-record.json` |
| Artifact web | `sha256:22f36beab5d7...` | `evidence/phase-2-5/artifact-record.json` |
| Build ID | `0.1.0-66c54785f6d1-phase24-fcd7e2335240` | artifact record |
| Dirty/eligible | `dirtyBuild=true`, `productionEligible=false` | artifact record |
| DB operativa | No tocada | todos los `run-summary.json` |
| Producción | No modificada | todos los `run-summary.json` |
| WhatsApp real | OFF | runtime safety y summaries |
| Recursos finales | 0 containers, 0 volumes, 0 networks | `final-resource-scan.log` |

Cada run creó DB, red, volumen y puertos propios, aplicó 29 migraciones, cargó seed determinista y destruyó todos los recursos.

## 3. Invariantes y fixtures

Las invariantes auditadas están versionadas en `phase-2-5-business-invariants.md`. Los datos usados son exclusivamente sintéticos: roles de prueba, productos seed, caja efímera, órdenes, ventas, delivery, compras, ajustes y ubicaciones sintéticas.

## 4. Caja E2E

| Escenario | Resultado | Reconciliación |
| --- | --- | --- |
| Cierre concurrente | PASS | exactamente 1 respuesta exitosa y 1 movimiento `CLOSING` |
| Reapertura concurrente | PASS | exactamente 1 nueva sesión OPEN |
| Segundo open/reopen | Bloqueado | respuesta 400/409 sin side effects |
| Movimiento manual | PASS | persistido en sesión reabierta |
| UI | PASS | estado Activa y reapertura visibles |

Causa raíz corregida: `open()` y `reopen()` hacían check-then-write sin exclusión mutua. Se añadió advisory lock transaccional y relectura dentro de la transacción.

## 5. POS E2E

| Escenario | Resultado | Evidencia |
| --- | --- | --- |
| Venta y total | PASS | total igual al precio seed |
| Stock | PASS | descuento exacto por venta |
| Receipt/reprint | PASS | PDF válido y cero mutaciones |
| Recovery concurrente | PASS | una conversión y una reversa |
| Reopen converted concurrente | PASS | una reapertura |
| Reopen directo concurrente | PASS | una reapertura y una reversa de caja |
| Stock insuficiente | PASS | 400 y fingerprint DB sin cambios |

Causa raíz corregida: dos reaperturas podían leer estado `PAID` simultáneamente y aplicar doble reversa. Se añadió `SELECT ... FOR UPDATE` y revalidación dentro de la transacción en ambos servicios.

El PDF POS es semánticamente determinístico. El hash binario cambia porque incluye metadata temporal de generación; la suite compara texto normalizado y confirma ausencia de side effects.

## 6. Delivery E2E

| Escenario | Resultado | Evidencia |
| --- | --- | --- |
| Cuenta inicial | PASS | `CUENTA DE DOMICILIO`, versión 1, vigente |
| Cambio comercial | PASS | versión 2 y total vigente |
| No-op | PASS | no incrementa revisión comercial |
| Stale revision concurrente | PASS | un update y un conflicto |
| Ubicación | PASS | lat/lng guardados, pricing y versión conservados |
| Historial | PASS | versiones inicial/actualizada |
| Maxy Family | PASS | copy requerido exacto leído del catálogo |
| UI/PDF | PASS | versión 2, ubicación confirmada, mapa y PDF real |

La tarifa persistida observada en el fixture fue COP 0 por la política efectiva del seed; no se inventó una tarifa. Se comprobó que permanece idéntica antes/después del cambio y de la ubicación.

## 7. Inventario E2E

| Escenario | Resultado | Reconciliación |
| --- | --- | --- |
| Compra | PASS | +3 unidades y movimiento PURCHASE |
| Ajustes concurrentes | PASS | dos movimientos, saldo final +2 |
| Stock negativo | PASS | operación rechazada y DB intacta |
| Conteo | PASS | stock final igual al conteo |
| UI | PASS | métricas y movimientos visibles |

## 8. RBAC

Los contratos runtime cubrieron 10 endpoints y 70 decisiones de rol. Los intentos no autorizados de reabrir Caja, ajustar Inventario y crear Compras devolvieron 403 y no alteraron el fingerprint operacional.

## 9. Auditoría

| Campo requerido | Estado | Fuente |
| --- | --- | --- |
| actor | PASS | AuditLog |
| action/module/entity | PASS | AuditLog |
| before/after/reason | PASS parcial | AuditLog por operación |
| timestamp | PASS | AuditLog |
| requestId/correlationId | CONDICIONADO | logs estructurados, no universalmente en AuditLog |
| role | FAIL | no universal en AuditLog |
| idempotency key | FAIL | no universal en AuditLog |
| result | PASS parcial | evento/estado, no contrato universal |

Este hallazgo bloquea `AUDIT: GO` y, por regla explícita de la fase, fuerza `PHASE 2.5: NO-GO`.

## 10. Reconciliación

`evidence/phase-2-5/core-reconciliation.json` conserva baseline/final de sales, orders, cash sessions/movements, inventory movements, purchases y audits. Además valida:

- una sola caja abierta;
- reversas exactly-once;
- paid sales y total de items;
- versión Delivery activa y total persistido;
- stock final y movimientos;
- cero cambio en DB operativa/producción.

## 11. Failure injection

- Venta con stock insuficiente: rollback atómico PASS.
- Ajuste que produciría stock negativo: rollback atómico PASS.
- Requests concurrentes/stale: un ganador y un rechazo PASS.
- Fallo inyectado `after-runtime`: exit 71 esperado, teardown de container/volume/network a cero PASS.
- Reinicio de API durante una transacción no se inyectó en esta fase; permanece como cobertura futura especializada.

## 12. UI y PDF

Playwright ejecutó 6/6 casos por run. La UI real mostró las mutaciones API en Caja, POS, Delivery e Inventario y no produjo respuestas 500. Se inspeccionaron cuatro screenshots. Hallazgos residuales:

- algunas métricas estrechas truncan o parten texto;
- el top rail recorta contenido secundario en viewport desktop;
- las mutaciones fueron realizadas por API real y verificadas en UI; no todas nacieron de interacción UI.

Esto mantiene Frontend/UIUX en AMARILLO.

## 13. Performance baseline

| Flujo | Rango observado 3X final |
| --- | ---: |
| Cash concurrent close | 99.39-106.15 ms |
| Cash concurrent reopen | 17.80-20.18 ms |
| POS checkout | 22.69-26.78 ms |
| POS receipt | 55.48-185.20 ms |
| POS recovery | 47.64-54.04 ms |
| POS reopen converted | 29.65-32.31 ms |
| Order direct reopen | 33.94-35.30 ms |
| Delivery commercial update | 54.14-55.55 ms |
| Delivery concurrent update | 58.67-59.39 ms |
| Inventory purchase | 21.93-27.03 ms |
| Inventory concurrent adjustments | 16.81-17.81 ms |

Es baseline local sintético, no capacidad productiva.

## 14. Repetibilidad

| Run | Migraciones | Contratos | RBAC | Playwright | Total | Cleanup |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| phase25-final1 | 29 | 12/12 | 70/70 | 6/6 | 49 s | 0/0/0 |
| phase25-final2 | 29 | 12/12 | 70/70 | 6/6 | 49 s | 0/0/0 |
| phase25-final3 | 29 | 12/12 | 70/70 | 6/6 | 50 s | 0/0/0 |

## 15. Regresión y builds

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `api-typecheck.log` |
| API build | PASS | `api-build.log` |
| Web build | PASS con 88 warnings conocidos | `web-build.log` |
| Web typecheck secuencial | PASS | `web-typecheck-sequential.log` |
| Web typecheck paralelo a build | FAIL de tooling | `.next/types` fue regenerado concurrentemente |
| Critical + RBAC + Delivery | PASS 156/156 | `phase25-regression/api-regression.log` |
| Secret scan | PASS | valores no impresos |
| Resource leak | PASS | 0/0/0 |

Build y typecheck web deben ejecutarse secuencialmente o con outputs aislados; compartir `.next` en paralelo no es seguro.

## 16. Archivos modificados

| Archivo | Cambio | Motivo |
| --- | --- | --- |
| `cash-register.service.ts` | advisory lock en open/reopen | evitar doble sesión concurrente |
| `sales.service.ts` | row lock en reopen converted | evitar doble reversa |
| `orders.service.ts` | row lock y revalidación en reopen | evitar doble reversa directa |
| `core-operational-e2e.mjs` | suite operacional/reconciliación | cubrir invariantes mutantes |
| `run-ephemeral-e2e.sh` | modo core y credenciales sintéticas | integrar suite al runner aislado |
| `core-operational-ui.spec.ts` | verificación UI y screenshots | evidencia visual real |
| `package.json` | comando `test:e2e:core` | ejecución estable |
| `.engineering/*` | evidencia, módulos, status, roadmap | gobernanza Phase 2.5 |

No se modificaron reglas comerciales, pricing, Sofía, WhatsApp, producción ni datos operativos.

## 17. Riesgos y decisión

Riesgos internos:

1. Auditoría persistente universal incompleta.
2. UI mutante integral pendiente.
3. Warnings/dependencias frontend.
4. Performance representativa pendiente.

Owner gates externos: required CI, staging remoto, impresión física, providers y approvals.

**ENGINEERING PHASE 2.5: NO-GO** por auditoría incompleta. Los subflujos Caja/POS/Delivery/Inventory son GO local; el sistema no queda production-ready.
