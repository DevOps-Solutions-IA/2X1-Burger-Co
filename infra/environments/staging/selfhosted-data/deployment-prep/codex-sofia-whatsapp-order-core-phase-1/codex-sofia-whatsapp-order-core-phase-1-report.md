# CODEX-SOFIA-WHATSAPP-ORDER-CORE-PHASE-1

## 1. Resumen ejecutivo

Se implementó el núcleo interno para pedidos originados por Sofía/WhatsApp sin conectar WhatsApp real, Hermes, IA real, DeepSeek, pagos reales, Bold, Nequi API ni ruta pública `/pagos/[token]`.

El sistema ahora puede crear una conversación mock, registrar mensajes mock, crear y actualizar un draft Sofía con productos reales en snapshot, confirmar el draft y generar un pedido interno `WhatsappDeliveryOrder` con `paymentStatus=UNSELECTED` y `source=WHATSAPP_SOFIA`.

## 2. Estado recibido

`CODEX-SOFIA-PAYMENTS-WHATSAPP-MASTER-PHASED-PLAN-0: GO`.

Esta fase corresponde solo a Fase 1: núcleo interno de pedidos WhatsApp/Sofía.

## 3. Modelos agregados/modificados

| Modelo | Cambio | Riesgo | Estado |
|---|---|---:|---|
| `WhatsappConversation` | Conversaciones internas por teléfono, estado, handoff y origen. | Bajo | PASS |
| `WhatsappMessage` | Mensajes mock inbound/outbound/system con payload JSON opcional. | Bajo | PASS |
| `SofiaOrderDraft` | Borrador con snapshots de cliente, dirección, items, totales y faltantes. | Medio | PASS |
| `WhatsappDeliveryOrder` | Pedido interno trazable con vínculo opcional a `OrderTicket`. | Medio | PASS |
| `OrderTicket` | Relación opcional hacia pedido WhatsApp/Sofía. | Bajo | PASS |
| `User` | Relación opcional para conversaciones asignadas a humano. | Bajo | PASS |

## 4. Migraciones

Migración creada y aplicada localmente:

`prisma/migrations/20260630164000_sofia_whatsapp_order_core/migration.sql`

La migración agrega enums, tablas, índices y claves foráneas sin alterar datos existentes ni tocar caja, stock, checkout o ventas.

## 5. Servicios

Se creó `SofiaService` con tres responsabilidades:

- Conversaciones: crear/reutilizar por teléfono, registrar inbound/outbound mock, handoff y resolver.
- Drafts: crear, actualizar, confirmar y cancelar borradores con snapshots.
- Pedidos WhatsApp: crear pedido interno desde draft confirmado y, si hay caja abierta, asociarlo a `OrderTicket` delivery sin checkout ni stock/cash side effects.

## 6. Endpoints

| Endpoint | Rol | Función | Estado |
|---|---|---|---|
| `GET /admin/sofia/conversations` | admin/cashier/supervisor | Listar conversaciones mock. | PASS |
| `GET /admin/sofia/conversations/:id` | admin/cashier/supervisor | Ver detalle de conversación. | PASS |
| `POST /admin/sofia/conversations/mock-inbound` | admin/cashier/supervisor | Crear/reutilizar conversación y registrar inbound mock. | PASS |
| `POST /admin/sofia/conversations/:id/mock-outbound` | admin/cashier/supervisor | Registrar outbound mock sin envío real. | PASS |
| `POST /admin/sofia/conversations/:id/handoff` | admin/cashier/supervisor | Marcar intervención humana. | PASS |
| `POST /admin/sofia/conversations/:id/resolve` | admin/cashier/supervisor | Resolver conversación. | PASS |
| `POST /admin/sofia/order-drafts` | admin/cashier/supervisor | Crear draft Sofía. | PASS |
| `GET /admin/sofia/order-drafts` | admin/cashier/supervisor | Listar drafts. | PASS |
| `GET /admin/sofia/order-drafts/:id` | admin/cashier/supervisor | Ver detalle de draft. | PASS |
| `PATCH /admin/sofia/order-drafts/:id` | admin/cashier/supervisor | Actualizar draft editable. | PASS |
| `POST /admin/sofia/order-drafts/:id/confirm` | admin/cashier/supervisor | Confirmar draft listo. | PASS |
| `POST /admin/sofia/order-drafts/:id/cancel` | admin/cashier/supervisor | Cancelar draft. | PASS |
| `POST /admin/sofia/delivery-orders/from-draft/:draftId` | admin/cashier/supervisor | Crear pedido WhatsApp/Sofía desde draft confirmado. | PASS |
| `GET /admin/sofia/delivery-orders` | admin/cashier/supervisor | Listar pedidos internos. | PASS |
| `GET /admin/sofia/delivery-orders/:id` | admin/cashier/supervisor | Ver detalle de pedido. | PASS |
| `PATCH /admin/sofia/delivery-orders/:id/status` | admin/cashier/supervisor | Actualizar estado operativo interno. | PASS |

## 7. UI admin mínima

Se agregó vista interna `/sofia` y navegación “Sofía”.

La vista permite:

- Crear conversación mock.
- Crear draft Sofía desde producto real.
- Confirmar draft.
- Crear pedido WhatsApp/Sofía.
- Ver `source=WHATSAPP_SOFIA`.
- Ver `paymentStatus=UNSELECTED`.
- Ver aviso explícito: sin WhatsApp real, sin IA real, sin pagos reales, sin `/pagos`.

## 8. Integración con delivery/POS

La integración queda como capa trazable:

- `SofiaOrderDraft` conserva intención y snapshots.
- `WhatsappDeliveryOrder` conserva pedido interno.
- `OrderTicket` se crea solo al enviar a operación desde draft confirmado y con caja abierta.
- No se ejecuta checkout.
- No se crea sale.
- No se crea cash movement.
- No se descuenta stock.
- POS/Delivery quedan sin regresión validada por E2E checkout/caja.

## 9. Estados implementados

| Estado | Tipo | Significado | Fase |
|---|---|---|---|
| `ACTIVE` | Conversación | Conversación mock activa. | 1 |
| `HUMAN_REQUIRED` | Conversación | Requiere humano. | 1 |
| `HUMAN_TAKEN` | Conversación | Humano tomó conversación. | 1 |
| `RESOLVED` | Conversación | Conversación resuelta. | 1 |
| `ARCHIVED` | Conversación | Conversación archivada. | 1 |
| `DRAFT` | Draft | Borrador inicial. | 1 |
| `NEEDS_INFO` | Draft | Faltan datos. | 1 |
| `READY_TO_CONFIRM` | Draft | Listo para confirmar. | 1 |
| `CONFIRMED` | Draft/Pedido | Confirmado. | 1 |
| `CANCELLED` | Draft/Pedido | Cancelado. | 1 |
| `EXPIRED` | Draft | Vencido. | 1 |
| `SENT_TO_KITCHEN` | Pedido | Enviado a cocina. | 1 |
| `IN_PREPARATION` | Pedido | En preparación. | 1 |
| `OUT_FOR_DELIVERY` | Pedido | En reparto. | 1 |
| `DELIVERED` | Pedido | Entregado. | 1 |
| `UNSELECTED` | Pago | Método de pago no seleccionado. | 1 |

## 10. Confirmación paymentStatus UNSELECTED

Validado en backend y E2E: todo pedido `WhatsappDeliveryOrder` creado en Fase 1 queda con `paymentStatus=UNSELECTED` y `paymentMethod=null`.

## 11. Confirmación no WhatsApp real

Solo se implementan endpoints `mock-inbound` y `mock-outbound`. No hay Hermes, Baileys, proveedor externo ni envío real conectado a esta fase.

## 12. Confirmación no IA real

No se conectó DeepSeek, OpenAI, agente conversacional ni prompt runtime. `aiSummary` queda como campo opcional de snapshot/admin.

## 13. Confirmación no pagos reales

No se implementó `/pagos/[token]`, Bold, Nequi API, webhook ni link público. La preparación de pago queda diferida a Fase 2/3.

## 14. Confirmación no Caja/Stock/Checkout afectados

Prueba backend validó:

- stock de producto directo sin cambios.
- `cash_movements` sin cambios.
- `sales` sin cambios.

E2E checkout/caja existente pasó completo.

## 15. Tests backend

Comando final:

`pnpm --filter @inventory-fastfood/api test`

Resultado:

- 12 suites PASS.
- 215 tests PASS.
- 0 failures.

Se agregó cobertura para:

- endpoint protegido.
- crear/reutilizar conversación.
- inbound/outbound mock.
- crear/actualizar/confirmar/cancelar draft.
- crear pedido WhatsApp/Sofía desde draft confirmado.
- snapshots.
- `paymentStatus=UNSELECTED`.
- `source=WHATSAPP_SOFIA`.
- no caja/stock/sale side effects.

## 16. E2E

Comandos:

- `BASE_URL=http://localhost npx playwright test tests/e2e/sofia-order-core.spec.ts --config=tests/e2e/playwright.noserver.config.ts --project=chromium`
- `BASE_URL=http://localhost npx playwright test tests/e2e/phase-delivery-auto-3-checkout-cash-audit.spec.ts --config=tests/e2e/playwright.noserver.config.ts --project=chromium`

Resultados:

- Sofía order core: 2 passed.
- Checkout/cash audit: 2 passed.

## 17. Build/typecheck/health

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/api-typecheck.log` |
| API build | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/api-build.log` |
| API test | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/api-test.log` |
| Web typecheck | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/web-build.log` |
| Health | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/health.log` |
| E2E Sofía | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/e2e-sofia-order-core.log` |
| E2E checkout/cash | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/e2e-checkout-cash.log` |
| `test.skip` | PASS, 0 ocurrencias | `/tmp/codex-sofia-whatsapp-order-core-phase-1/test-skip-check.log` |
| Bundle `localhost:4300` | PASS, 0 ocurrencias | `/tmp/codex-sofia-whatsapp-order-core-phase-1/bundle-localhost4300.log` |
| Docker build api/web | PASS | `/tmp/codex-sofia-whatsapp-order-core-phase-1/docker-compose-build-api-web.log` |

## 18. Screenshots

Capturas generadas:

- `01-admin-sofia-conversations.png`
- `02-create-mock-conversation.png`
- `03-create-sofia-draft.png`
- `04-confirm-draft.png`
- `05-create-whatsapp-delivery-order.png`
- `06-order-detail-source-sofia.png`
- `07-payment-status-unselected.png`
- `08-delivery-pos-unchanged.png`
- `09-final-summary.png`

Ruta:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-whatsapp-order-core-phase-1/`

## 19. Riesgos residuales

- La UI `/sofia` es mínima de validación interna, no panel final de operador.
- La creación de `OrderTicket` exige caja abierta porque el modelo actual requiere `cashSessionId`.
- El link `/pagos/[token]`, expiración y tokens seguros quedan para Fase 2.
- Validación de pricing delivery real no se ejecuta desde Sofía en esta fase; se guarda `deliveryFee` snapshot controlado/admin.

## 20. Próxima fase recomendada

Fase 2: `/pagos/[token]` público seguro.

Debe implementar token público, expiración, vista mobile-first del pedido precargado y método de pago no-real/selección inicial sin conectar proveedores reales.

## 21. Tablas obligatorias

### Tabla 1

| Modelo | Cambio | Riesgo | Estado |
|---|---|---:|---|
| `WhatsappConversation` | Nuevo modelo para conversación interna. | Bajo | PASS |
| `WhatsappMessage` | Nuevo modelo para mensajes mock. | Bajo | PASS |
| `SofiaOrderDraft` | Nuevo modelo para borrador y snapshots. | Medio | PASS |
| `WhatsappDeliveryOrder` | Nuevo modelo para pedido interno trazable. | Medio | PASS |
| `OrderTicket` | Relación opcional de trazabilidad. | Bajo | PASS |

### Tabla 2

| Endpoint | Rol | Función | Estado |
|---|---|---|---|
| `/admin/sofia/conversations*` | admin/cashier/supervisor | Conversaciones y mensajes mock. | PASS |
| `/admin/sofia/order-drafts*` | admin/cashier/supervisor | Drafts Sofía. | PASS |
| `/admin/sofia/delivery-orders*` | admin/cashier/supervisor | Pedidos internos WhatsApp/Sofía. | PASS |

### Tabla 3

| Flujo | Resultado esperado | Resultado final | Estado |
|---|---|---|---|
| Crear conversación mock | Conversación activa por teléfono. | Conversación creada/reutilizada. | PASS |
| Registrar inbound/outbound | Mensajes internos sin envío real. | Mensajes guardados. | PASS |
| Crear draft | Snapshot con producto real y totales. | Draft `READY_TO_CONFIRM`. | PASS |
| Confirmar draft | Draft `CONFIRMED`. | Confirmado. | PASS |
| Crear pedido | `WHATSAPP_SOFIA`, `UNSELECTED`, snapshots. | Pedido creado. | PASS |
| Proteger endpoints | Sin token debe rechazar. | 401 validado. | PASS |
| Caja/stock | Sin efectos colaterales. | Sin cambios en stock/cash/sales. | PASS |

### Tabla 4

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck/build/test | PASS | Logs en `/tmp/codex-sofia-whatsapp-order-core-phase-1/` |
| Web typecheck/build | PASS | Logs en `/tmp/codex-sofia-whatsapp-order-core-phase-1/` |
| E2E Sofía | PASS | `e2e-sofia-order-core.log` |
| E2E checkout/cash | PASS | `e2e-checkout-cash.log` |
| Health | PASS | `health.log` |
| Screenshots | PASS | Carpeta de screenshots generada |
| No WhatsApp/IA/pagos reales | PASS | Sin integraciones reales agregadas |

## 22. Decisión final

CODEX-SOFIA-WHATSAPP-ORDER-CORE-PHASE-1: GO
