# Engineering Roadmap

## Estado de fases

| Fase | Nombre | Estado | Gate |
| --- | --- | --- | --- |
| 0 | Engineering Framework | COMPLETA | GO |
| 1 | Global Audit | COMPLETA | GO documental |
| 2 | Core Remediation | EN PROGRESO | 2.6 GO CONDICIONADO local; release remoto y performance pendientes |
| 3 | Business Rules | PENDIENTE | BLOQUEADA |
| 4 | Performance | PENDIENTE | BLOQUEADA |
| 5 | Security | PENDIENTE | BLOQUEADA |
| 6 | UX/UI Premium | PENDIENTE | BLOQUEADA |
| 7 | Regression | PENDIENTE | BLOQUEADA |
| 8 | Production Readiness | PENDIENTE | BLOQUEADA |
| 9 | Production | PENDIENTE | BLOQUEADA |

## Production Closure - Source/Artifact/Runtime Convergence

Estado: **NO-GO INTERNO (2026-07-29)**.

Completado en source aislado:

- contratos 157/157;
- migraciones fresh 32/32 y upgrade 30→32;
- manifest versionado, `/version`, liveness y readiness exacta/fail-closed;
- safety, typecheck, lint, build y scans.

Bloqueadores:

- working tree con cambios previos mixed/owner que no pueden incluirse en un commit minimo automaticamente;
- ausencia total de remote y CI verificable;
- artifact/canary actual siguen en 30 migraciones;
- aislamiento invalidado por una conexion diagnostica read-only heredada al runtime de 29 migraciones.

No promover ni crear artifact de release hasta resolver estos bloqueadores con un changeset limpio y repetir el gate completo.

## Phase 2 - Orden ejecutable

### Bloque 2.1 - P0 Release Foundation & Runtime Provenance

Objetivo: separar cambios, crear artifacts inmutables, vincular source/commit/artifact/runtime y desplegar el parser seguro de flags mediante staging/canary con rollback.

Desbloquea: Deployment, Security, WhatsApp, Sofia, API, Frontend, Testing y evidencia runtime del resto.

Estado: **GO CONDICIONADO (2026-07-13)**.

Completado local/canary:

- changesets y commits separados por dominio;
- manifest comun API/web;
- `/version` sanitizado;
- OCI labels, digests y SBOM;
- CI y pipeline staging implementados;
- canary aislado;
- parser seguro y timeout WhatsApp consolidados;
- smoke con cinco controles efectivos OFF;
- rollback por digest PASS.

Pendiente owner gate: remote, registry, protections, approvals, secret store, Buildx y staging remoto.

### Bloque 2.2 - P0 Runtime Safety Gates

Objetivo: demostrar flags efectivos OFF, send blocking, pause, PAID blocking, QR/allowlist y kill switches sobre el artifact trazable.

Estado: **GO CONDICIONADO (2026-07-13)**.

Completado local/canary:

- cinco controles efectivos OFF y cero envio externo;
- pause y kill switch persistentes con precedencia demostrada;
- allowlist sintetica fail-closed y telefonos sanitizados;
- PAID/pagos/caja/ventas sin side effects;
- sandbox, validacion interna y real reconciliados;
- dedup inbound/outbound probado;
- QR/adapter honestos sin sesion real;
- DeepSeek dry-run con proveedor externo OFF;
- UI/API/DB/auditoria consistentes;
- artifact final trazable y rollback por digest PASS.

Pendiente owner gate: QR fisico, allowlist comercial, staging remoto, security owner y approvals.

### Bloque 2.3 - P1 Ephemeral Test Platform

Objetivo: DB efimera por run, E2E obligatorio no destructivo y matriz de contratos/RBAC.

Estado: **GO CONDICIONADO (2026-07-14)**.

Completado localmente:

- comando único con DB guard fail-closed, red, volumen y puertos por run;
- 29 migraciones desde cero y seed determinista;
- API/web desde artifacts del mismo HEAD;
- 12 contratos runtime y 249 handlers con política RBAC clasificada;
- 70 decisiones RBAC runtime y 54 escenarios backend;
- smokes base de Caja, POS, Delivery e Inventory;
- Playwright desktop/mobile 5/5;
- 3 runs finales consecutivos y 2 paralelos PASS;
- inyección de fallo con teardown a cero;
- job CI `ephemeral-e2e` preparado.

Pendiente owner gate: remote, protections y activación del job como required check.

### Bloque 2.4 - P1 Recovery & Observability

Objetivo: backups cifrados, restore drill, RTO/RPO, metrics, tracing, SLO y alertas.

Estado: **GO CONDICIONADO (2026-07-14)**.

Completado localmente:

- backup PostgreSQL custom, comprimido, cifrado y validado;
- restore sobre segunda DB efimera y reconciliacion logica completa 3X;
- aplicacion API/web arrancada y smokes read-only sobre el restore;
- RPO controlado 0 s y RTO promedio 11.729 s medidos;
- liveness/readiness honestos y migration compatibility;
- logging estructurado, metrics de baja cardinalidad y trace propagation local;
- SLO, alert catalog y 13 runbooks;
- fallos de DB, backup corrupto, migracion incompatible, restart y SIGTERM probados;
- job CI `recovery-drill` preparado.

Pendiente owner gate: offsite, WAL archive, KMS/secret store, monitoring/tracing backend, alert channel, owners, staging remoto y approvals.

### Bloque 2.5 - P2 Core Operational E2E

Objetivo: Caja, POS, Delivery e Inventory de punta a punta con rollback e idempotencia.

Estado: **NO-GO (2026-07-14)**.

Completado localmente:

- Caja, POS, Delivery e Inventory E2E mutante sobre DB efimera;
- recovery/reopen/reprint, stock, totales y PDFs reconciliados;
- locks transaccionales eliminan doble reapertura de Caja y pedidos;
- concurrencia e idempotencia pasan en rutas criticas;
- tres runs finales completos PASS con teardown a cero;
- regresion API 156/156 y Playwright 6/6 PASS;
- failure injection y rollback de operaciones invalidas PASS.

Bloqueador interno:

- `AuditLog` no persiste universalmente role, requestId, correlationId e idempotency key; el gate exige esa trazabilidad antes de declarar AUDIT GO.

Pendiente externo:

- required CI, staging remoto, impresión física y approvals.

### Bloque 2.6 - P3 Typed Frontend & UI Quality

Objetivo: eliminar warnings/any por criticidad, activar lint blocking y validar visual/a11y/mobile.

Estado: **GO CONDICIONADO LOCAL (2026-07-27)**.

Completado:

- frontend y API sin warnings en lint estricto activo;
- contratos runtime tipados en superficies criticas;
- dependency audit productivo sin vulnerabilidades conocidas;
- WCAG A/AA automatizado, keyboard scroll regions y contraste corregidos;
- Dashboard, Caja, POS, Delivery, Inventory, Users y Sofia validados en desktop;
- Dashboard/login validados en mobile sin overflow;
- tres E2E efimeros consecutivos con contratos, RBAC, core mutante, audit, UI y teardown PASS;
- imagenes OCI de prueba no-root con mismo buildId y huella de source.

Pendiente:

- consolidar changesets y crear artifact `dirtyBuild=false` con autorizacion;
- required CI, staging remoto y visual gate remoto;
- incorporar 64 specs E2E historicos al proyecto typed/lint;
- performance/load/soak y backend persistente de observabilidad.

### Bloque 2.7 - Runtime Promotion, Performance & Owner Gates

Objetivo: convertir el candidato local en release limpio, ejecutar capacidad/soak, promover por digest a staging remoto y cerrar custodia/approvals sin tocar produccion antes del gate formal.

Estado: **SIGUIENTE BLOQUE**.

### Bloque Sofia-P1 - Privacy, Legacy Isolation & Clean Candidate

Objetivo: migrar PII legacy, introducir actor de sistema, retirar o restringir WhatsApp legacy y certificar un artifact limpio sin habilitar envio real.

Estado: **BLOQUEADOR INTERNO DE PRODUCCION (2026-07-27)**.

Completado:

- prompt V2, catalogo persistido y DeepSeek text-only dry-run;
- CRM read-only con identidad HMAC y campaigns blocked;
- QR governance, payment gate, exact location correlation y dedup deterministico;
- UI desktop/mobile, contratos y pruebas focalizadas.

Pendiente:

- PII legacy/retention y actor de sistema;
- minimo privilegio de sesion/QR legacy;
- critical completa y artifact limpio trazable;
- owner gates fisicos/remotos.

### Bloque 2.5.1 - Persistent Audit Contract Remediation

Estado: **NO-GO (2026-07-14)**.

Implementado y validado parcialmente:

- schema aditivo y migracion 30 desde cero;
- contrato v2 tipado, contexto ALS y redaccion central;
- actor/request/correlation/trace/idempotency/before-after/result-reason en flujos ejecutados;
- API de consulta protegida y compatibilidad legacy diseñada;
- bypasses directos de Sofía eliminados;
- auditoria transaccional incorporada en mutaciones principales de Caja, ventas, compras e inventario;
- unit tests 16/16 y builds/typechecks PASS.

Bloqueador reproducido en la tercera iteracion:

- `RBAC_DENIED` persiste sin `actorRole` porque `RolesGuard` corre antes de `AuditContextInterceptor`.
- 0/3 runs completos PASS; migracion incremental, rollback y release limpio no alcanzaron gate.

La remediación del rol se ejecutó en 2.5.1-R1; Phase 2.6 no inicia hasta cerrar recovery y release.

### Bloque 2.5.1-R1 - Persistent Audit Role Remediation

Estado: **NO-GO (2026-07-15)**.

Completado:

- `actorRole` de `RBAC_DENIED` proviene del principal autenticado;
- contexto ALS aislado y no falsificable por headers;
- auditoria transaccional ampliada a recovery, Delivery e Inventory;
- fresh 30 y upgrade 29→30 PASS;
- legacy/query/reconciliation PASS;
- audit/core 3X, Delivery 11/11 y critical 91/91 PASS;
- artifact dirty de test con smoke PASS;
- DB operativa, producción y WhatsApp real intactos.

Bloqueadores internos tras tres iteraciones:

- `infra/recovery/restore-smoke.mjs` conserva assert hardcoded de 29 migraciones;
- working tree mezclado impide commit limpio de R1;
- no existe artifact limpio ni rollback por digest del candidato.

Siguiente acción permitida: fase corta de consolidación del test/release harness y separación de changesets. Phase 2.6 permanece bloqueada.

### Bloque 2.5.1-R2 - Recovery & Clean Release Closure

Estado: **GO CONDICIONADO (2026-07-15)**.

Completado local/canary:

- expectativa de schema dinámica con fingerprint y compatibilidad futura;
- recovery cifrado, restore, reconciliación y readiness 3X;
- upgrade 29→30 y legacy v1;
- changesets/commits limpios por dominio;
- regresión core/API 3X con 156/156 tests por run;
- artifact limpio `dirtyBuild=false`, OCI no-root y SBOM;
- identidad source/commit/artifact/runtime en canary;
- rollback y restauración por digest sin rebuild.

Pendiente owner gate: remote, registry, required CI, staging remoto, approvals, KMS/secret store y attestation. Phase 2.6 puede iniciar sin activar producción.

## Fases posteriores

### Phase 3 - Business Rules

Formalizar y congelar invariantes solo despues de artifacts y E2E confiables.

### Phase 4 - Performance

Medir SLO/capacidad/concurrencia sobre runtime versionado.

### Phase 5 - Security

Cerrar hardening, secrets, CSP, RBAC, exposure y threat model.

### Phase 6 - UX/UI Premium

Mejorar experiencia sobre contratos reales y estables.

### Phase 7 - Regression

Ejecutar regresion transversal required.

### Phase 8 - Production Readiness

Validar deployment, observabilidad, recovery, rollback y runbooks.

### Phase 9 - Production

Exposicion progresiva solo tras GO explicito de Phase 8.
