# Sofia

## Estado
AMARILLO

## Semaforo
🟡

## Enterprise Score
82%

## Source State
CONDICIONADO

## Test State
CONDICIONADO

## Runtime State
NO DEMOSTRADO EN ARTIFACT LIMPIO

## Operational State
PASS SUPERVISADO / NO DEMOSTRADO PRODUCTIVO

## Production State
NOT READY

## Problemas encontrados

| ID | Severidad | Hallazgo | Evidencia | Riesgo |
| --- | --- | --- | --- | --- |
| SOF-01 | CRITICA | Source actual no coincide con artifact/runtime operativo versionado. | Snapshot y validacion 2026-07-27 | No puede certificarse produccion. |
| SOF-02 | ALTA | Memoria/telefonos legacy y retencion carecen de cierre legal/security. | Audit de privacidad Sofia | PII sin gate productivo completo. |
| SOF-03 | ALTA | WhatsApp legacy conserva superficie QR/sesion para roles operativos. | Revision independiente | Exposicion excesiva de QR/PII. |
| SOF-04 | ALTA | Procesos inbound atribuyen actor a un usuario humano activo. | `systemActorId()` | Auditoria semantica incorrecta. |
| SOF-05 | ALTA | Suite critica completa no fue reejecutada despues del ultimo hardening. | Loop controlado: full R3 90/91, focal corregido PASS | Regresion global no certificada. |
| SOF-06 | MEDIA | Retention solo esta disponible como dry-run seguro. | Governance/retention service | Eliminacion operativa pendiente de owner policy. |

## Bloqueadores

- Artifact limpio y provenance end-to-end.
- Suite critica completa PASS sobre el candidato final.
- Actor de sistema persistente.
- Cifrado/migracion de PII legacy y politica de retencion.
- Restriccion de WhatsApp legacy.
- QR/allowlist, secret store, security owner y staging remoto.

## Dependencias

- WhatsApp
- Security
- API
- Database
- Deployment
- Testing
- Frontend

## Plan de remediacion

1. Separar changeset Sofia y producir artifact limpio trazable.
2. Migrar PII legacy y actor automatizado con compatibilidad backward.
3. Retirar o restringir WhatsApp/Hermes legacy despues de inventario de consumidores.
4. Ejecutar critical, E2E UI, seguridad y rollback sobre el mismo artifact.
5. Cerrar owner gates fisicos y remotos.

## Criterio de GO

- Source, commit, artifact y runtime coinciden.
- Critical/E2E/security/rollback PASS sobre el mismo candidato.
- PII legacy, retencion y actor de sistema cerrados.
- QR/allowlist fisicos y owner gates aprobados.
- Cero envio, PAID o efectos operativos no autorizados.

## Ultima auditoria
2026-07-27.

## Historial

- Prompt V2, catalogo persistido, DeepSeek text-only dry-run, SafetyGuard, CRM read-only y frontend enterprise implementados.
- QR governance, payment productive gate, exact location correlation y provider dedup hardening aplicados.
- 13 suites/49 tests focalizados y Playwright 2/2 PASS; produccion permanece bloqueada.

## GO
NO
