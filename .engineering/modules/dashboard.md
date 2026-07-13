# Dashboard

## Estado

AMARILLO

## Semáforo

🟡

## Enterprise Score

75%

## Source State

PASS

## Test State

PASS

## Runtime State

PASS

## Operational State

CONDICIONADO

## Production State

NOT READY

## Problemas encontrados

| ID | Severidad | Hallazgo | Evidencia | Riesgo |
| --- | --- | --- | --- | --- |
| DAS-01 | ALTA | Dashboard consume backend real, pero refleja Auto Safe efectivo contradictorio. | `sofia-effective-status.json` | Puede comunicar un estado inseguro originado en runtime viejo. |
| DAS-02 | MEDIA | Pagina dashboard conserva 5 warnings no-explicit-any. | `web-build.log` | Metricas sin contratos fuertes. |
| DAS-03 | MEDIA | No existe version/build visible para el operador. | `container-images.txt` | No puede asociarse una captura a un release. |

## Bloqueadores

- Corregir runtime de flags.
- Tipar metricas.
- Exponer provenance sanitizado.

## Dependencias

- API
- Frontend
- Database
- Security
- Deployment
- Sofia

## Plan de remediación

1. Definir contrato versionado de resumen.
2. Eliminar any y estados derivados ambiguos.
3. Agregar build metadata sanitizada.
4. Validar loading/error/empty y datos reales por release.

## Criterio de GO

- Metricas backend/UI reconciliadas.
- Cero contradicciones de flags.
- Cero warnings en dashboard.
- Captura ligada a artifact.

## Última auditoría

2026-07-12.

## Historial

- Phase 1: runtime carga; estado efectivo revela drift de seguridad.

## GO

NO
