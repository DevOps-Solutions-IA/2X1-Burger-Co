# Release rollback

- Severidad: HIGH o CRITICAL segun impacto.
- Diagnostico: comparar source, commit, buildId, digest y runtime.
- Decision: rollback solo a un digest previamente validado y schema-compatible.
- Accion: cambiar referencia inmutable; no reconstruir ni usar solo `latest`.
- Validacion: version, health/readiness, login y smoke read-only.
- Recovery: restaurar candidato solo despues de causa raiz y nueva validacion.
- Escalamiento: Release owner y modulo afectado.
- Evidencia: digest origen/destino, duracion y smoke.
