# Catalogo inicial SLI/SLO

Los objetivos son propuestas (`TARGET`), no SLO productivos aprobados. El baseline local es evidencia de instrumentacion, no de capacidad.

| Servicio | Indicador/formula | Ventana | Target propuesto | Fuente | Alerta | Owner | Runbook |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API | requests exitosos / total | 30 dias | 99.5% | HTTP metrics | error rate >= 5% 5m | Owner requerido | `api-down.md` |
| API | p95 de duracion | 5m/30 dias | < 1s | HTTP metrics | p95 >= 1s 5m | Owner requerido | `high-latency.md` |
| DB | readiness exitoso / checks | 30 dias | 99.9% | readiness | DB unavailable inmediato | Owner requerido | `database-down.md` |
| Caja | cierres reconciliados / cierres | 30 dias | 100% | auditoria/DB | diferencia no justificada | Operaciones | `cash-inconsistency.md` |
| POS | ventas completas / intentos validos | 30 dias | 99.9% | auditoria/DB | error financiero | Operaciones | `high-error-rate.md` |
| Delivery | cuentas generadas / cambios comerciales | 30 dias | 99.9% | auditoria Delivery | receipt failed | Operaciones | `deployment-failure.md` |
| Delivery | ubicaciones sin repricing / ubicaciones | 30 dias | 100% | auditoria Delivery | pricing changed | Operaciones | `deployment-failure.md` |
| Inventory | movimientos reconciliados | 30 dias | 100% | DB/auditoria | inconsistencia | Inventario | `stock-inconsistency.md` |
| Sofia | decisiones sin efecto no autorizado | 30 dias | 100% | audit counters | cualquier violacion | Security owner | `sofia-unsafe-flag.md` |
| WhatsApp | eventos deduplicados correctamente | 30 dias | 100% | counters | duplicado externo | Security owner | `whatsapp-incident.md` |
| Recovery | backups verificados / programados | 30 dias | 100% | recovery status | cualquier fallo | Infrastructure owner | `backup-failure.md` |

## Error budget

El presupuesto se calcula solo cuando exista almacenamiento persistente de metricas. Antes de ese owner gate, cualquier violacion financiera, envio no autorizado, PAID por WhatsApp o restore inconsistente consume el 100% del budget y bloquea release.
