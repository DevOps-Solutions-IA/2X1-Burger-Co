# Phase 2.1 - Release Foundation & Runtime Provenance

## 1. Resumen ejecutivo

Phase 2.1 cierra `GO CONDICIONADO`. Se separaron los cambios por dominio en once commits locales, se construyo una identidad comun API/web, se agregaron endpoints `/version`, labels OCI, SBOM, CI, CD de staging, canary aislado y rollback por digest. El canary demuestra `SOURCE = COMMIT = ARTIFACT = RUNTIME` y los cinco controles criticos en `false`.

No se modifico produccion ni el runtime operativo anterior. Faltan remote, registry, protections, approvals, secret store, Buildx y staging remoto; por eso Deployment permanece AMARILLO y Production Readiness es `NOT READY`.

## 2. Snapshot inicial

- Branch inicial: `master`.
- HEAD inicial: `900449425e11e3d9305cb9677192c69a12ee8456`.
- Remotes/tags: ninguno.
- Runtime inicial: imagenes mutables sin commit/build visible.
- Auto Safe inicial efectivo: `true` pese a flag declarado `false`.
- Backups no destructivos: `/tmp/phase-2-1-release-foundation/`.
- Checkpoint: `.engineering/checkpoints/phase-2-1-before.md`.

## 3. Working tree y changesets

La clasificacion completa esta en `.engineering/reports/phase-2-1-working-tree-classification.md`. Los reportes historicos y tareas locales no relacionados permanecen fuera de los commits. No se uso reset, clean, checkout destructivo ni descarte.

| Changeset | Commit | Archivos | Validacion | Estado |
| --- | --- | --- | --- | --- |
| Engineering governance | `63be198` | `.engineering/**` inicial | Secret scan | PASS |
| Delivery follow-up | `e517b6b` | Hunk Delivery del critical spec | Delivery 11/11, typecheck | PASS |
| Config safety | `e886c42` | Parser estricto de env | Config 2/2 | PASS |
| Test harness | `5ffcc7e` | Setup e integracion segura | Critical 91/91 | PASS |
| WhatsApp timeout | `811289f` | Lifecycle timeout + tests | 3/3 timeout, Delivery | PASS |
| Sofia backend | `67dfeb0` | Backend supervisado | Sofia critical 11/11 | PASS |
| Sofia frontend | `72a92a1` | UI Sofia | Web typecheck/build | PASS condicionado warnings |
| Release foundation | `e35b9a7` | Manifest, OCI, CI/CD, canary | Builds, contracts, critical | PASS |
| Migration tracking | `0d50d31` | 29 `migration.sql` | Prisma validate, canary migrate | PASS |
| Canary contract | `e2bffe9` | Smoke safety real | Smoke iteracion 3 | PASS |
| Engineering closure | Este changeset | Framework, evidencia, reporte y checkpoint | Consistencia y secret scan | PASS |

## 4. Archivos sin commit

Permanecen fuera del release candidate:

- `.agents/tasks/prd-sofia-ultra-premium.json`;
- `.claude/scheduled_tasks.lock`;
- reportes historicos Delivery/Sofia/system-total no seleccionados;

La actualizacion final del framework se mantiene en un commit documental posterior al release candidate y no altera su identidad binaria.

## 5. Build metadata y release manifest

El manifest comun incluye application, version, commit completo/corto, timestamp reproducible, build ID, environment, API/schema compatibility, dirty flag y source identificador no sensible. Se genera desde `git archive`; un build dirty destinado a release no se presenta como limpio.

## 6. Endpoint de version

- API: `GET /version`.
- Web: `GET /version`.
- Ambos devuelven metadata sanitizada y el digest inyectado por el canary.
- Tests verifican contrato y ausencia de campos sensibles.

## 7. Artefactos, OCI y SBOM

| Artifact | Commit | BuildId | Digest | Estado |
| --- | --- | --- | --- | --- |
| API | `e2bffe97d76a` | `0.1.0-e2bffe97d76a-1783925108` | `sha256:049521e5468e1675ba4778b7edb2471b6598a8b6afb732373683e5350157e1cc` | PASS |
| Web | `e2bffe97d76a` | `0.1.0-e2bffe97d76a-1783925108` | `sha256:61f4862778f00f864eab10ceda1716ba0c994391da1c9db92b739686e2852fe6` | PASS |

- OCI labels: revision, created, version, title, source y description.
- Runtime user: `node` en ambas imagenes.
- SBOM: CycloneDX 1.5, 1074 componentes.
- Secret scan source: PASS.
- No se encontraron secretos en labels ni endpoint version.

## 8. Reproducibilidad

Dos builds consecutivos del commit `0d50d31` produjeron manifest, SBOM y digests identicos en el builder actual. Clasificacion: `BIT-REPRODUCIBLE_ON_CURRENT_BUILDER`. El candidato final conserva el mismo pipeline determinista, pero solo se construyo una vez despues del ultimo cambio de smoke; no se extiende la afirmacion bit-a-bit mas alla de la evidencia.

## 9. CI

El workflow incluye install frozen, secret scan, PostgreSQL efimero, migraciones, lint con budget visible de 88 warnings, typechecks/builds, config/version/timeout/Delivery/critical, SBOM y artifact build. E2E destructivo no fue convertido en required.

## 10. CD staging

El placeholder fue reemplazado por un pipeline con trigger controlado, environment approval, artifact por digest, backup hook, deploy, smoke, safety checks y rollback. No se inventaron credenciales ni se ejecuto contra infraestructura inexistente.

## 11. Canary local

- API: `127.0.0.1:4400`.
- Web: `127.0.0.1:3401`.
- PostgreSQL aislado: `127.0.0.1:55433`.
- 29 migraciones aplicadas.
- Sesiones WhatsApp operativas no montadas.
- Baileys/QR no se inicia.
- Produccion, send, Auto Reply, Auto Safe y PAID permanecen bloqueados.

## 12. Runtime provenance

| Runtime | Commit | BuildId | Artifact | Coincide |
| --- | --- | --- | --- | --- |
| Canary API | `e2bffe97d76a` | `0.1.0-e2bffe97d76a-1783925108` | API digest final | SI |
| Canary web | `e2bffe97d76a` | `0.1.0-e2bffe97d76a-1783925108` | Web digest final | SI |
| Operativo anterior | No expuesto | No expuesto | Imagen mutable previa | NO DEMOSTRADO; no modificado |

## 13. Safety hotfix

| Flag | Declarado | Efectivo API | UI/summary | Comportamiento | Estado |
| --- | --- | --- | --- | --- | --- |
| Real send | `false` | `false` | bloqueado | QR/send deshabilitado | PASS |
| Auto Reply | `false` | `false` | OFF | no responde | PASS |
| Auto Safe | `false` | `false` | OFF | no auto-aprueba | PASS |
| Production | `false` | `false` | bloqueada | no activa operacion | PASS |
| WhatsApp PAID | contrato fijo seguro | `false` | bloqueado | no marca PAID | PASS |

El parser cubre `true`, `false`, `1`, `0`, mayusculas, invalido, undefined y vacio con politica fail-safe.

## 14. WhatsApp timeout

El timeout perdedor se cancela en `finally`, no deja handles, no cambia el resultado, no duplica ni crea retries infinitos y conserva errores sanitizados. Tests: 3/3 PASS; Delivery y critical tambien PASS sin `forceExit`.

## 15. Smoke artifact

| Test | Resultado | Exit | Evidencia |
| --- | --- | ---: | --- |
| API/web version | Identidad comun | 0 | `final-canary-smoke.json` |
| API/DB health | `ok` | 0 | `final-canary-smoke.json` |
| Login web | PASS | 0 | `final-canary-smoke.json` |
| Caja/Delivery read-only | PASS | 0 | `final-canary-smoke.json` |
| Sofia safety | 5 controles false | 0 | `final-canary-smoke.json` |
| QR | DISABLED/disconnected honesto | 0 | `final-canary-smoke.json` |
| IA | deepseek/dry_run, externo disabled | 0 | `final-canary-smoke.json` |

El smoke requirio tres iteraciones: la primera descubrio rutas de contrato obsoletas; la segunda valido los flags; la tercera agrego y valido el contrato IA. No se oculto el fallo inicial.

## 16. Rollback

| Rollback | Desde | Hacia | Duracion | Estado |
| --- | --- | --- | ---: | --- |
| Despliegue candidato | baseline | candidato | 23 s | PASS |
| Rollback | candidato | baseline | 24 s | PASS |
| Restauracion | baseline | candidato | 23 s | PASS |

No hubo rebuild ni rollback de DB. El canary termino nuevamente en el candidato.

## 17. Seguridad

- Secret scan: PASS, sin imprimir valores.
- Imagenes como usuario no root: PASS.
- Endpoint version sanitizado: PASS.
- Filesystem/sesiones operativas aisladas: PASS.
- 2 vulnerabilidades moderadas web: PENDIENTE.
- CSP/headers, secret store y protections: PENDIENTE.

## 18. Builds y tests

- API typecheck/build: PASS.
- Web typecheck/build: PASS con 88 warnings conocidos.
- Focalizados: 4 suites, 20/20 PASS en DB efimera separada.
- Critical: 91/91 PASS en 336.439 s.
- Delivery: 11/11 PASS.
- No `forceExit`, no `process.exit`, no tests nuevos skipped.

## 19. Owner gates

| Owner Gate | Requerido | Disponible | Bloquea |
| --- | --- | --- | --- |
| Remote Git | SI | NO | Release remoto |
| Registry OCI | SI | NO | Artifact remoto |
| Branch protections/reviewers | SI | NO | Governance |
| Environment approvals | SI | NO | Staging |
| Secret store | SI | NO | Staging |
| Buildx | SI | NO | Builder sostenible |
| Staging remoto | SI | NO | Deployment VERDE |

## 20. Scores

| Modulo | Score antes | Score despues | Semaforo |
| --- | ---: | ---: | --- |
| Deployment | 31% | 68% | ROJO → AMARILLO |
| Security | 55% | 64% | ROJO → AMARILLO |
| API | 82% | 88% | AMARILLO |
| Frontend | 63% | 70% | AMARILLO |
| Testing | 69% | 80% | AMARILLO |
| WhatsApp | 58% | 67% | ROJO → AMARILLO |
| Sofia | 58% | 68% | ROJO → AMARILLO |

Enterprise Score: 66% → 72%. Production Readiness: 56% → 72%. Ningun modulo se elevo a VERDE.

## 21. Riesgos y decision

La release foundation local/canary es trazable y reversible. No es una release productiva: faltan gates externos, E2E UI, performance/observabilidad, hardening security y validacion fisica final WhatsApp/Sofia. Decision: `GO CONDICIONADO`.

Siguiente bloque: `Phase 2.2 - P0 Runtime Safety Gates`.
