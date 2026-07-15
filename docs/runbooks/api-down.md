# API down

- Severidad: CRITICAL si liveness falla; HIGH si solo readiness falla.
- Sintomas: `/health/live` no responde o `/health/ready` devuelve 503.
- Diagnostico: registrar version/digest, estado del proceso, liveness, readiness y logs por requestId.
- Accion segura: retirar el artifact no-ready del trafico; no reconstruir durante rollback.
- Rollback: usar el digest anterior verificado siguiendo `release-rollback.md`.
- Validacion: liveness, readiness, login y smoke read-only estables durante 5 minutos.
- Escalamiento: Infrastructure owner y API owner.
- Evidencia: tiempos, digest, causa, traceId y resultado sin secretos.
