# Enterprise Program Execution

## Objetivo

Cerrar los 16 modulos con evidencia actual de source, tests, artifact, runtime, operacion, seguridad, recovery y UX. El programa no considera una funcionalidad completa por existir en codigo o por compilar.

## Modelo de ejecucion

Cada bloque usa un loop maximo de tres iteraciones:

```text
DISCOVERY -> ROOT CAUSE -> DESIGN -> IMPLEMENTATION -> STATIC VALIDATION
-> E2E/RUNTIME VALIDATION -> SECURITY/REGRESSION -> INDEPENDENT REVIEW
-> SCORE UPDATE
```

Un fallo repite el bloque. Al tercer fallo se registra `NO-GO` con causa reproducible. Ningun bloque dependiente avanza con un gate critico abierto.

## Orden de cierre

| Orden | Bloque | Modulos principales | Gate de salida |
| ---: | --- | --- | --- |
| 0 | Baseline y gobierno | Todos | Fuente de verdad reconciliada y cambios preservados |
| 1 | Release y seguridad P0 | Deployment, Security, Database, Testing | CI/CD, provenance, secrets, recovery y vulnerabilidades controlados |
| 2 | Typed Frontend y UI Quality | Frontend, UI/UX, Dashboard | Cero warnings bloqueantes, contratos tipados, a11y y E2E mutante |
| 3 | Identidad y operacion core | Users, Caja, POS, Delivery, Inventory, API | UI/API/DB/audit exactly-once sobre staging |
| 4 | Sofia y WhatsApp supervisados | Sofia, WhatsApp | Receive-only, dry-run, sandbox aislado, QR/allowlist honestos y `SENT=0` |
| 5 | Performance y observabilidad | Performance, Dashboard, Deployment | Load/soak, SLO, tracing, alerting y capacity plan |
| 6 | Certificacion global | Todos | 16/16 verdes, tres regresiones y rollback |
| 7 | Rollout productivo | Todos | Aprobaciones humanas, canary, reconciliacion y rollback disponible |

## Reglas de integracion

- Worktree y changeset por dominio; los archivos compartidos son propiedad del integrador.
- Ningun autor valida su propio gate final.
- No se permiten commits mezclados, secretos, datos operativos ni migrations destructivas.
- Los cambios de schema siguen expandir, migrar, verificar y contraer.
- Delivery Phase A y Maxy Family no cambian sin una fase aprobada.
- Sofia se certifica en su contrato vigente: supervisada, receive-only y DeepSeek dry-run. Envio saliente, Auto Reply, Auto Safe y PAID permanecen OFF.

## Gate verde por modulo

Un modulo requiere score 90-100, cero bloqueadores criticos, source/test/runtime/operational PASS, artifact remoto trazable, observabilidad suficiente, rollback y evidencia E2E/UI cuando aplique. Un owner gate ausente mantiene el modulo amarillo.

## Stop conditions

- Diferencia financiera, stock inconsistente o evento de auditoria ausente.
- Secreto, PII completa, QR raw o session auth expuestos.
- Drift entre source, commit, artifact y runtime.
- Readiness falsa, rollback fallido o backup no restaurable.
- Envio WhatsApp, Auto Reply, Auto Safe, PAID o produccion activados sin gate.

