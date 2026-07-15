# High error rate

- Severidad: HIGH; CRITICAL si afecta ventas, caja o pagos.
- Diagnostico: agrupar por status/errorClass/modulo, requestId y release; no guardar payloads.
- Accion segura: bloquear el flujo mutante afectado o retirar artifact.
- Rollback: digest anterior compatible si la regresion es de release.
- Validacion: error rate <2% durante 10 minutos y smoke del modulo.
- Escalamiento: owner del modulo y Security si hay autorizacion.
- Evidencia: conteos, causas y acciones.

