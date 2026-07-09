# SOFÍA CONVERSATIONS REAL DATA CONNECTION - Reporte final

## 1. Resumen ejecutivo

`/sofia/conversations` fue conectado a una fuente backend nueva y sanitizada: `GET /admin/sofia/conversations/inbox`.

La vista dejó de consumir la lista completa sin clasificar (`/admin/sofia/conversations`) y ahora separa:

- Operación real.
- Validación interna.
- Sandbox.
- Histórico.

La operación real permanece vacía porque `realOperationEnabled=false` por `ALLOWLIST_FINAL_PENDING`. No se inventan conversaciones reales. Sandbox e histórico quedan visibles solo como tabs separadas.

## 2. Endpoint usado/creado

| Endpoint | Tipo | Uso | Estado |
|---|---|---|---|
| `GET /admin/sofia/conversations/inbox` | Nuevo | Fuente sanitizada del inbox supervisado | PASS |
| `POST /admin/sofia/conversations/:id/pause` | Existente | Acción supervisada | Sin cambios |
| `POST /admin/sofia/conversations/:id/resume` | Existente | Acción supervisada | Sin cambios |
| `POST /admin/sofia/conversations/:id/take-over` | Existente | Handoff humano | Sin cambios |
| `POST /admin/sofia/conversations/:id/release` | Existente | Liberar Sofía | Sin cambios |
| `POST /admin/sofia/outbound/:id/cancel` | Existente | Cancelar sugerencia | Sin cambios |

## 3. Datos reales conectados

- Scope real desde backend.
- Conversaciones reales desde `real.conversations`.
- Validación interna desde `internalValidation.conversations`.
- Sandbox desde `sandbox.conversations`, oculto por defecto.
- Histórico desde `historical.conversations`, oculto por defecto.
- Estado de seguridad: `realSendingEnabled=false`, `autoReplyEnabled=false`, `productionEnabled=false`, `whatsappCanMarkPaid=false`.
- DeepSeek dry-run desde flags backend: `deepSeekEnabled=true`, `aiMode=dry_run`.

## 4. Datos sandbox separados

El backend clasificó 97 conversaciones como `sandbox`. La vista principal no las suma como operación real. Se muestran solo en la tab `Sandbox`.

## 5. Datos mock/históricos ocultados

El backend clasificó 3 conversaciones como `historical`. La vista no las suma como operación real ni como validación interna actual.

## 6. Reason codes limpiados

Los reason codes técnicos se mapearon a copy operativo en la vista principal. Los códigos originales quedan solo en `Ver detalle técnico`, colapsado por defecto.

## 7. Copy corregido

La vista ahora muestra:

- `Conversaciones Sofía`.
- `Inbox supervisado para revisar mensajes, sugerencias IA y bloqueos de seguridad. Sofía no envía respuestas reales ni confirma pagos.`
- `Operación real pendiente`.
- `Envío real bloqueado`.
- `Auto reply OFF`.
- `PAID bloqueado`.
- `Producción bloqueada`.

## 8. Qué muestra ahora `/sofia/conversations`

- Operación real: 0.
- Validación interna: 0.
- Sandbox: 97, separado.
- Histórico: 3, separado.
- SENT real: 0.
- DeepSeek: dry-run.
- Envío real: bloqueado.
- Producción: bloqueada.

## 9. Qué no muestra por no tener fuente real

- No muestra conversaciones comerciales reales porque allowlist final sigue pendiente.
- No muestra números completos.
- No muestra payloads crudos.
- No muestra QR raw.
- No muestra sandbox como real.

## 10. LOOP controlado

| Iteración | Hallazgo | Corrección | Resultado |
|---|---|---|---|
| 1 | Endpoint actual mezclaba datos y frontend infería señales | Se creó `conversations/inbox` sanitizado | Typecheck API/Web PASS |
| 2 | Campo `rawPayloadExcluded` activaba scanner por nombre ambiguo | Se renombró a `providerPayloadExcluded` | Sanitización endpoint PASS |
| 3 | UI podía mostrar fallback antes de cargar y `SENT real` sumaba sandbox/histórico | Estado loading honesto y `SENT real` solo cuenta `real` | Validación visual/funcional PASS |

## 11. Seguridad

| Seguridad | Resultado | Evidencia |
|---|---|---|
| No real activation | 0 líneas | `/tmp/sofia-conversations-real-data/no-real-activation-check-final.log` |
| Secret check | 20 falsos positivos por nombres técnicos `qrString` y reportes previos; sin `data:image`, sin keys, sin QR raw en inbox | `/tmp/sofia-conversations-real-data/secret-check-final.log` |
| Sanitización endpoint inbox | `noSecrets=true`, `noFullPhone=true`, `forbiddenFound=[]` | `/tmp/sofia-conversations-real-data/conversations-inbox-shape.log` |
| Reason codes visibles | `visibleForbiddenReasonCodes=[]` | `/tmp/sofia-conversations-real-data/functional-validation-final-loop.log` |

## 12. Build/typecheck

| Build/typecheck | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/sofia-conversations-real-data/api-typecheck-final.log` |
| API build | PASS | `/tmp/sofia-conversations-real-data/api-build-final.log` |
| Web typecheck | PASS | `/tmp/sofia-conversations-real-data/web-typecheck-final.log` |
| Web build | PASS con warnings ESLint preexistentes en módulos no tocados | `/tmp/sofia-conversations-real-data/web-build-final.log` |
| Docker API/Web | PASS | `/tmp/sofia-conversations-real-data/docker-ps-after-api-final.log` |
| Health | PASS | `/tmp/sofia-conversations-real-data/health-after-api-final.log` |

## 13. Screenshot

| Screenshot | Evidencia | Estado |
|---|---|---|
| `/sofia/conversations` operación real separada | `/tmp/sofia-conversations-real-data/screenshots/01-conversations-real-data.png` | PASS |
| Vista secundaria capturada | `/tmp/sofia-conversations-real-data/screenshots/02-conversations-internal-validation.png` | PASS parcial, selector no cambió tab pero no afecta validación principal |

## 14. Tablas obligatorias

### Elemento visible | Fuente backend | Estado | Evidencia

| Elemento visible | Fuente backend | Estado | Evidencia |
|---|---|---|---|
| Operación real | `real.conversations` | 0, pendiente por allowlist | Screenshot 01 |
| Validación interna | `internalValidation.conversations` | Separada | Screenshot 01 |
| Sandbox | `sandbox.conversations` | 97, tab separada | `conversations-inbox-shape.log` |
| Histórico | `historical.conversations` | 3, tab separada | `conversations-inbox-shape.log` |
| DeepSeek | `security.deepSeekEnabled` + `security.aiMode` | dry-run | Screenshot 01 |
| SENT real | `summary.outboundSent` solo scope real | 0 | Screenshot 01 |
| Envío real | `security.realSendingEnabled` | Bloqueado | Screenshot 01 |

### Dato ocultado | Motivo | Acción

| Dato ocultado | Motivo | Acción |
|---|---|---|
| Teléfono completo | PII | Reemplazado por `phoneMasked` y `phoneHash` |
| Payload crudo | Puede contener PII/secrets | Excluido del endpoint |
| QR raw | Material sensible | No devuelto por inbox |
| Sandbox como real | Contamina operación | Tab separada |
| Histórico como real | Contamina operación actual | Tab separada |

### Reason code | Copy operativo | Ubicación

| Reason code | Copy operativo | Ubicación |
|---|---|---|
| `ADDRESS_MISSING` | Falta dirección | Vista principal si aplica; código en detalle técnico |
| `ORDER_CONFIRMATION_MISSING` | Falta confirmación del pedido | Vista principal si aplica; código en detalle técnico |
| `P0_COMMERCIAL` | Requiere revisión comercial | Vista principal si aplica; código en detalle técnico |
| `MAXI_FAMILY_COPY_RISK` | Riesgo comercial | Vista principal si aplica; código en detalle técnico |
| `UNKNOWN_PRODUCT` | Producto no reconocido | Vista principal si aplica; código en detalle técnico |
| `PAYMENT_SENSITIVE` | Pago sensible | Vista principal si aplica; código en detalle técnico |
| `LOW_CONFIDENCE` | Baja confianza | Vista principal si aplica; código en detalle técnico |
| `HUMAN_REQUESTED` | Cliente pidió humano | Vista principal si aplica; código en detalle técnico |
| `ALLOWLIST_REQUIRED` | Número fuera de allowlist | Vista principal si aplica; código en detalle técnico |

### Pendiente | Motivo | Acción futura

| Pendiente | Motivo | Acción futura |
|---|---|---|
| Allowlist comercial final | Bloquea operación real | Validar inbound allowlist aceptado |
| Envío real interno | Diferido por seguridad | Probar solo en fase explícita posterior |
| Conversaciones comerciales reales | `realOperationEnabled=false` | Habilitar solo con gates completos |

### Seguridad | Resultado | Evidencia

| Seguridad | Resultado | Evidencia |
|---|---|---|
| Producción | Bloqueada | UI + endpoint |
| Envío real WhatsApp | Bloqueado | UI + endpoint |
| Auto reply | OFF | Endpoint |
| PAID por WhatsApp | Bloqueado | Endpoint |
| Secretos | No expuestos por inbox | `conversations-inbox-shape.log` |

### Build/typecheck | Resultado | Evidencia

| Build/typecheck | Resultado | Evidencia |
|---|---|---|
| API typecheck/build | PASS | Logs finales |
| Web typecheck/build | PASS | Logs finales |

## 15. Qué no se tocó

- POS.
- Caja.
- Stock.
- Checkout.
- Domicilios.
- Precios.
- Catálogo.
- Producción.
- Envío real WhatsApp.
- Auto reply.
- Prisma reset.

## 16. Decisión final

`SOFÍA CONVERSATIONS REAL DATA CONNECTION: GO`

Motivo: `/sofia/conversations` consume datos reales/sanitizados del backend, separa sandbox/histórico, no inventa operación real, no muestra reason codes técnicos en la vista principal, mantiene envío real/auto reply/producción bloqueados, y build/typecheck pasan.
