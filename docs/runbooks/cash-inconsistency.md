# Cash inconsistency

- Severidad: CRITICAL.
- Sintomas: apertura/cierre, pagos y ventas no reconcilian.
- Diagnostico: bloquear reapertura/recovery duplicado; consultar auditoria read-only.
- Prohibido: crear movimientos compensatorios sin autorizacion.
- Recovery: procedimiento financiero aprobado, idempotency key y doble revision.
- Validacion: sumas, estado de sesion, pagos y audit log.
- Escalamiento: Finance owner, Caja owner y Security.
- Evidencia: valores agregados y referencias sanitizadas.

