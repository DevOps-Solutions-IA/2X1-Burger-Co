# Security

## Estado
AMARILLO

## Semáforo
🟡

## Enterprise Score
84%

## Source State
PASS

## Test State
PASS

## Runtime State
PASS EFIMERO/CANARY

## Operational State
CONDICIONADO

## Production State
NOT READY

## Problemas encontrados

| ID | Severidad | Hallazgo | Evidencia | Riesgo |
| --- | --- | --- | --- | --- |
| SEC-01 | ALTA | KMS/secret store/security owner no configurados. | Phase 2.4 | Custodia productiva incompleta. |
| SEC-02 | MEDIA | Headers/TLS y dependency audit local pasan; falta validacion en edge/staging remoto. | Enterprise resilience report | Hardening remoto no demostrado. |
| SEC-03 | BAJA | RBAC 70/70, negaciones sin side effects y actorRole confiable pasan 3X. | Phase 2.5.1-R1 | Autorización y trazabilidad local demostradas. |
| SEC-04 | BAJA | Secret scan PASS y real activation assignments 0. | `secret-scan.log` | Sin exposición detectada en scope. |
| SEC-05 | BAJA | Artifact limpio no-root, SBOM, secret scan y rollback local PASS. | Phase 2.5.1-R2 | Custodia/remoto siguen pendientes. |
| SEC-06 | BAJA | Filesystem sensible rechaza traversal/symlink y limita archivos; activaciones peligrosas 0. | Focused tests y scan 2026-07-27 | Hardening local demostrado. |
| SEC-07 | ALTA | PII legacy de memoria/WhatsApp no tiene cifrado y retencion productiva demostrados. | Sofia privacy audit 2026-07-27 | Custodia y cumplimiento incompletos. |
| SEC-08 | ALTA | CRM requiere secret HMAC y owner legal/security antes de datos reales. | CRM contract | Identidad y consentimiento no promovibles. |

## Bloqueadores

- Secret store/KMS y security owner.
- Validacion de CSP/TLS en edge remoto.
- Staging remoto, firma/attestation y approvals.
- Migracion/cifrado de PII legacy y politica de retencion.

## Dependencias

- Deployment
- API
- Frontend
- Database

## Plan de remediación

1. Diseñar auditoría contextual sin PII.
2. Cerrar CSP y dependencias.
3. Configurar KMS/rotación.

## Criterio de GO

- Auditoría completa, secrets gobernados y cero vulnerabilidades bloqueantes.
- RBAC required PASS.
- Observabilidad sin PII.

## Última auditoría
2026-07-27.

## Historial

- Phase 2.5: RBAC, rollback de operaciones denegadas, secret scan y flags seguros PASS.
- Phase 2.5.1: redacción central y bypasses cerrados; contrato RBAC continúa NO-GO.
- Phase 2.5.1-R2: secret scan, imágenes no-root, SBOM, safety canary y rollback PASS.
- Enterprise resilience: dependency audit sin vulnerabilidades conocidas, secret scan PASS y hardening filesystem validado.
- Sofia production hardening: payment/QR/location fail-closed y respuestas administrativas sanitizadas; PII legacy permanece como bloqueador.

## GO
NO
