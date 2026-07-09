# CODEX-SOFIA-ORDER-FLOW-ARCHITECTURE-CORRECTION-0

## 1. Resumen ejecutivo

Se corrigió la arquitectura operativa de Sofía: el panel `/sofia` ya no funciona como bandeja operativa de pedidos. Sofía queda como configuración, sandbox técnico, monitoreo y futura integración. Los pedidos creados por Sofía se exponen y operan en los módulos normales de POS y Domicilios mediante `OrderTicket` delivery, con metadata `WHATSAPP_SOFIA`, chip “Sofía”, acento visual violeta y estado de pago visible.

## 2. Corrección de arquitectura

Antes, la UI de Sofía listaba pedidos internos y podía interpretarse como un panel operativo paralelo. Eso duplicaba responsabilidad y generaba riesgo de operación fragmentada.

Después, Sofía solo crea o simula el origen técnico del pedido. La operación diaria ocurre en:

- POS.
- Domicilios.
- Caja/recaudo en el flujo existente.
- Checkout existente.
- Gestión de domiciliario/estado desde Domicilios.

## 3. Qué queda en Sofía Config

- Sandbox técnico para conversación mock.
- Creación controlada de draft para QA/admin.
- Envío del pedido al flujo normal.
- Métricas generales de pedidos creados por Sofía.
- Link “Ver en Domicilios”.
- Aviso explícito: el panel no prepara, no cobra, no despacha y no mueve estados operativos.

## 4. Qué queda en POS/Domicilios

- Visualización de pedidos Sofía.
- Gestión normal del domicilio.
- Estados operativos.
- Recaudo/cobro por flujo normal.
- Checkout.
- Validación de pago cuando exista en fases futuras.

## 5. Cómo se operan pedidos Sofía

Flujo corregido:

1. Sofía o sandbox técnico crea conversación/draft.
2. Draft confirmado crea `WhatsappDeliveryOrder`.
3. Se crea/relaciona `OrderTicket` tipo `DELIVERY`.
4. El pedido aparece en `/deliveries` y `/pos`.
5. Operador trabaja desde Domicilios/POS.
6. Caja, stock y checkout siguen las reglas actuales.

## 6. Cómo se identifica visualmente pedido Sofía

En POS y Domicilios, si el pedido tiene `whatsappDeliveryOrder.source === WHATSAPP_SOFIA` o agente snapshot `Sofía`:

- Chip “Sofía”.
- Borde/fondo violeta.
- Etiqueta “Origen: Sofía”.
- Indicador WhatsApp.
- Estado de pago visible, inicialmente `UNSELECTED`.
- Método de pago visible cuando exista.

## 7. Cambios en modelos si aplica

No se agregaron migraciones nuevas en esta corrección. Se reutilizó la relación existente `OrderTicket.whatsappDeliveryOrder`.

## 8. Cambios en endpoints si aplica

Se ajustaron los endpoints normales de órdenes para incluir metadata Sofía:

- `/orders?activeOnly=true`
- `/orders/delivery-active`
- `/orders/:id`

Ahora devuelven `whatsappDeliveryOrder` con:

- `source`
- `paymentStatus`
- `paymentMethod`
- `createdByAgentNameSnapshot`
- snapshots de cliente

## 9. Cambios en UI POS/Domicilios

POS:

- `PosActiveOrdersPanel` muestra chip “Sofía”.
- Muestra “Origen: Sofía · Pago: UNSELECTED”.
- Usa acento violeta sin afectar pedidos normales ni mesero.

Domicilios:

- Cola muestra chip “Sofía”.
- Detalle muestra chip, origen, WhatsApp y payment status.
- Mantiene acciones normales de entrega.

## 10. Confirmación panel Sofía no operativo

El panel `/sofia` fue renombrado y ajustado como “Configuración de Sofía”. La sección de pedidos operativos se reemplazó por monitoreo/métricas y botón “Ver en Domicilios”. No hay acciones de preparar, cobrar, despachar ni mover estados operativos en Sofía.

## 11. Confirmación pedidos Sofía se operan en flujo normal

Validado por E2E:

- Se crea pedido mock desde Sofía sandbox.
- Aparece en Domicilios con chip “Sofía”.
- Aparece en POS con chip “Sofía”.
- Payment status visible.
- Operación continúa fuera del panel Sofía.

## 12. Confirmación Caja/Stock/Checkout intactos

Regresión `phase-delivery-auto-3-checkout-cash-audit` PASS.

API tests completos PASS:

- 12 suites.
- 215 tests.
- 0 failures.

## 13. Tests

Backend:

- Se amplió el test crítico Sofía para validar que el pedido aparece en `/orders/delivery-active` y `/orders?activeOnly=true` con `WHATSAPP_SOFIA`, agente “Sofía” y `UNSELECTED`.

E2E:

- `sofia-order-flow-architecture-correction.spec.ts` valida arquitectura corregida.
- `sofia-order-core.spec.ts` actualizado para no depender de lista operativa en Sofía.
- `phase-delivery-auto-3-checkout-cash-audit.spec.ts` validó regresión checkout/caja.

## 14. Build/typecheck/health

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/api-typecheck.log` |
| API build | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/api-build.log` |
| API test | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/api-test.log` |
| Web typecheck | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/web-build.log` |
| Health | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/health.log` |
| E2E Sofía flow | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/e2e-sofia-order-flow.log` |
| E2E checkout/cash | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/e2e-checkout-cash.log` |
| Docker build api/web | PASS | `/tmp/codex-sofia-order-flow-architecture-correction-0/docker-compose-build-api-web.log` |
| `test.skip` | PASS, 0 ocurrencias | `/tmp/codex-sofia-order-flow-architecture-correction-0/test-skip-check.log` |
| Bundle `localhost:4300` | PASS, 0 ocurrencias | `/tmp/codex-sofia-order-flow-architecture-correction-0/bundle-localhost4300.log` |

## 15. Screenshots

Generadas en:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-order-flow-architecture-correction-0/`

Capturas:

- `01-sofia-config-panel-not-operational.png`
- `02-create-sofia-mock-order.png`
- `03-pos-delivery-card-sofia-chip.png`
- `04-pos-delivery-card-sofia-color.png`
- `05-sofia-order-payment-status-visible.png`
- `06-normal-delivery-card-unchanged.png`
- `07-waiter-order-card-unchanged.png`
- `08-delivery-flow-process-sofia-order.png`
- `09-final-summary.png`

## 16. Riesgos residuales

- El sandbox técnico sigue permitiendo crear pedidos mock para QA/admin mientras no exista Sofía real. No es panel operativo: no prepara/cobra/despacha.
- La validación manual de pagos desde Domicilios/POS queda para fases de pagos manuales/Fase 3.
- La página `/pagos/[token]` debe actualizar el mismo `OrderTicket`/`WhatsappDeliveryOrder`, no crear flujo paralelo.

## 17. Ajuste recomendado para Fase 2 `/pagos/[token]`

La Fase 2 debe generar link desde el pedido operativo y reflejar el estado de pago en POS/Domicilios. El panel Sofía solo debe mostrar métricas técnicas y configuración, no administrar pagos por pedido.

## 18. Tablas obligatorias

### Tabla 1

| Función | Antes | Decisión corregida | Estado |
|---|---|---|---|
| Operar pedidos Sofía | Riesgo de panel paralelo en `/sofia`. | Operar en POS/Domicilios. | PASS |
| Panel Sofía | Mezclaba sandbox y lista de pedidos. | Configuración, sandbox técnico y monitoreo. | PASS |
| Estado de pago | Visible en panel Sofía. | Visible en POS/Domicilios. | PASS |
| Identidad visual | No diferenciada en flujo operativo. | Chip “Sofía” y acento violeta. | PASS |
| Pedido normal | Sin cambio requerido. | Se mantiene estilo actual. | PASS |
| Pedido mesero | Sin cambio requerido. | Se mantiene independiente de Sofía. | PASS |

### Tabla 2

| Pedido | Origen | Dónde se opera | Identidad visual | Estado |
|---|---|---|---|---|
| Normal POS/delivery | POS/manual | POS/Domicilios | Estilo actual | PASS |
| Mesero | Waiter | POS/mesa | Etiqueta mesero existente | PASS |
| Sofía | `WHATSAPP_SOFIA` | POS/Domicilios | Chip “Sofía”, violeta, pago visible | PASS |

### Tabla 3

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck/build/test | PASS | Logs `/tmp/codex-sofia-order-flow-architecture-correction-0/` |
| Web typecheck/build | PASS | Logs `/tmp/codex-sofia-order-flow-architecture-correction-0/` |
| E2E arquitectura Sofía | PASS | `e2e-sofia-order-flow.log` |
| E2E checkout/cash | PASS | `e2e-checkout-cash.log` |
| Health | PASS | `health.log` |
| Screenshots | PASS | 9 capturas |
| Sin `test.skip` nuevo | PASS | 0 ocurrencias |

## 19. Decisión final

CODEX-SOFIA-ORDER-FLOW-ARCHITECTURE-CORRECTION-0: GO
