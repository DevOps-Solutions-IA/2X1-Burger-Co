# WhatsApp incident

- Severidad: CRITICAL ante envio no autorizado o PAID; HIGH ante degradacion.
- Accion inmediata: kill switch, pause, real send OFF y Auto Reply/Auto Safe OFF.
- Diagnostico: revisar adapter, dedup, timeout, allowlist y eventos sanitizados.
- Prohibido: imprimir telefono, QR, session auth o payload completo.
- Recovery: mantener receive-only; reactivar solo con security owner.
- Validacion: flags efectivos false, SENT=0, PAID=0 y dedup PASS.
- Escalamiento: Security owner y WhatsApp owner.
- Evidencia: phoneMasked, requestId, reason y counts.

