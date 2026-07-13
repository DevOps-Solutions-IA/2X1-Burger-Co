# Engineering Roadmap

## Estado de fases

| Fase | Nombre | Estado | Gate |
| --- | --- | --- | --- |
| 0 | Engineering Framework | COMPLETA | GO |
| 1 | Global Audit | COMPLETA | GO documental |
| 2 | Core Remediation | PLANIFICADA | NO INICIADA |
| 3 | Business Rules | PENDIENTE | BLOQUEADA |
| 4 | Performance | PENDIENTE | BLOQUEADA |
| 5 | Security | PENDIENTE | BLOQUEADA |
| 6 | UX/UI Premium | PENDIENTE | BLOQUEADA |
| 7 | Regression | PENDIENTE | BLOQUEADA |
| 8 | Production Readiness | PENDIENTE | BLOQUEADA |
| 9 | Production | PENDIENTE | BLOQUEADA |

## Phase 2 - Orden ejecutable

### Bloque 2.1 - P0 Release Foundation & Runtime Provenance

Objetivo: separar cambios, crear artifacts inmutables, vincular source/commit/artifact/runtime y desplegar el parser seguro de flags mediante staging/canary con rollback.

Desbloquea: Deployment, Security, WhatsApp, Sofia, API, Frontend, Testing y evidencia runtime del resto.

### Bloque 2.2 - P0 Runtime Safety Gates

Objetivo: demostrar flags efectivos OFF, send blocking, pause, PAID blocking, QR/allowlist y kill switches sobre el artifact trazable.

### Bloque 2.3 - P1 Ephemeral Test Platform

Objetivo: DB efimera por run, E2E obligatorio no destructivo y matriz de contratos/RBAC.

### Bloque 2.4 - P1 Recovery & Observability

Objetivo: backups cifrados, restore drill, RTO/RPO, metrics, tracing, SLO y alertas.

### Bloque 2.5 - P2 Core Operational E2E

Objetivo: Caja, POS, Delivery e Inventory de punta a punta con rollback e idempotencia.

### Bloque 2.6 - P3 Typed Frontend & UI Quality

Objetivo: eliminar warnings/any por criticidad, activar lint blocking y validar visual/a11y/mobile.

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
