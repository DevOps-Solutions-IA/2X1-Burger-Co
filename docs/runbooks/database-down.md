# Database down

- Severidad: CRITICAL.
- Sintomas: liveness API activo, readiness 503 con `DATABASE_UNAVAILABLE`.
- Diagnostico: verificar proceso DB, disco, conexiones y migraciones sin imprimir URL.
- Accion segura: retirar API del trafico; detener writers/retries no idempotentes.
- Recovery: recuperar DB o restaurar en destino aislado con `database-restore.md`.
- Validacion: readiness, migration count, login y reconciliacion read-only.
- Escalamiento: Database owner e Infrastructure owner.
- Evidencia: timestamps, RTO, checksums y resultados sanitizados.

