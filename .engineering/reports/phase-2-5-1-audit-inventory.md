# Phase 2.5.1 - Audit Inventory

Fecha: 2026-07-14.

## Estado actual

- `AuditLog` tiene 10 campos funcionales: user, action, module, entity, entityId, old/new values, IP, user agent y createdAt.
- Existen 85 llamadas a `AuditService.log` en 19 archivos de servicio.
- Existen 6 escrituras directas adicionales de Sofía fuera de `AuditService` (7 contando la implementación del servicio central).
- `requestId`, `correlationId` y `traceId` solo viven en middleware/logs HTTP.
- El actor llega manualmente como `userId`; el rol efectivo no se persiste.
- Las idempotency keys de Delivery/Sofía viven en payloads o tablas específicas, no en el contrato universal.
- No existe endpoint universal de consulta de auditoría.

## Inventario por módulo

| Módulo | Acción | Audit actual | Campos | Faltantes | Riesgo | Prioridad |
| --- | --- | --- | --- | --- | --- | --- |
| Auth | login/logout/refresh | Parcial por `AuditService` | actor, action, payload legacy | role, request/correlation/trace, result/reason v2 | Acceso sin contexto durable completo | P0 |
| Users/Roles | create/update/remove/credentials | Sí | actor, before/after parcial | contexto, result, reason code | Cambio de privilegios incompleto | P0 |
| Caja | open/close/reopen/movement | Sí, fuera de varias transacciones | actor, action, entity, payload | role/context/idempotency/result y atomicidad | Operación financiera sin audit atómico | P0 |
| POS/Sales | sale/convert/reopen | Sí, fuera de transacción | actor, before/after parcial | contexto/result/reason/atomicidad | Recovery sin evidencia atómica | P0 |
| Orders | create/update/items/checkout/reopen/location | Sí | actor y snapshots variables | contrato universal y atomicidad | Cuenta/stock/caja pueden confirmar antes del audit | P0 |
| Delivery | receipt/location/workflow | Sí | eventos específicos, phoneMasked | contexto v2 y reason/result tipados | Historial fragmentado | P0 |
| Inventory | adjust/count | Sí, fuera de transacción | actor/dto | before real, contexto, atomicidad | Stock puede cambiar sin audit si falla escritura posterior | P0 |
| Purchases | create | Sí, fuera de transacción | actor/dto | before/after mínimo, contexto, atomicidad | Compra/caja sin audit atómico | P0 |
| Payments | checkout/payment links | Parcial vía Orders/Sofía | actor/status | contrato v2 uniforme | Evidencia dispersa | P0 |
| Reports | cierres/exportes | Sí | actor/action | contexto/result/reason | Consulta sensible poco trazable | P1 |
| Settings | update | Sí | actor/old/new | role/context/result | Cambio sensible incompleto | P0 |
| Sofía governance | pause/settings | Escritura directa | actor/action/details | todo el contexto v2 | Bypass del redactor central | P0 |
| Sofía learning | feedback | Escritura directa | actor/payload | contexto/redacción v2 | Payload no gobernado centralmente | P1 |
| Sofía runtime safety | blocked actions | Escritura directa | result/reason dentro de JSON | columnas v2 | Safety no consultable uniformemente | P0 |
| Sofía backup/retention | dry-run/blocked | Escritura directa | actor/action | contexto v2 | Gobierno fragmentado | P1 |
| QR gateway | state/blocked send | Escritura directa | action/details | contexto v2 y actor system explícito | Session metadata puede escapar redacción | P0 |
| WhatsApp core | send/report failures | Sí | actor/action/payload | columnas v2 | Resultados no normalizados | P0 |
| Security/RBAC | denied request | Solo log HTTP | request y status técnico | AuditLog durable | Denegaciones no consultables | P0 |
| Deployment/recovery | scripts/reportes | Evidencia de release | manifest/checkpoint | no aplica a request AuditLog | Debe permanecer en evidence, no fingir DB event | P2 |

## Hallazgos estructurales

1. El formato depende de cada caller; no hay versionado ni validación de resultado/reason.
2. `oldValues/newValues` reciben DTOs completos y carecen de redacción central.
3. La mayoría de eventos financieros se escribe después del commit de negocio.
4. Las escrituras directas de Sofía evitan cualquier política central futura.
5. No hay lectura tipada/paginada con RBAC del contrato universal.
6. El middleware valida IDs, pero no los propaga a servicios.

## Alcance de remediación

La primera cobertura obligatoria será Caja, Sales/Orders, Delivery, Inventory/Purchases, Users/Security y safety gates de Sofía/WhatsApp. Los módulos restantes conservarán compatibilidad mediante el wrapper central y recibirán automáticamente contexto v2 sin reescribir todos sus callers.
