# Catalogo de alertas

La evaluacion local existe; no hay canal remoto configurado. Cada alerta queda `READY / BLOCKED BY OWNER GATE` hasta asignar receptor.

| Alerta | Severidad | Condicion | Duracion | Owner | Canal | Recovery | Runbook |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API down | CRITICAL | liveness falla | inmediata | Infrastructure owner | Pendiente | liveness estable 5m | `api-down.md` |
| DB unavailable | CRITICAL | readiness DB false | inmediata | Database owner | Pendiente | readiness estable 5m | `database-down.md` |
| Migration incompatible | CRITICAL | applied != expected | inmediata | Release owner | Pendiente | artifact/schema compatibles | `deployment-failure.md` |
| Error rate alta | HIGH | >=5% | 5m | API owner | Pendiente | <2% 10m | `high-error-rate.md` |
| p95 degradado | HIGH | >=1s | 5m | API owner | Pendiente | <750ms 10m | `high-latency.md` |
| Backup invalido | HIGH | status != PASS | inmediata | Infrastructure owner | Pendiente | nuevo backup validado | `backup-failure.md` |
| Restore invalido | CRITICAL | reconciliacion false | inmediata | Database owner | Pendiente | drill completo PASS | `database-restore.md` |
| DB pool | HIGH | conexiones >=80 | 5m | Database owner | Pendiente | <60 10m | `database-down.md` |
| Memoria | HIGH | RSS >=1GiB | 10m | API owner | Pendiente | <800MiB 15m | `high-latency.md` |
| Real send inesperado | CRITICAL | efectivo true | inmediata | Security owner | Pendiente | false verificado | `sofia-unsafe-flag.md` |
| Auto Safe inesperado | CRITICAL | efectivo true | inmediata | Security owner | Pendiente | false verificado | `sofia-unsafe-flag.md` |
| Produccion inesperada | CRITICAL | efectivo true | inmediata | Security owner | Pendiente | false verificado | `sofia-unsafe-flag.md` |
| PAID por WhatsApp | CRITICAL | count >0 | inmediata | Finance/Security | Pendiente | incidente cerrado | `whatsapp-incident.md` |
