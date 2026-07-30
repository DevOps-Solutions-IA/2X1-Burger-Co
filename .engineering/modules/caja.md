# Caja

## Estado
AMARILLO

## Semáforo
🟡

## Enterprise Score
92%

## Source State
PASS

## Test State
PASS

## Runtime State
PASS EFIMERO

## Operational State
PASS LOCAL

## Production State
NOT READY

## Problemas encontrados

| ID | Severidad | Hallazgo | Evidencia | Riesgo |
| --- | --- | --- | --- | --- |
| CAJ-01 | MEDIA | Apertura, cierre, reapertura concurrente y movimiento pasan 3X; el lock evita dos sesiones reabiertas. | `phase-2-5/repeatability-3x.json` | Riesgo de doble reapertura corregido y validado localmente. |
| CAJ-02 | BAJA | AuditLog v2 persiste rol/request/correlation/idempotency y snapshots. | Phase 2.5.1-R1 | Contrato local validado. |
| CAJ-03 | MEDIA | UI observa estados y efectos reales, pero no todas las mutaciones se ejecutaron desde clicks Playwright. | `phase25-final3/playwright.log` | Cobertura UI mutante parcial. |
| CAJ-04 | BAJA | Open/close/reopen/movement audit transaccional y release local pasan 3X. | Phase 2.5.1-R2 | Gate interno cerrado. |

## Bloqueadores

- Required CI y staging remoto.
- E2E UI mutante de cierre/reapertura como required check remoto.
- Resolver warnings de tipos del frontend financiero.

## Dependencias

- POS
- Database
- API
- Frontend
- Users
- Security
- Testing
- Deployment

## Plan de remediación

1. Persistir contexto de auditoría e idempotencia de operaciones financieras.
2. Ejecutar cierre/reapertura desde UI con reconciliación DB.
3. Activar el job E2E como required check.

## Criterio de GO

- Auditoría contiene todos los campos operativos requeridos.
- UI/API/DB pasan exactamente una vez bajo concurrencia.
- Required CI y staging remoto PASS.

## Última auditoría
2026-07-15.

## Historial

- Phase 2.5: close/reopen concurrente 3X PASS; carrera de reapertura corregida con advisory lock transaccional.
- Phase 2.5.1: auditoria transaccional integrada; gate global NO-GO antes de repetibilidad.
- Phase 2.5.1-R2: audit/core/recovery 3X y canary read-only PASS.

## GO
NO
