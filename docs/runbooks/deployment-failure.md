# Deployment failure

- Severidad: HIGH; CRITICAL si hay corrupcion o indisponibilidad.
- Diagnostico: comparar manifest, labels OCI, digest, health y migration compatibility.
- Accion: detener rollout/canary; no aplicar migracion destructiva.
- Rollback: ejecutar `release-rollback.md` por digest.
- Validacion: source=commit=artifact=runtime, readiness y smokes.
- Escalamiento: Release owner y modulo afectado.
- Evidencia: workflow, digest, buildId, logs y tiempos.

