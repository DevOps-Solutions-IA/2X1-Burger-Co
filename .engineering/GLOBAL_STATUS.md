# GLOBAL STATUS

Fecha de evaluacion: 2026-07-15

| Modulo | Score | Semaforo | Bloqueadores | Estado runtime | Prioridad |
| --- | ---: | --- | ---: | --- | --- |
| Caja | 90% | 🟡 | 3 | PASS E2E/audit 3X; release NO-GO | P1 |
| POS | 90% | 🟡 | 3 | PASS E2E/audit 3X; release NO-GO | P1 |
| Delivery | 95% | 🟡 | 3 | PASS E2E/audit 3X; provider externo pendiente | P1 |
| WhatsApp | 83% | 🟡 | 3 | PASS canary seguro; canal real OFF | P1 |
| Sofia | 84% | 🟡 | 3 | PASS canary; owner gates pendientes | P1 |
| Dashboard | 80% | 🟡 | 3 | Snapshot operacional real; backend remoto pendiente | P1 |
| Inventory | 88% | 🟡 | 3 | PASS E2E/audit 3X; release NO-GO | P1 |
| Users | 82% | 🟡 | 3 | RBAC audit PASS; lifecycle remoto pendiente | P1 |
| Security | 79% | 🟡 | 4 | PASS local; artifact/KMS pendientes | P0 |
| Database | 93% | 🟡 | 3 | 30 fresh y 29→30 PASS; recovery smoke NO-GO | P1 |
| API | 96% | 🟡 | 3 | Audit/core PASS; release/recovery NO-GO | P1 |
| Frontend | 81% | 🟡 | 4 | PASS artifact/UI efimero | P1 |
| Deployment | 72% | 🟡 | 3 | PASS local/canary; remoto no demostrado | P0 |
| Performance | 65% | 🟡 | 3 | Baseline local; capacidad no demostrada | P1 |
| Testing | 94% | 🟡 | 4 | Audit/core 3X PASS; recovery 0/3 | P1 |
| UI/UX | 66% | 🟡 | 4 | Evidencia visual PASS; quality debt pendiente | P2 |

## Enterprise Score global

**84%**. No habilita produccion: el contrato v2 ya pasa, pero recovery agotó tres iteraciones y no existe artifact limpio con rollback demostrado.

## Production Readiness Score

**81%**. Estado: **NOT READY**.

## Distribucion

- ROJO: **0**.
- AMARILLO: **16**.
- VERDE: **0**.

## Top riesgos y bloqueadores

1. No hay remote, registry, protections, approvals ni staging remoto.
2. No hay storage offsite, WAL archive, KMS o secret store.
3. Monitoring/tracing backend y alert channel reales no estan configurados.
4. RPO/RTO productivos no estan aprobados ni medidos con volumen representativo.
5. Recovery harness conserva una expectativa hardcoded de 29 migraciones en `restore-smoke.mjs`.
6. QR, allowlist e inbound comercial requieren owner gate fisico.
7. Performance no tiene load/soak/capacity tests.
8. CSP y 2 vulnerabilidades moderadas web requieren hardening.
9. Jobs E2E/recovery/core no son required sin remote/protections.
10. Working tree mezclado impide un changeset/artefacto limpio de R1 sin contaminar dominios.

## Evidencia Phase 2.5.1-R1

- `RBAC_DENIED.actorRole` se hidrata desde el principal autenticado; spoofing por header rechazado.
- Cuatro denegaciones autenticadas y una no autenticada quedan persistidas sin side effects.
- Fresh 30 y upgrade 29→30, legacy, query API, transaccionalidad y reconciliación PASS.
- Tres runs audit/core consecutivos PASS con DB nueva y cleanup a cero.
- Delivery Phase A 11/11 y critical 91/91 PASS sin `forceExit`.
- Artifact test `0.1.0-66c54785f6d1-phase24-ca4d7b81adf5` pasa smoke, pero es `dirtyBuild=true` y no elegible para producción.
- Recovery agotó tres iteraciones por sucesivos hardcodes de migration count; rollback no demostrado.
- Scans: cero secretos/activaciones; cero recursos huérfanos; DB operativa/producción intactas y WhatsApp real OFF.

## Evidencia Phase 2.5

- Artifact local: `0.1.0-66c54785f6d1-phase24-fcd7e2335240`, `dirtyBuild=true`, `productionEligible=false`.
- Caja, POS, Delivery e Inventory pasan 3 runs finales sobre DB nueva: 49 s, 49 s y 50 s.
- Cada run aplico 29 migraciones, 12 contratos, 70 checks RBAC y 6 tests Playwright.
- Regresion API: 3 suites, 156/156 tests, 516.884 s, sin forceExit.
- Concurrencia exactly-once: cash close/reopen, recovery, reopen converted/direct, Delivery stale revision e Inventory adjustments.
- PDFs POS/Delivery extraidos y renderizados; contenido semantico correcto, hash binario variable por metadata temporal.
- Failure injection despues de runtime: exit 71 esperado y cleanup a cero.
- DB operativa y produccion intactas; WhatsApp real OFF.
- Bloqueador interno: contrato universal de auditoria incompleto.

## Evidencia Phase 2.5.1

- Schema y migracion aditiva v2 implementados; 30 migraciones desde cero PASS en DB efimera.
- Contexto ALS, redaccion central, API de consulta y eliminacion de bypasses directos implementados.
- Unit tests: 16/16 PASS; API/web typecheck y build PASS.
- E2E final: FAIL porque `RBAC_DENIED.actorRole` es null; causa raiz guard anterior al interceptor.
- Repetibilidad requerida: 0/3 runs PASS. No se creo commit ni artifact limpio.
- Cleanup: 0 contenedores, 0 volumenes, 0 redes; DB operativa y produccion intactas.

## Evidencia Phase 2.4

- Artifact de test: `0.1.0-66c54785f6d1-phase24-0799d8d57701`, productionEligible=false.
- Tres backups cifrados y tres restores finales PASS sobre DB aisladas.
- Reconciliacion exacta: 60 tablas, 240 indices, 29 migraciones, conteos, sumas e invariantes logicos.
- RPO observado controlado: 0 s. RTO promedio: 11.729 s.
- Liveness/readiness, DB failure, migration mismatch, restart y SIGTERM probados.
- HTTP/system/DB/recovery metrics disponibles; business metrics protegidas por RBAC.
- Trace/request/correlation IDs propagados a logs estructurados sanitizados.
- Runbooks, SLO y alert catalog creados; canales externos permanecen owner-gated.

## Deuda cuantificada

- 0 modulos ROJO, 16 AMARILLO, 0 VERDE.
- 7 owner gates externos principales y 1 bloqueador interno de auditoria.
- 88 warnings web y 2 vulnerabilidades moderadas runtime web.
- 0 remotes y 0 tags observados.
- 1 backend persistente de observabilidad pendiente.
- 1 estrategia offsite/WAL/KMS pendiente.
- 1 cobertura UI mutante completa pendiente.

## Release readiness

**NOT READY**. Phase 2.5.1-R1 es `NO-GO`: auditoría interna PASS, pero recovery/regresión, artifact limpio y rollback no cerraron. Offsite, KMS, alerting remoto, staging, approvals, UI mutante completa y capacidad siguen abiertos.
