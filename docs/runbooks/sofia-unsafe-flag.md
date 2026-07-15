# Sofia unsafe flag

- Severidad: CRITICAL.
- Sintomas: real send, Auto Reply, Auto Safe o produccion efectivos true sin gate.
- Accion inmediata: kill switch y pause; retirar instancia del trafico.
- Diagnostico: comparar valor declarado, parser, API, UI y artifact identity.
- Recovery: corregir configuracion en secret store; redeploy por digest aprobado.
- Validacion: cinco controles false, PAID bloqueado, SENT=0 y auditoria.
- Escalamiento: Security owner y Release owner.
- Evidencia: valores booleanos sanitizados, nunca `.env`.
