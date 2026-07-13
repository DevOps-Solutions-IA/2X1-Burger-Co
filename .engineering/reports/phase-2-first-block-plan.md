# Phase 2 - First Block Plan

## 1. Nombre del bloque

**Release Foundation & Runtime Provenance**, incluyendo el hotfix de parsing seguro de flags como primer artifact controlado.

## 2. Motivo de prioridad

Es el fundamento que desbloquea mas modulos. Hoy no puede demostrarse `SOURCE = COMMIT = ARTIFACT = RUNTIME`; el runtime activo contradice un flag de seguridad y el working tree mezcla dominios. Corregir funciones antes de resolver esta cadena produciria evidencia sobre versiones no confiables.

## 3. Modulos afectados

Directos: Deployment, Security, API, Frontend, Testing.  
Desbloqueados: WhatsApp, Sofia, Delivery, Dashboard, Caja, POS, Inventory, Users, Database, Performance y UI/UX.

## 4. Hallazgos concretos

- CD placeholder.
- Sin remote, tags ni protections verificables.
- API/web images con timestamps distintos y sin OCI labels de commit.
- Sin runtime version endpoint/build ID utilizable.
- Working tree mezclado con cambios Delivery/Sofia/testing/config.
- Runtime efectivo Auto Safe true con flag raw false.
- Rebuild directo desplegaria cambios no revisados.

## 5. Diseno objetivo

1. Cambios separados por dominio y revisados.
2. Commit release candidato identificable.
3. Build reproducible de API/web.
4. Imagenes inmutables por digest con labels de commit/build time/version.
5. SBOM y checks de seguridad.
6. Endpoint/status sanitizado de version.
7. Staging/canary antes de runtime operativo.
8. Smoke y contract gates sobre la imagen, no el workspace.
9. Rollback por digest probado.
10. CD con approval humano y evidencia automatica.

## 6. Plan de implementacion

1. Auditar y clasificar cada diff actual; no descartar cambios.
2. Separar hotfix de config/timeouts/test harness de Delivery y Sofia UI.
3. Configurar remote/branch strategy con owner.
4. Definir metadata de build comun API/web.
5. Agregar OCI labels, tags inmutables y SBOM.
6. Implementar endpoint de version sanitizado.
7. Crear workflow CI de artifact y CD staging con approval.
8. Desplegar canary del hotfix de flags.
9. Validar flags efectivos, health, contracts y UI.
10. Probar rollback al digest anterior.

## 7. Loops requeridos

Discovery -> Audit -> Architecture -> Implementation -> Validation -> Regression -> Security -> Production Readiness.

## 8. Archivos probables

- `.github/workflows/ci.yml`
- `.github/workflows/cd.yml`
- `infra/docker/Dockerfile.api`
- `infra/docker/Dockerfile.web`
- `docker-compose.yml` o manifests staging dedicados
- `infra/scripts/deploy.sh`
- `infra/scripts/smoke.sh`
- bootstrap/config API y metadata web
- tests de provenance/status
- runbook de release/rollback

No se presupone que todos requieran cambio; se confirmara en Phase 2.

## 9. Riesgos

- Mezclar cambios del working tree durante la separacion.
- Interrumpir QR/session state al reemplazar API.
- Exponer metadata o secretos en endpoint/labels.
- Rollback incompatible con schema.
- Configurar CD antes de protections/approvals.

## 10. Rollback

- No modificar schema en este bloque salvo gate separado.
- Conservar digest API/web anterior.
- Backup previo y health snapshot.
- Rollback atomico por digest.
- Revalidar health, auth, flags efectivos y QR state.
- Detener canary si cualquier gate de seguridad difiere.

## 11. Pruebas

- Reproducible build desde commit limpio.
- Verificacion de labels/SBOM/digest.
- Endpoint version sin secretos.
- API/web typecheck/build.
- Critical 91/91, Delivery 11/11, config/delivery 67/67.
- Smoke sobre artifact staging.
- Comparacion flags raw vs efectivos.
- UI read-only de Caja/Delivery/Sofia.
- Rollback drill por digest.

## 12. Criterio de GO

- `SOURCE = COMMIT = ARTIFACT = RUNTIME` demostrado para API y web.
- Working tree de release limpio o cambios fuera del artifact explicitamente excluidos.
- Parser seguro presente en runtime y Auto Safe efectivo false.
- CD staging con approval, evidence bundle y rollback probado.
- Ningun secreto en metadata/logs.
- Tests/builds requeridos PASS sobre el artifact.

## 13. Intervencion requerida del owner

- Proveer/configurar remote autorizado.
- Definir branch protection y reviewers.
- Aprobar separacion/commits del working tree.
- Proveer registry y entorno staging.
- Aprobar secrets store y credenciales de despliegue.
- Autorizar canary/restart de API/web.
- Coordinar custodia de sesion WhatsApp y ventana de rollback.

## Estado

**PLANIFICADO. NO EJECUTADO.** Phase 2 no fue iniciada.
