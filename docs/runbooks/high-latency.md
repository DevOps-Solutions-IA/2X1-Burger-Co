# High latency

- Severidad: HIGH si p95 >=1s por 5 minutos.
- Diagnostico: revisar p50/p95/p99, CPU, memoria, event loop, DB latency y traceId.
- Accion segura: reducir trafico/canary o retirar instancia degradada; no ocultar timeout.
- Rollback: digest previo si coincide con despliegue.
- Validacion: p95 <750ms durante 10 minutos y error rate estable.
- Escalamiento: API, Database o Frontend owner segun spans.
- Evidencia: ventana, release y trazas sanitizadas.

