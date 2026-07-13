# Sofia

## Estado
AMARILLO

## Semaforo
🟡

## Enterprise Score
68%

## Source State
PASS

## Test State
PASS

## Runtime State
PASS CANARY

## Operational State
CONDICIONADO

## Production State
NOT READY

## Problemas encontrados

| ID | Severidad | Hallazgo | Evidencia | Riesgo |
| --- | --- | --- | --- | --- |
| SOF-01 | ALTA | QR/allowlist/inbound comercial no se ejecutaron en canary. | `safety-smoke.md` | Operacion real sigue pendiente. |
| SOF-02 | ALTA | Security owner gate y rotacion siguen pendientes. | `owner-gates.md` | Produccion bloqueada. |
| SOF-03 | MEDIA | El canary declara DeepSeek dry-run pero deshabilita el proveedor externo. | `safety-smoke.md` | No valida llamada externa en esta fase. |
| SOF-04 | MEDIA | E2E visual required aun no existe. | Modulo Frontend/Testing | UI no es gate automatizado. |

## Bloqueadores

- Phase 2.2 de safety gates operativos.
- QR/allowlist final bajo intervencion humana.
- Security owner gate/rotacion.
- E2E visual seguro.

## Dependencias

- WhatsApp
- Security
- API
- Frontend
- Database
- Dashboard
- Testing
- Deployment

## Plan de remediacion

1. Repetir pause/send/PAID/allowlist gates en artifact remoto trazable.
2. Cerrar QR e inbound bajo gate humano.
3. Automatizar E2E de dashboard/conversations/QR.
4. Mantener sandbox separado y produccion bloqueada.

## Criterio de GO

- Auto Safe, auto reply, send, production y PAID efectivos false.
- QR/allowlist validados segun gate aprobado.
- Sandbox no suma como real.
- UI/API/runtime coinciden en staging remoto.

## Ultima auditoria
2026-07-13.

## Historial

- Phase 1: ROJO 58% por Auto Safe efectivo true y runtime drift.
- Phase 2.1: Auto Safe efectivo false, cinco safety flags bloqueados y artifact canary trazable; pasa a AMARILLO.

## GO
NO
