# WhatsApp

## Estado
AMARILLO

## Semaforo
🟡

## Enterprise Score
78%

## Source State
CONDICIONADO

## Test State
PASS FOCALIZADO

## Runtime State
PASS CANARY SEGURO / CANAL REAL NO EJECUTADO

## Operational State
CONDICIONADO

## Production State
NOT READY

## Problemas encontrados

| ID | Severidad | Hallazgo | Evidencia | Riesgo |
| --- | --- | --- | --- | --- |
| WHA-01 | ALTA | QR/sesion/allowlist comercial no se montaron. | Phase 2.2/2.4 snapshots | Canal real no demostrado en artifact final. |
| WHA-02 | MEDIA | Counters timeout/dedup/send no tienen exporter persistente. | observability snapshot | Tendencia no disponible. |
| WHA-03 | MEDIA | Alert channel/security owner pendientes. | alert catalog | Respuesta a incidentes incompleta. |
| WHA-04 | BAJA | Eventos usan servicio central y audit/core completó 3X sin envío real. | Phase 2.5.1-R1 | Evidencia local cerrada. |
| WHA-05 | ALTA | Superficie legacy de sesion/QR conserva acceso para roles operativos y PII de transporte. | Revision independiente 2026-07-27 | Minimo privilegio y privacidad no cerrados. |
| WHA-06 | ALTA | Runtime operativo no corresponde al source actual versionado. | Snapshot 2026-07-27 | Canal activo no certificable. |
| WHA-07 | MEDIA | Fallback de IDs basado en tiempo fue reemplazado por fingerprint deterministico. | Provider tests | Fix local pendiente de artifact limpio. |

## Bloqueadores

- Gate humano QR/allowlist/inbound.
- Staging remoto sin envio.
- Exporter y alert channel.
- Retiro o restriccion de endpoints legacy de sesion/QR.
- Artifact limpio con el hardening actual.

## Dependencias

- Security
- Sofia
- API
- Deployment

## Plan de remediacion

1. Exportar counters sin phone/order labels.
2. Configurar owner/canal y SLO.
3. Validar fisicamente receive-only con el mismo digest.
4. Separar consumidores legacy de POS/Caja antes de aplicar minimo privilegio.

## Criterio de GO

- QR/inbound owner-approved, SENT=0 y dedup observable.
- Timeout/allowlist/PAID alerts persistentes.
- Runtime remoto trazable.

## Ultima auditoria
2026-07-27.

## Historial

- Phase 2.2: gates, dedup y cero envio PASS.
- Phase 2.4: metrics timeout/send/allowlist y runbook disponibles; real session OFF.
- Phase 2.5.1: contrato audit v2 compila; no se montó sesión ni canal real y el gate E2E quedó NO-GO.
- Enterprise resilience: timeout lifecycle 3/3, filesystem sensible endurecido y safety smoke 3X; real send permanece OFF.
- Sofia production hardening: QR bootstrap ahora respeta governance/pause/kill switch; location fallback inseguro eliminado; IDs fallback deterministas.

## GO
NO
