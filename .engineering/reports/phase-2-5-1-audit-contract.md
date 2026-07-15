# Phase 2.5.1 - Persistent Audit Contract v2

Fecha: 2026-07-14.

## Propósito

`AuditLog` es evidencia operacional persistente. Los logs estructurados continúan siendo diagnóstico técnico y no sustituyen este contrato.

## Contrato v2

| Campo | Tipo | Regla |
| --- | --- | --- |
| id | cuid | Identidad durable. |
| eventVersion | int | `2` para nuevas escrituras; legacy se interpreta como `1`. |
| timestamp | timestamptz | Momento operacional del evento; default DB. |
| actorId/userId | string nullable | Usuario efectivo; null solo para SYSTEM/PROVIDER. |
| actorType | string | USER, SYSTEM o PROVIDER. |
| actorRole | string nullable | Rol efectivo de la request. No se inventa para legacy/system. |
| action/module | string | Acción y bounded context. |
| entityType/entity | string | Tipo normalizado y alias legacy. |
| entityId | string nullable | Entidad afectada. |
| result | enum lógico string | SUCCESS, REJECTED, FAILED, CONFLICT, BLOCKED, NO_OP o ROLLED_BACK. |
| reasonCode | string nullable | Código estable; texto libre nunca es la única clasificación. |
| reasonText | string nullable | Texto sanitizado, máximo 256. |
| requestId | string nullable | Automático para HTTP; null explícito para legacy/jobs sin contexto. |
| correlationId | string nullable | Automático para HTTP. |
| traceId | string nullable | W3C trace id validado o generado. |
| idempotencyKey | string nullable | Solo fuente oficial validada o input explícito. |
| before/oldValues | JSONB nullable | Snapshot allowlisted/sanitizado. |
| after/newValues | JSONB nullable | Snapshot allowlisted/sanitizado. |
| metadata | JSONB nullable | Contexto limitado, no payload crudo. |
| source | string | http, internal, job, provider o nombre controlado. |
| environment | string | Entorno efectivo sanitizado. |
| releaseVersion | string | Build ID/release efectivo, sin paths ni secretos. |
| createdAt | timestamptz | Compatibilidad legacy/orden estable. |

## Contexto único

`AuditContextService` usará `AsyncLocalStorage` y se inicializará en middleware. Transportará IDs validados, source, idempotency key, environment y release. Un interceptor posterior a autenticación agregará actor y rol efectivo. Jobs usan `runAsSystem`; no se inventará usuario.

IDs aceptados: ASCII `[A-Za-z0-9._:-]`, 1-128 caracteres. Trace ID: 32 hex. Idempotency key: 1-128 caracteres. Entradas inválidas se descartan y se genera contexto seguro cuando corresponde.

## Rol efectivo

Para usuarios con múltiples roles se elige por precedencia explícita: `admin > supervisor > cashier > inventory > waiter > delivery`. La lista completa podrá persistirse solo en metadata sanitizada; `actorRole` conserva el rol efectivo.

## Redacción y límites

- Denegar keys que contengan password, secret, token, cookie, authorization, QR raw, session auth, card/CVV o phone sin sufijo `Masked/Hash`.
- Profundidad máxima 5, 50 keys por objeto, 50 elementos por array.
- Strings máximo 512; reason text máximo 256.
- Snapshot/metadata serializado máximo 16 KiB por campo.
- No persistir DTOs completos sin sanitización.
- `oldValues/newValues` se mantienen sincronizados con `before/after` para lectores legacy.

## Resultado y reason codes

Resultados cerrados: SUCCESS, REJECTED, FAILED, CONFLICT, BLOCKED, NO_OP, ROLLED_BACK.

Códigos iniciales: CASH_ALREADY_OPEN, CASH_REOPEN_CONFLICT, STOCK_INSUFFICIENT, DUPLICATE_REQUEST, STALE_REVISION, RBAC_DENIED, WHATSAPP_SEND_DISABLED, WHATSAPP_PAID_BLOCKED, OPERATION_COMPLETED, OPERATION_FAILED.

## Política transaccional

| Acción | Auditoría transaccional | Política |
| --- | --- | --- |
| Caja open/reopen/movement | Sí | Negocio y audit v2 confirman juntos. |
| Caja close | Condicionada | Snapshot financiero dentro de tx; notificaciones posteriores tienen eventos separados. |
| Sale/create/recovery/reopen | Sí | Caja, stock y evento principal juntos. |
| Order checkout/reopen/items | Sí | Venta/stock/orden y evento principal juntos. |
| Delivery commercial/location | Sí cuando modifica orden | Estado y evento juntos. |
| Inventory adjust/count | Sí | Stock/movimiento/audit juntos. |
| Purchase | Sí | Compra/stock/caja/audit juntos. |
| Rechazos de guard/RBAC | No hay mutación | Evento durable separado con result REJECTED/BLOCKED. |
| Lecturas/reprint | Evento no financiero separado | No modifica entidad; audit failure se hace visible. |

`AuditService.log(input, tx?)` acepta el cliente transaccional. Los callers legacy sin `tx` continúan funcionando y obtienen contexto/redacción v2.

## Migración

Se añadirán columnas nullable/default sin borrar ni renombrar campos. `eventVersion` tendrá default 1 a nivel DB para que filas históricas sean v1; `AuditService` escribe 2 explícitamente. Índices seleccionados: timestamp, actorRole+timestamp, module+action+timestamp, entityType+entityId+timestamp, requestId, correlationId e idempotencyKey. No habrá índice sobre JSONB en esta fase.

## Query API

`GET /audit` autenticado para admin/supervisor, paginado (máximo 100), orden `timestamp desc, id desc`, filtros por fecha/actor/rol/módulo/acción/entidad/result/request/correlation/idempotency. La respuesta no expone IP/user-agent ni valores prohibidos y marca filas legacy honestamente.

## Legacy

Filas existentes se leen como v1, con null en contexto inexistente. No se rellenan actorRole/request/correlation/idempotency. `entity` y `old/newValues` siguen siendo válidos.

## Rollback

La migración es forward-compatible. El artifact anterior ignora columnas nuevas. No se ejecutará downgrade destructivo; rollback de aplicación usa artifact previo mientras el schema ampliado permanece.
