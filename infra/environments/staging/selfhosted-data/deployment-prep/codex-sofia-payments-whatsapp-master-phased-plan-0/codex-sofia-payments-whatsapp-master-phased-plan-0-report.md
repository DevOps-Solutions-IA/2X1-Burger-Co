# CODEX-SOFIA-PAYMENTS-WHATSAPP-MASTER-PHASED-PLAN-0

Fecha UTC: 2026-06-30

Proyecto: inventario-fastfood-system / 2X1 Burger Co

Decisión: GO

## 1. Resumen ejecutivo

Este reporte define el plan maestro por fases para construir el ecosistema Sofía + WhatsApp/Hermes + pedidos + pagos en `2x1burger.co/pagos`, sin implementar todavía conexiones reales de WhatsApp, credenciales, IA productiva ni pagos reales.

La decisión técnica es separar el proyecto en capas independientes:

- Núcleo interno de pedidos WhatsApp/Sofía.
- Página pública segura de pago por token.
- Pagos manuales rápidos.
- Panel operador.
- Adapter de proveedores de pago.
- Webhooks idempotentes.
- Agente Sofía sandbox.
- Integración Hermes/WhatsApp controlada.
- Multimedia, audio y ventas avanzadas.
- Aprendizaje supervisado.
- Hardening para producción/hora pico.

La primera implementación real recomendada debe ser Fase 1: núcleo de pedidos WhatsApp/Sofía, sin WhatsApp real, sin IA real y sin pagos reales.

## 2. Visión completa

El cliente debe conversar por WhatsApp, recibir un link seguro, abrir `2x1burger.co/pagos/{token}`, ver su pedido precargado, elegir método de pago y confirmar.

El operador debe ver el pedido, pago, trazabilidad, estado, evidencia manual si aplica, y poder enviar a preparación sin romper POS, caja, stock, delivery ni checkout.

Principio rector:

> Simple para el cliente, robusto para el operador.

## 3. Arquitectura general

Capas propuestas:

- Canal: WhatsApp/Hermes, web pública `/pagos`, panel operador.
- Orquestación: SofiaConversationService, WhatsappOrderService, PaymentLinkService.
- Dominio: SofiaOrderDraft, WhatsappDeliveryOrder, PaymentIntent, PaymentEvent.
- Integraciones: HermesAdapter, PaymentProviderAdapter, BoldPaymentProvider, MockPaymentProvider.
- Operación: OperatorPaymentsPanel, SofiaPanel, audit trail, payment timeline.
- Core existente: Orders, Delivery, Sales, Cash, Products, Inventory, Settings, Users/Auth.

Reglas:

- Sofía no calcula stock ni precios finales por su cuenta.
- Backend conserva la fuente de verdad.
- Pagos online solo marcan `PAID` con evidencia validada del provider.
- Nequi manual nunca marca pagado automáticamente.
- Efectivo queda como recaudo pendiente contra entrega.
- WhatsApp real se habilita solo con flag de entorno y modo controlado.
- Credenciales y secrets viven fuera del código.

## 4. Diagrama lógico textual

```text
Cliente WhatsApp
  -> Hermes/WhatsApp Adapter
  -> WhatsappConversation
  -> Sofia Agent Sandbox/Controlled
  -> SofiaOrderDraft
  -> Backend Product/Stock/Combo Query
  -> WhatsappDeliveryOrder
  -> PaymentLinkService
  -> 2x1burger.co/pagos/{token}
  -> PaymentIntent
     -> CashProvider
     -> ManualNequiProvider
     -> MockPaymentProvider
     -> BoldPaymentProvider
  -> PaymentEvent/Webhook
  -> Operator Payments Panel
  -> Order/Delivery preparation
  -> POS/Cash/Stock integration gates
```

## 5. Fases

### Fase 0 — Arquitectura general

Objetivo: definir arquitectura, límites, riesgos, estados y decisión de integración.

No implementa código productivo.

Entregables:

- Documento de arquitectura.
- Estados de conversación, pedido y pago.
- Modelo conceptual.
- Dependencias.
- Gates GO/NO-GO.

GO: arquitectura ejecutable por fases y sin mezclar WhatsApp, IA y pagos reales.

### Fase 1 — Núcleo de pedidos WhatsApp/Sofía

Objetivo: crear la base interna para pedidos originados por WhatsApp/Sofía.

Sin WhatsApp real, sin IA real y sin pagos reales.

Modelos propuestos:

- `WhatsappConversation`
- `WhatsappMessage`
- `SofiaOrderDraft`
- `WhatsappDeliveryOrder`
- `SofiaOrderItemSnapshot`
- `SofiaCustomerSnapshot`
- `SofiaDeliverySnapshot`

APIs propuestas:

- `POST /sofia/order-drafts`
- `GET /sofia/order-drafts/:id`
- `PATCH /sofia/order-drafts/:id`
- `POST /sofia/order-drafts/:id/confirm`
- `POST /sofia/mock-conversations`

Pantallas:

- Panel interno mínimo para crear/ver draft mock.
- Vista operador read-only de pedido Sofía.

Tests:

- Crear draft.
- Agregar ítems con productos reales.
- Rechazar productos inactivos/sin stock.
- Confirmar draft.
- Asociar delivery snapshot.

GO: backend puede crear pedido WhatsApp/Sofía desde mock/admin y asociarlo a delivery sin afectar POS.

### Fase 2 — Página pública `2x1burger.co/pagos`

Objetivo: implementar ruta pública segura `/pagos/[token]`.

Modelos propuestos:

- `PaymentLink`
- `PaymentSession`
- `PaymentTokenAudit`

APIs propuestas:

- `POST /payment-links`
- `GET /public/payments/:token`
- `POST /public/payments/:token/select-method`
- `POST /public/payments/:token/confirm`

Pantallas:

- `/pagos/[token]`
- Pedido precargado.
- Métodos disponibles.
- Estado del pago.

Reglas:

- Sin login.
- Token aleatorio, expiración y rate limit.
- No pedir datos repetidos.
- No mostrar datos internos.

GO: cliente abre link y ve pedido listo para pagar.

### Fase 3 — Pagos manuales rápidos

Objetivo: habilitar efectivo contra entrega y Nequi manual.

Modelos propuestos:

- `PaymentIntent`
- `PaymentMethodSelection`
- `ManualPaymentReview`

Estados:

- `CASH_ON_DELIVERY`
- `PENDING_MANUAL_VERIFICATION`
- `PAID`
- `FAILED`
- `MANUAL_REVIEW`

APIs:

- `POST /public/payments/:token/cash`
- `POST /public/payments/:token/nequi-manual`
- `PATCH /operator/payments/:id/manual-status`

GO: cliente elige efectivo o Nequi manual; operador controla estado.

### Fase 4 — Panel operador de pagos WhatsApp

Objetivo: controlar pedidos y pagos de Sofía.

Pantallas:

- Cola de pagos WhatsApp.
- Detalle de pedido/pago.
- Timeline de eventos.
- Acciones operativas.

Acciones:

- Marcar pagado.
- Marcar fallido.
- Enviar a revisión.
- Cambiar método.
- Copiar link.
- Reenviar link.
- Enviar a preparación.

GO: operador controla pagos manuales y trazabilidad.

### Fase 5 — Adapter de pago online provider-ready

Objetivo: crear capa desacoplada de proveedores.

Providers:

- `MockPaymentProvider`
- `ManualNequiProvider`
- `CashProvider`
- `BoldPaymentProvider` preparado, sin credenciales reales.

Interfaces:

- `createIntent`
- `getIntent`
- `cancelIntent`
- `verifyWebhook`
- `mapProviderStatus`

GO: pago online preparado con mock seguro y estructura lista para Bold.

### Fase 6 — Webhooks e indicadores de pago real

Objetivo: preparar confirmación automática de pagos online.

Modelos:

- `PaymentWebhookEvent`
- `PaymentProviderEvent`
- `PaymentReconciliationIssue`

Reglas:

- Firma válida.
- Monto exacto.
- Referencia exacta.
- Idempotencia.
- No duplicar eventos.
- `PAID` automático solo con evidencia válida.

GO: webhook mock/real actualiza pago sin duplicar ni corromper datos.

### Fase 7 — Sofía agente conversacional controlado

Objetivo: crear Sofía sandbox/controlada.

Capacidades:

- Consultar productos reales.
- Consultar combos reales.
- Consultar bebidas reales.
- Consultar stock.
- Validar horario 5:00 p.m. a 12:00 a.m.
- Entender mala ortografía.
- Armar pedido.
- Confirmar pedido.
- Generar link `/pagos`.
- Upsell controlado.
- Escalar a humano.

GO: Sofía toma pedido en sandbox y genera link `/pagos`.

### Fase 8 — Integración Hermes / WhatsApp

Objetivo: conectar Sofía con WhatsApp vía Hermes en modo controlado.

Modelos:

- `HermesInboundMessage`
- `HermesOutboundMessage`
- `WhatsappDeliveryReceipt`
- `HumanHandoffSession`

Reglas:

- No enviar mensajes reales sin flag habilitado.
- Handoff humano siempre disponible.
- Retries e idempotencia.
- Logs sin secretos.

GO: Sofía atiende WhatsApp de forma controlada.

### Fase 9 — Imágenes, audio y ventas avanzadas

Objetivo: mejorar conversión sin inventar datos.

Capacidades:

- Imágenes de combos activos.
- Envío de imágenes.
- Audio transcrito.
- Confirmación si baja confianza.
- Upsell.
- Recuperación de pedidos abandonados.
- Respuesta a objeciones.

GO: Sofía mejora ventas con contenido real y validado.

### Fase 10 — Aprendizaje supervisado

Objetivo: mejora continua con revisión humana.

Modelos:

- `SofiaFeedback`
- `SofiaConversationLabel`
- `SofiaPromptVersion`
- `SofiaKnowledgeItem`
- `SofiaCorrection`

Reglas:

- No auto fine-tuning sin aprobación.
- Versionado de prompts.
- Cambios auditables.

GO: Sofía aprende con revisión humana y versiones controladas.

### Fase 11 — Hardening producción y hora pico

Objetivo: preparar operación real.

Validaciones:

- Rate limits.
- Fallback DeepSeek.
- Fallback Hermes.
- Fallback provider pago.
- Duplicados.
- Pagos duplicados.
- Pedidos incompletos.
- Stock real.
- Caja.
- Delivery.
- Logs.
- Auditoría.
- Seguridad.
- Monitoreo.

GO: sistema listo para operación controlada en hora pico.

## 6. Dependencias entre fases

```text
Fase 0
  -> Fase 1
    -> Fase 2
      -> Fase 3
        -> Fase 4
          -> Fase 5
            -> Fase 6
    -> Fase 7
      -> Fase 8
        -> Fase 9
          -> Fase 10
All -> Fase 11
```

Dependencias críticas:

- Fase 2 depende de Fase 1 porque necesita pedido precargado.
- Fase 3 depende de Fase 2 porque el cliente elige método en `/pagos`.
- Fase 4 depende de Fase 3 porque el operador debe validar manuales.
- Fase 5 puede iniciar después de Fase 3, pero no debe activar pagos reales.
- Fase 6 depende de Fase 5.
- Fase 7 depende de Fase 1 y catálogo/stock real.
- Fase 8 depende de Fase 7.
- Fase 11 depende de evidencia de todas las fases previas.

## 7. Modelos propuestos por fase

Fase 1:

- `WhatsappConversation`
- `WhatsappMessage`
- `SofiaOrderDraft`
- `SofiaOrderItemSnapshot`
- `WhatsappDeliveryOrder`

Fase 2:

- `PaymentLink`
- `PaymentSession`
- `PaymentTokenAudit`

Fase 3:

- `PaymentIntent`
- `ManualPaymentReview`
- `PaymentStatusEvent`

Fase 5:

- `PaymentProviderConfig`
- `PaymentProviderIntent`

Fase 6:

- `PaymentWebhookEvent`
- `PaymentReconciliationIssue`

Fase 8:

- `HermesMessage`
- `HumanHandoffSession`

Fase 10:

- `SofiaFeedback`
- `SofiaPromptVersion`
- `SofiaKnowledgeItem`

## 8. APIs propuestas por fase

Fase 1:

- `POST /sofia/order-drafts`
- `PATCH /sofia/order-drafts/:id`
- `POST /sofia/order-drafts/:id/confirm`

Fase 2:

- `GET /public/payments/:token`
- `POST /public/payments/:token/confirm`

Fase 3:

- `POST /public/payments/:token/cash`
- `POST /public/payments/:token/nequi-manual`
- `PATCH /operator/payments/:id/manual-status`

Fase 4:

- `GET /operator/whatsapp-payments`
- `GET /operator/whatsapp-payments/:id`
- `POST /operator/whatsapp-payments/:id/send-to-preparation`

Fase 5:

- `POST /payments/provider-intents`
- `GET /payments/provider-intents/:id`

Fase 6:

- `POST /webhooks/payments/bold`
- `POST /webhooks/payments/mock`

Fase 7:

- `POST /sofia/sandbox/messages`
- `POST /sofia/sandbox/order-confirmation`

Fase 8:

- `POST /hermes/inbound`
- `POST /hermes/outbound/test`

## 9. Pantallas propuestas por fase

Fase 1:

- Panel interno de drafts Sofía.

Fase 2:

- `/pagos/[token]`.

Fase 4:

- Panel operador de pagos WhatsApp.
- Detalle del pedido Sofía.

Fase 7:

- Panel Sofía sandbox.

Fase 10:

- Panel de feedback, etiquetas y correcciones.

Fase 11:

- Dashboard de salud operacional Sofía/WhatsApp/pagos.

## 10. Tests por fase

Fase 1:

- Crea draft.
- Valida producto real.
- Rechaza producto inactivo.
- Rechaza stock insuficiente si aplica.
- Confirma pedido y conserva snapshots.

Fase 2:

- Token válido abre pedido.
- Token vencido bloquea.
- Token inválido no filtra datos.
- Mobile layout.

Fase 3:

- Efectivo contra entrega queda pendiente.
- Nequi manual queda pendiente de verificación.
- Operador marca pagado.
- Operador marca fallido.

Fase 4:

- Panel lista pagos.
- Acciones cambian estado.
- Timeline auditable.

Fase 5:

- Mock provider genera intent.
- Provider adapter no filtra credenciales.
- Bold provider no se activa sin config.

Fase 6:

- Webhook idempotente.
- Firma inválida rechazada.
- Monto inconsistente -> `MANUAL_REVIEW`.

Fase 7:

- Sofía consulta productos reales.
- Sofía no inventa combos.
- Sofía respeta horario.
- Sofía genera link.

Fase 8:

- Mensaje entrante crea conversación.
- Respuesta saliente no se envía en modo disabled.
- Handoff humano.

Fase 11:

- Rate limits.
- Reintentos.
- Duplicados.
- Caídas de providers.

## 11. Riesgos por fase

- Fase 1: modelo demasiado acoplado a orders existentes.
- Fase 2: token público inseguro.
- Fase 3: operador puede marcar pago sin evidencia suficiente.
- Fase 4: acciones sin auditoría.
- Fase 5: acoplamiento directo a Bold.
- Fase 6: webhook duplicado o spoofing.
- Fase 7: Sofía inventa precios, stock o combos.
- Fase 8: envío accidental de WhatsApp real.
- Fase 9: audio mal transcrito genera pedido incorrecto.
- Fase 10: aprendizaje sin revisión degrada calidad.
- Fase 11: hora pico expone duplicados, latencia o caídas.

## 12. Seguridad

Requisitos:

- Nunca guardar llaves en código.
- Nunca exponer provider secrets al frontend.
- Token de `/pagos` con alta entropía y expiración.
- Rate limit en `/pagos` y webhooks.
- Webhook con firma y replay protection.
- Payment events idempotentes.
- Auditoría de cambios manuales.
- Separar `PAID_BY_PROVIDER` de `PAID_MANUAL`.
- Logs sin payloads sensibles.
- Roles para panel operador.
- Handoff humano auditado.
- Configuración de Nequi/Bold desde settings seguros/env, no hardcode.

## 13. Criterios GO/NO-GO

GO por fase solo si:

- Alcance cerrado.
- Tests críticos PASS.
- No hay secrets.
- No se rompe POS/Caja/Stock/Checkout/Delivery/Waiter.
- Estados y auditoría claros.
- Operador puede intervenir.

NO-GO si:

- Se mezclan WhatsApp real, IA real y pagos reales en una sola fase.
- Sofía inventa datos.
- Pago se marca `PAID` sin evidencia.
- Webhook no es idempotente.
- Token público filtra información.
- Se exponen llaves.
- Se rompe operación actual.

## 14. Orden recomendado de ejecución

1. Fase 1: núcleo de pedidos WhatsApp/Sofía.
2. Fase 2: `/pagos/[token]`.
3. Fase 3: efectivo y Nequi manual.
4. Fase 4: panel operador.
5. Fase 5: adapter de pagos.
6. Fase 6: webhooks.
7. Fase 7: Sofía sandbox.
8. Fase 8: Hermes/WhatsApp controlado.
9. Fase 9: imágenes/audio/ventas.
10. Fase 10: aprendizaje supervisado.
11. Fase 11: hardening producción.

## 15. Qué NO debe implementarse todavía

- WhatsApp real.
- Credenciales reales de Hermes.
- Credenciales reales de Bold.
- Cobros reales.
- Webhooks públicos reales sin firma.
- DeepSeek productivo enviando mensajes reales.
- Fine-tuning automático.
- Auto `PAID` para Nequi manual.
- Cualquier cálculo de precio en frontend.
- Cualquier impacto directo sobre caja sin conciliación.
- Cualquier pedido que descuente stock antes del estado correcto.

## 16. Próximo prompt recomendado para Fase 1

```text
EJECUTA CODEX-SOFIA-WHATSAPP-ORDER-CORE-1 — NÚCLEO INTERNO DE PEDIDOS SOFÍA/WHATSAPP SIN WHATSAPP REAL, SIN IA REAL Y SIN PAGOS REALES.

Objetivo:
Implementar modelos, servicios, APIs y tests para crear y confirmar drafts de pedidos originados por Sofía/WhatsApp usando productos reales, snapshots de cliente/domicilio/items/totales y source WHATSAPP/SOFIA, sin conectar proveedores externos.

Reglas:
NO WhatsApp real.
NO DeepSeek real.
NO pagos reales.
NO credenciales.
NO romper POS/Caja/Stock/Checkout/Delivery/Waiter.
Backend como fuente de verdad.
Tests obligatorios.
```

## Tabla 1: Fases

| Fase | Objetivo | Entregable | Dependencias | Riesgo | Criterio GO |
|---|---|---|---|---|---|
| 0 | Arquitectura general | Documento maestro | Ninguna | Diseño incompleto | Fases claras y ejecutables |
| 1 | Núcleo pedidos Sofía/WhatsApp | Drafts y pedidos mock | Fase 0 | Acoplamiento | Pedido mock asociado a delivery |
| 2 | `/pagos/[token]` | Página pública segura | Fase 1 | Token inseguro | Pedido visible por token válido |
| 3 | Pagos manuales | Efectivo y Nequi manual | Fase 2 | Falso pagado | Operador valida manual |
| 4 | Panel operador | Control de pagos/pedidos | Fase 3 | Sin trazabilidad | Acciones auditadas |
| 5 | Adapter pagos | Provider-ready | Fase 3 | Acoplar Bold | Mock y Bold preparado |
| 6 | Webhooks | Confirmación automática | Fase 5 | Duplicados/spoofing | Idempotencia y firma |
| 7 | Sofía sandbox | Agente controlado | Fase 1 | Inventar datos | Pedido sandbox y link |
| 8 | Hermes/WhatsApp | Integración controlada | Fase 7 | Mensajes reales accidentales | Modo controlado |
| 9 | Multimedia/ventas | Imágenes/audio/upsell | Fase 8 | Pedido incorrecto | Confirmación segura |
| 10 | Aprendizaje supervisado | Feedback/versiones | Fase 8 | Aprendizaje no controlado | Revisión humana |
| 11 | Hardening | Hora pico | Todas | Caídas/duplicados | Operación controlada |

## Tabla 2: Componentes

| Componente | Fase donde se implementa | Función | Riesgo |
|---|---:|---|---|
| WhatsappConversation | 1 | Agrupar mensajes y estado | Datos duplicados |
| SofiaOrderDraft | 1 | Pedido editable antes de confirmar | Precios obsoletos |
| WhatsappDeliveryOrder | 1 | Pedido confirmado de origen WhatsApp | Impacto delivery |
| PaymentLink | 2 | Token público de pago | Filtración |
| PaymentIntent | 3/5 | Estado de pago | Falso positivo |
| ManualNequiProvider | 3 | Pago manual pendiente | Validación humana |
| CashProvider | 3 | Efectivo contra entrega | Recaudo pendiente |
| OperatorPaymentPanel | 4 | Control humano | Permisos |
| MockPaymentProvider | 5 | Pruebas sin dinero real | Confundir con real |
| BoldPaymentProvider | 5/6 | Pago online provider-ready | Credenciales/firma |
| HermesAdapter | 8 | WhatsApp bridge | Mensajes reales |
| SofiaAgent | 7 | Conversación controlada | Inventar datos |
| AudioTranscription | 9 | Notas de voz | Baja confianza |
| SofiaFeedback | 10 | Aprendizaje supervisado | Cambios sin revisión |
| Monitoring/Alerts | 11 | Operación hora pico | Ruido o falta de alertas |

## Tabla 3: Estados

| Estado | Tipo | Significado | Fase |
|---|---|---|---:|
| `DRAFT` | Pedido | Pedido en construcción | 1 |
| `CONFIRMED` | Pedido | Cliente confirmó intención | 1 |
| `PAYMENT_LINK_SENT` | Pedido | Link enviado | 2 |
| `EXPIRED` | Link/Pedido | Token o pedido vencido | 2 |
| `CASH_ON_DELIVERY` | Pago | Pago al recibir | 3 |
| `PENDING_MANUAL_VERIFICATION` | Pago | Nequi manual pendiente | 3 |
| `MANUAL_REVIEW` | Pago | Requiere operador | 3/6 |
| `PAID_MANUAL` | Pago | Operador marcó pagado | 3/4 |
| `PAID_PROVIDER` | Pago | Provider confirmó | 6 |
| `FAILED` | Pago | Pago fallido | 3/6 |
| `CANCELLED` | Pedido/Pago | Cancelado | 1/3 |
| `HUMAN_HANDOFF` | Conversación | Sofía escaló a operador | 7/8 |
| `PREPARATION_READY` | Operación | Listo para cocina/POS | 4 |

## Tabla 4: Integraciones

| Integración | Fase | Requisito | Estado esperado |
|---|---:|---|---|
| POS/Orders | 1 | No romper checkout | Read/controlled write |
| Delivery | 1 | Snapshot domicilio | Integrado sin Google nuevo |
| `/pagos` web | 2 | Token seguro | Público protegido |
| Nequi manual | 3 | Configuración operador | Manual-only |
| Cash on delivery | 3 | Recaudo pendiente | Manual/caja posterior |
| Bold | 5/6 | Adapter + webhook | Provider-ready |
| Hermes | 8 | Inbound/outbound | Controlado por flag |
| DeepSeek/Sofía | 7 | Agente sandbox | Sin mensajes reales |
| Audio/transcripción | 9 | Confianza mínima | Confirmación humana |
| Monitoreo | 11 | Métricas y alertas | Producción-ready |

## Decisión final

CODEX-SOFIA-PAYMENTS-WHATSAPP-MASTER-PHASED-PLAN-0: GO

Justificación:

- El proyecto queda dividido en fases profesionales.
- Cada fase tiene alcance cerrado.
- IA, WhatsApp y pagos reales no se mezclan.
- Hay estados, APIs, modelos, pantallas, tests y riesgos.
- El operador humano queda contemplado.
- La primera implementación real queda claramente definida como Fase 1.
