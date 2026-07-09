# SOFIA-MASTER-ARCHITECTURE-AUDIT-0

## 1. Resumen ejecutivo

Auditoría maestra ejecutada en modo solo auditoría sobre el sistema Sofía del workspace `/home/wundah/inventario`. No se modificaron módulos de aplicación, endpoints, modelos, POS, Domicilios, pagos, Caja, Stock, Checkout, WhatsApp real, QR, DeepSeek real ni auto-respuesta.

Estado real: Sofía ya tiene una base técnica amplia: agente sandbox, catálogo visual mínimo, SafetyGuard, provider IA backend-only, pagos protegidos, outbox WhatsApp, deduplicación, conversación supervisada y operación de pedidos en POS/Domicilios. La brecha principal para la visión final no es "conectar más cosas", sino consolidar cerebro comercial, prompt maestro, catálogo canónico, memoria persistente útil, Auto Safe Engine explícito, QR Gateway dedicado y panel enterprise real.

Decisión recomendada: ejecutar primero cerebro/prompt/catálogo/memoria antes del QR Gateway real. Conectar QR antes de que Sofía venda bien y tenga auto_safe explícito aumenta el riesgo operativo y comercial.

## 2. Visión final auditada

Sofía debe ser una vendedora automática inteligente por WhatsApp QR, con DeepSeek como motor de interpretación/redacción, validada por SafetyGuard y datos reales, con operación de pedidos en POS/Domicilios y pagos protegidos. El QR Gateway debe ser canal técnico únicamente: no interpreta, no decide, no vende, no crea pedidos y no marca pagos.

## 3. Estado real actual

- Backend Sofía existe en `apps/api/src/modules/sofia`.
- Canal WhatsApp Sofía provider-ready existe en `apps/api/src/modules/sofia/whatsapp`.
- WhatsApp interno QR legacy existe separado en `apps/api/src/modules/whatsapp`.
- DeepSeek provider-ready existe, pero queda seguro por defecto y sin API key real obligatoria.
- POS/Domicilios reciben y operan pedidos Sofía con chip/estado/método de pago.
- Pagos manuales y online mock/provider-ready están separados de Caja/Stock/Checkout.
- `/sofia` existe como panel de gobierno/monitoreo parcial, pero no es aún panel enterprise final de prompt, memoria, catálogo, QR y auto_safe.

## 4. Lo que sí tenemos

- `SofiaAgentService` con reglas, normalización, intents, drafts, confirmación y creación de pedidos operativos.
- `SofiaAIProviderAdapter`, `RulesAIProvider`, `DeepSeekAIProvider`, `NullAIProvider` y `SofiaSafetyGuard`.
- Catálogo visual mínimo de 4 ofertas en `sofia-featured-offers.ts` y placeholders reales en `/uploads/sofia-offers/`.
- Modelos persistentes para conversaciones, mensajes, drafts, pedidos, eventos de pago, eventos inbound y outbox.
- `WhatsappProviderAdapter`, `MockWhatsappProvider`, `HermesWhatsappProvider`, `NullWhatsappProvider`.
- Webhook inbound Sofía con deduplicación y modos `disabled`, `mock`, `receive_only`, `supervised`, `auto`.
- Outbox con idempotencia, aprobación, cancelación, retry y handoff por fallo.
- `/pagos/[token]`, pagos manuales, online mock y webhooks idempotentes.
- E2E y tests críticos para Sofía, pagos, WhatsApp, DeepSeek, POS/Domicilios y checkout/caja.

## 5. Lo que no tenemos

- QR Gateway Sofía dedicado y conectado al ciclo inbound/outbound del agente.
- Prompt maestro versionado, editable, aprobable y auditable desde panel.
- Memoria persistente comercial resumida por cliente para uso activo de Sofía.
- Catálogo comercial canónico único con composición completa, adicionales y reglas comerciales en backend/DB.
- Auto Safe Engine explícito que decida cuándo Sofía puede enviar sin humano.
- Panel enterprise final para QR, prompt, catálogo, memoria, readiness, kill-switch, métricas y aprendizaje.
- DeepSeek real configurado con API key de producción.
- Fase piloto real por allowlist con métricas y rollback.

## 6. Lo incompleto

- DeepSeek está provider-ready, pero el prompt está en código y no como prompt maestro versionado.
- SafetyGuard bloquea riesgos críticos, pero no existe como motor completo de aprobación auto_safe.
- Memoria existe como conversación/draft/mensajes, pero no como perfil/resumen reutilizable por cliente.
- Catálogo visual está definido como constante y fallback frontend; falta fuente comercial única y editable.
- `/sofia` muestra gobierno y readiness, pero no permite gestionar todo el ciclo enterprise.

## 7. Lo mal nombrado o conceptualmente ambiguo

- `HermesWhatsappProvider` debe entenderse como provider/gateway legacy, no como Hermes Agent.
- `apps/api/src/modules/whatsapp` ya usa QR/Baileys para WhatsApp interno, pero no es el QR Gateway de Sofía.
- `WhatsappDeliveryOrder` conserva nombre WhatsApp aunque funcionalmente representa pedido Sofía operativo enlazado a `OrderTicket`.
- `/sofia/conversations` controla conversaciones, no debe evolucionar a panel operativo de pedidos.

## 8. Auditoría cerebro Sofía

| Capacidad | Existe | Cómo está implementada | Brecha frente a visión final | Prioridad |
|---|---:|---|---|---|
| Intents básicos | Sí | `SofiaIntent` local en `SofiaAgentService` | Falta comprensión IA real estable con prompt maestro | P1 |
| Mala ortografía | Sí | Regex/normalización local | Cobertura limitada | P2 |
| Consulta productos reales | Sí | `prisma.product.findMany({ isActive: true })` | Falta catálogo comercial con composición oficial | P0 |
| Drafts | Sí | `SofiaOrderDraft` | Falta memoria por cliente y continuidad avanzada | P1 |
| Pedido operativo | Sí | Crea `WhatsappDeliveryOrder` y `OrderTicket` | Mantener POS/Domicilios como único flujo operativo | P0 |
| Horario | Sí | 17:00 a 24:00 America/Bogota | Debe parametrizarse en panel enterprise | P2 |
| Conversación natural | Parcial | Reglas + respuesta corta + AI suggest | Falta prompt maestro y DeepSeek real | P0 |
| Auto safe | Parcial | Modo auto protegido por flags/confidence | Falta motor explícito con matriz de decisión | P0 |
| Explicar qué trae cada producto | Parcial | Ofertas principales y Maxi Family | Falta composición completa de todos los productos | P0 |

## 9. Auditoría DeepSeek / IA

| Componente IA | Estado actual | Riesgo | Falta para visión final | Acción recomendada |
|---|---|---|---|---|
| `SofiaAIProviderAdapter` | Existe | Bajo | Contrato suficientemente claro | Conservar |
| `DeepSeekAIProvider` | Provider-ready backend-only | Medio | API key real y prompt maestro | Activar solo tras catálogo/prompt/memoria |
| `RulesAIProvider` | Fallback estable | Bajo | No conversa naturalmente | Mantener como fallback |
| `NullAIProvider` | Seguro | Bajo | Ninguna | Conservar |
| Prompt DeepSeek | En código | Alto | Versionado, tests de regresión, edición controlada | Fase prompt maestro |
| Schema JSON | Existe | Medio | Validaciones más estrictas por campo | Endurecer |
| Redacción PII | Existe parcial | Medio | Política completa de logs/memoria | Fase hardening |
| Health/status | Existe | Bajo | Persistencia histórica de health/fallbacks | Panel enterprise |

## 10. Auditoría prompt

| Aspecto del prompt | Existe | Calidad | Riesgo | Recomendación |
|---|---:|---|---|---|
| Personalidad Sofía | Parcial | Básica | Respuestas inconsistentes | Crear prompt maestro |
| Reglas Maxi Family | Sí | Buena | Debe protegerse en futuras ediciones | Versionar y testear |
| Prohibición de inventar | Sí | Buena | Depende de SafetyGuard | Mantener y duplicar en guard |
| Salida JSON | Sí | Buena | Falta schema runtime fuerte | Validar con zod/io-ts |
| Ventas/upsell | Parcial | Básica | Puede no cerrar ventas bien | Expandir prompt comercial |
| Memoria | No real | Baja | No permite continuidad | Diseñar memoria persistente |
| Edición desde panel | No | N/A | Bloquea operación enterprise | Implementar workflow de prompt |
| Versionado | No | N/A | Sin rollback | Agregar `SofiaPromptVersion` |

## 11. Auditoría catálogo comercial

| Producto/Regla | Datos actuales | Falta | Riesgo | Acción |
|---|---|---|---|---|
| Maxi Family | Constante oficial con imagen | Producto/costo/composición canónica en DB | Alto si se duplica | Centralizar |
| 2x1 Hamburguesas | Oferta visual y `linkedProductName` | Composición oficial y precio enlazado | Medio | Centralizar |
| Doble Todo | Oferta visual | Link a producto real | Medio | Centralizar |
| Hamburguesa Sencilla | Oferta visual | Link a producto real | Medio | Centralizar |
| Papitas | Producto puede existir en catálogo real | Reglas de upsell/composición | Medio | Catálogo comercial |
| Bebidas | Productos reales | Reglas de recomendación | Medio | Catálogo comercial |
| Adiciones | Productos reales probables | Semántica de adición | Medio | Catálogo comercial |
| Imágenes | 4 imágenes oficiales existen | Gestión/validación desde panel | Bajo | Panel enterprise |

Regla Maxi Family vigente: `6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L`. Los textos prohibidos aparecen solo como lista de protección o tests negativos, no como respuesta comercial permitida.

## 12. Auditoría memoria persistente

| Dato de memoria | Existe | Persistente | Usado por Sofía | Falta | Riesgo |
|---|---:|---:|---:|---|---|
| Teléfono | Sí | Sí | Sí | Perfil consolidado | Medio |
| Nombre | Sí | Sí | Sí | Preferencias | Medio |
| Dirección | Sí en draft/order | Sí | Parcial | Dirección por cliente | Alto |
| Último pedido | Indirecto | Sí | No | Query semántica "lo mismo de ayer" | Alto |
| Pedido actual | Sí | Sí | Sí | Caducidad/recuperación más fina | Medio |
| Método de pago | Sí en pedido | Sí | Parcial | Preferencia por cliente | Medio |
| Resumen de conversación | No | No | No | `SofiaConversationMemory` | Alto |
| Consentimiento/retención | No visible | No | No | Política de datos | Alto |

## 13. Auditoría SafetyGuard

| Protección | Existe | Bloquea | Corrige | Escala humano | Estado |
|---|---:|---:|---:|---:|---|
| Producto inexistente | Sí | Sí | No | Sí | Bueno |
| Precio inventado | Sí | Sí | Reemplaza por real si coincide producto | Sí | Bueno |
| IA marca PAID | Sí | Sí | Respuesta segura | No siempre | Bueno |
| Acciones críticas IA | Sí | Sí | No | Parcial | Bueno |
| Maxi Family | Sí | Sí | Sí | No | Bueno |
| Baja confianza | Sí | Sí | No | Sí | Parcial |
| Auto safe | Parcial | Parcial | Parcial | Sí | Falta motor explícito |

## 14. Auditoría WhatsApp / Hermes legacy / QR

| Componente WhatsApp | Estado actual | Usable para QR | Riesgo | Acción |
|---|---|---:|---|---|
| `apps/api/src/modules/sofia/whatsapp` | Provider adapter mock/hermes/null | Parcial | Hermes no es QR | Conservar como gateway provider-ready |
| `HermesWhatsappProvider` | HTTP provider con firma/env | No directo | Nombre puede confundir con Hermes Agent | Renombrar concepto futuro |
| `MockWhatsappProvider` | Tests/E2E | Sí para pruebas | Bajo | Conservar |
| `SofiaWhatsappService` | Inbound, dedup, outbox, modes | Sí como orquestador | Auto aún no auto_safe completo | Integrar QR futuro aquí |
| `apps/api/src/modules/whatsapp` | QR/Baileys interno para recibos/cierre | Referencia técnica | Mezclar con Sofía rompería límites | Auditar antes de reutilizar |
| QR Gateway Sofía | No existe | No | P0 si se conecta improvisado | Crear fase separada |
| Hermes Agent Hostinger | No requerido | No | No usar | Mantener fuera |

Conclusión: Hermes en código es legacy/provider/gateway, no agente IA. No se debe usar Hermes Agent de Hostinger.

## 15. Auditoría outbox

| Elemento outbox | Estado actual | Sirve para auto_safe | Falta | Riesgo |
|---|---|---:|---|---|
| `WhatsappOutboundMessage` | Persistente con status/attempts/idempotency | Sí | Políticas auto_safe explícitas | Medio |
| `APPROVAL_PENDING` | Existe | Sí | SLA/métricas | Bajo |
| `QUEUED/SENT/FAILED/RETRYING` | Existe | Sí | Worker dedicado si escala | Medio |
| Dedup outbound | Idempotency key por inbound/respuesta | Sí | TTL/limpieza | Bajo |
| Auto | Existe por modo/flag/confidence | Parcial | Safety decision record | Alto |
| Retry | Existe on-demand/servicio | Parcial | Scheduler robusto | Medio |

## 16. Auditoría pedidos Sofía / POS / Domicilios

| Flujo pedido | Estado actual | Riesgo | Falta | Acción |
|---|---|---|---|---|
| Draft | Funcional | Datos incompletos si catálogo débil | Memoria y validaciones comerciales | Mantener |
| Confirmación | Requiere campos mínimos | Horario/config hardcode | Reglas editables | Mejorar |
| Pedido operativo | Crea `OrderTicket` delivery | Bajo | Mantener separación | Conservar |
| POS/Domicilios | Muestran chip/estado/método | Bajo | Más métricas | Conservar |
| Caja/Stock/Checkout | No afectados por Sofía hasta flujo normal | Bajo | Pruebas regresión continuas | Conservar |

## 17. Auditoría pagos en conversación

| Pago | Estado actual | WhatsApp puede usarlo | Riesgo | Acción |
|---|---|---:|---|---|
| Link `/pagos/[token]` | Implementado | Sí, enviando URL | Bajo | Conservar |
| Efectivo | Cliente elige, operador recauda | Sí | No debe marcar PAID por WhatsApp | Conservar |
| Nequi manual | Pendiente verificación | Sí | Confusión con comprobantes | Mejorar copy |
| Online mock/provider-ready | Implementado | Sí si settings lo permiten | No activar real sin provider | Conservar |
| Webhooks | Idempotentes | No desde WhatsApp | Bajo | Conservar |
| PAID | Solo operador/webhook válido | No | Crítico si se relaja | Mantener bloqueado |

## 18. Auditoría panel `/sofia`

| Ruta | Estado actual | Responsabilidad final | Brecha | Acción |
|---|---|---|---|---|
| `/sofia` | Gobierno/readiness parcial | Panel enterprise | Falta edición prompt/catálogo/memoria/QR/auto_safe | Fase panel enterprise |
| `/sofia/conversations` | Control técnico de conversaciones | Inbox/handoff/aprobaciones | Falta integración con QR real | Conservar y extender |
| `/sofia/sandbox` | Sandbox comercial/IA/multimedia | Pruebas y QA comercial | Falta persistir casos aprobados | Conservar y extender |
| POS/Domicilios links | Existen | Operación real | Correcto | Conservar |

## 19. Auditoría seguridad

| Riesgo seguridad | Evidencia | Severidad | Acción |
|---|---|---|---|
| Secretos reales en `.env` y backups | `security-grep.log` detectó JWT, Google Maps y OpenRouteService con valores reales. Valores no replicados aquí. | P0 | Rotar, sacar backups del repo/workspace compartido, limpiar logs sensibles |
| Variables sensibles backend-only | `env.ts`, providers IA/Hermes leen env backend | P1 | Mantener, no exponer en frontend |
| QR session path legacy | `WHATSAPP_AUTH_DIR` en módulo WhatsApp interno | P1 | Diseñar storage seguro para QR Gateway Sofía |
| Raw payloads persistidos | `WhatsappMessage.rawPayload`, `WhatsappInboundEvent.rawPayload` | P1 | Redacción/retención para PII |
| Header overrides no prod | Factory bloquea overrides en producción | Bajo | Conservar |
| Panel no muestra API key | E2E verifica ausencia en UI | Bajo | Conservar |

## 20. Auditoría tests

| Gate/Test | Existe | Último estado conocido | Riesgo | Acción |
|---|---:|---|---|---|
| Backend crítico Sofía | Sí | Cubierto en `app.critical.spec.ts` | Bajo | Mantener |
| E2E sandbox | Sí | `sofia-agent-multimedia-sandbox...` | Bajo | Mantener |
| E2E WhatsApp/Hermes | Sí | `sofia-hermes-whatsapp...` | Medio por mock-only | Extender para QR |
| E2E DeepSeek | Sí | Provider guarded/mock | Medio por sin key real | Añadir contract tests |
| E2E pagos | Sí | Payment link/manual/online | Bajo | Mantener |
| E2E POS/Domicilios | Sí | Filtros/chip/acciones | Bajo | Mantener |
| `test.skip` | No encontrado | `test-skip-check.log` vacío | Bajo | Mantener |
| `process.exit(0)` | No encontrado | `process-exit-check.log` vacío | Bajo | Mantener |

## 21. Matriz de brechas

| Componente | Tenemos | No tenemos | Brecha | Prioridad | Fase sugerida |
|---|---|---|---|---|---|
| Cerebro comercial | Reglas + IA suggest | Estrategia comercial completa | Venta limitada | P0 | F1 |
| Prompt maestro | Prompt base en código | Versionado/editable/aprobable | Riesgo al activar DeepSeek | P0 | F1 |
| DeepSeek real | Provider-ready | API key/config real | GO condicionado | P1 | F5 |
| Catálogo comercial | 4 ofertas + productos reales | Composición canónica | Puede vender incompleto | P0 | F1 |
| Memoria persistente | Conversaciones/drafts | Perfil/resumen por cliente | No hay continuidad | P0 | F1 |
| SafetyGuard auto_safe | SafetyGuard parcial | Motor de decisión | Auto riesgoso | P0 | F2 |
| QR Gateway | QR interno legacy | QR Sofía dedicado | No conectar aún | P0 | F4 |
| Inbound QR | Webhook provider-ready | Baileys/QR inbound Sofía | Canal no listo | P1 | F4 |
| Auto-send QR | Outbox + modo auto | Auto Safe Engine | No producción | P0 | F2/F5 |
| Conversations control | `/sofia/conversations` | QR real y SLA | Parcial | P1 | F3/F4 |
| Pedidos | POS/Domicilios integrado | Más reglas catálogo | Sólido | P1 | F1 |
| Pagos | Link/manual/online mock | Conciliación final | Sólido | P2 | F6 |
| Panel enterprise | Gobierno parcial | Editor prompt/catálogo/memoria/QR | Incompleto | P0 | F3 |
| Readiness | Parcial | Readiness production real | Incompleto | P1 | F3 |
| Sandbox comercial | Existe | Casos aprobados persistentes | Parcial | P2 | F6 |
| Piloto real | No | Allowlist, rollback, métricas | Bloqueado | P0 | F5 |
| Métricas | Contadores básicos | Métricas comerciales/IA | Parcial | P2 | F6 |
| Hardening | Tests y guards | PII/secret cleanup/QR storage | P0/P1 | F0/F6 |

## 22. Riesgos P0/P1/P2/P3

| Riesgo | Severidad | Evidencia | Mitigación |
|---|---|---|---|
| Conectar QR antes de cerebro/prompt/catálogo/memoria | P0 | QR Sofía no existe y prompt no es maestro | Ejecutar F1 primero |
| Secretos reales en `.env`/backups | P0 | `security-grep.log` | Rotar y limpiar |
| Auto sin Auto Safe Engine explícito | P0 | Auto depende de modo/flags/confidence | Crear F2 |
| Catálogo duplicado/constante | P1 | Backend constant + frontend fallback | Centralizar |
| Memoria no usada por Sofía | P1 | Solo conversation/draft/order | Crear memoria persistente |
| Hermes naming confuso | P2 | `HermesWhatsappProvider` | Renombrar concepto/documentar |
| Panel enterprise incompleto | P1 | `/sofia` no edita prompt/memoria/QR | F3 |

## 23. Fases recomendadas inteligentes

| Fase propuesta | Objetivo | Dependencia | Prioridad | GO esperado |
|---|---|---|---|---|
| F0 - Saneamiento seguridad | Rotar secretos locales, limpiar backups sensibles y política de logs PII | Ninguna | P0 | Sin secretos vivos en workspace/logs |
| F1 - Cerebro comercial canónico | Prompt maestro, catálogo canónico, composición, memoria persistente | Auditoría actual | P0 | Sofía vende con datos completos sin QR real |
| F2 - Auto Safe Engine | Motor explícito de decisión para auto-respuesta, safety events, dry-run | F1 | P0 | Auto elegible solo con SafetyGuard PASS |
| F3 - Panel enterprise `/sofia` | Editar/ver prompt, catálogo, memoria, safety, readiness, kill-switch | F1/F2 diseño | P0 | Operación enterprise sin tocar pedidos |
| F4 - WhatsApp QR Gateway Sofía | Canal QR técnico dedicado con inbound/outbound mock/receive_only | F1/F2 | P0 | QR conectado sin IA peligrosa |
| F5 - Piloto DeepSeek + QR | DeepSeek real, allowlist, supervised/auto_safe progresivo | F1-F4 | P0 | Piloto real medible y reversible |
| F6 - Aprendizaje, métricas y hardening | Feedback, analytics, prompt versions, retención PII, backups | F5 | P2 | Mejora continua segura |

## 24. Orden recomendado

Opción elegida: A - primero cerebro/prompt/catálogo/memoria.

Justificación: conectar QR antes de tener catálogo canónico, memoria y Auto Safe Engine expone al negocio a respuestas incorrectas en conversaciones reales. El panel enterprise debe editar objetos bien definidos; por eso conviene diseñar primero el cerebro comercial y luego el panel. DeepSeek sigue sin API key real, pero la preparación de prompt/catálogo/memoria no depende de activar llamadas reales.

## 25. Qué NO ejecutar todavía

- No QR real de Sofía todavía.
- No auto-respuesta real.
- No DeepSeek producción con API key hasta tener prompt maestro y Auto Safe Engine.
- No usar Hermes Agent de Hostinger.
- No permitir que WhatsApp/IA marque `PAID`.
- No mover operación de pedidos fuera de POS/Domicilios.
- No usar el módulo WhatsApp interno QR como reemplazo directo sin aislarlo como gateway Sofía.

## 26. Próximo prompt recomendado

`EJECUTA SOFIA-COMMERCIAL-BRAIN-PROMPT-CATALOG-MEMORY-0 — CEREBRO COMERCIAL CANÓNICO DE SOFÍA: PROMPT MAESTRO VERSIONADO, CATÁLOGO COMERCIAL ÚNICO, MEMORIA PERSISTENTE POR CLIENTE Y PREPARACIÓN PARA AUTO_SAFE SIN QR REAL.`

Objetivo: consolidar el cerebro antes de activar canal real: prompt maestro, catálogo con composición/precios/imágenes/adiciones, memoria por cliente/conversación, tests anti-invención y salidas listas para Auto Safe Engine.

## 27. Decisión final

`SOFIA-MASTER-ARCHITECTURE-AUDIT-0: GO`

La auditoría cubrió sistema Sofía completo, DeepSeek, prompt, catálogo, memoria, SafetyGuard, WhatsApp/Hermes legacy/QR, outbox, POS/Domicilios, pagos, panel `/sofia`, seguridad, tests, matriz de brechas y orden inteligente de fases. No se modificó código fuente.

## Tabla 1: Área | Tenemos | No tenemos | Brecha | Prioridad

| Área | Tenemos | No tenemos | Brecha | Prioridad |
|---|---|---|---|---|
| Cerebro Sofía | Reglas + IA suggest + pedidos | Prompt/catálogo/memoria completos | Venta automática incompleta | P0 |
| DeepSeek | Provider backend-only | API key real y prompt maestro | GO condicionado | P1 |
| Prompt | Base en código | Versionado/panel/rollback | No enterprise | P0 |
| Catálogo | 4 ofertas e imágenes | Catálogo comercial canónico | Riesgo de duplicación | P0 |
| Memoria | Conversación/draft/order | Perfil/resumen por cliente | No continuidad | P0 |
| SafetyGuard | Bloqueos críticos | Auto Safe Engine | Auto no listo | P0 |
| WhatsApp/QR | Provider-ready + QR interno legacy | QR Gateway Sofía | No conectar aún | P0 |
| Pedidos | POS/Domicilios | N/A | Correcto | P1 |
| Pagos | Link/manual/online mock | Conciliación final | Sólido | P2 |
| Panel | Gobierno parcial | Enterprise final | Incompleto | P0 |

## Tabla 2: Componente | Estado actual | Riesgo | Acción recomendada

| Componente | Estado actual | Riesgo | Acción recomendada |
|---|---|---|---|
| `SofiaAgentService` | Funcional con reglas e IA suggest | Catálogo/memoria incompletos | Extender cerebro comercial |
| `DeepSeekAIProvider` | Provider-ready | Sin API key y prompt básico | Mantener disabled hasta F1/F2 |
| `SofiaSafetyGuard` | Protege productos/precios/pagos/Maxi | No decide auto_safe completo | Crear Auto Safe Engine |
| `SofiaWhatsappService` | Inbound/outbox/dedup/modes | Auto no production-ready | Conservar y conectar QR luego |
| `apps/api/src/modules/whatsapp` | QR legacy interno | Mezcla conceptual | Reutilizar solo tras aislamiento |
| `/sofia` | Readiness/gobierno parcial | No enterprise final | Rediseñar por dominios |
| `.env`/backups | Contienen secretos reales | P0 | Rotar y limpiar |

## Tabla 3: Fase propuesta | Objetivo | Dependencia | Prioridad | GO esperado

| Fase propuesta | Objetivo | Dependencia | Prioridad | GO esperado |
|---|---|---|---|---|
| F0 Seguridad | Limpiar/rotar secretos | Ninguna | P0 | Sin secretos vivos |
| F1 Cerebro comercial | Prompt, catálogo, memoria | Auditoría | P0 | Sofía vende bien en sandbox |
| F2 Auto Safe Engine | Política auto sin humano | F1 | P0 | Auto seguro validable |
| F3 Panel enterprise | Control prompt/catálogo/memoria/safety | F1/F2 | P0 | `/sofia` enterprise real |
| F4 QR Gateway | WhatsApp QR técnico | F1/F2 | P0 | Canal QR receive_only/mock |
| F5 Piloto real | DeepSeek + QR allowlist | F1-F4 | P0 | Piloto seguro |
| F6 Hardening | Métricas, aprendizaje, PII | F5 | P2 | Producción robusta |

## Tabla 4: Riesgo | Severidad | Evidencia | Mitigación

| Riesgo | Severidad | Evidencia | Mitigación |
|---|---|---|---|
| Secretos reales locales | P0 | `security-grep.log` | Rotar y eliminar backups sensibles |
| QR antes de cerebro | P0 | QR Sofía no existe | Ejecutar F1/F2 antes |
| Auto sin auto_safe | P0 | Auto depende de flags/confidence | Crear motor explícito |
| Catálogo no canónico | P1 | Constante + fallback | Centralizar |
| Memoria insuficiente | P1 | No perfil cliente | Crear memoria persistente |
| Panel incompleto | P1 | No edita prompt/memoria/QR | F3 |

## Tabla 5: Ruta | Estado actual | Responsabilidad final | Acción

| Ruta | Estado actual | Responsabilidad final | Acción |
|---|---|---|---|
| `/sofia` | Gobierno parcial | Panel enterprise | Rediseñar |
| `/sofia/sandbox` | Sandbox comercial | QA y pruebas IA | Conservar/extender |
| `/sofia/conversations` | Inbox/handoff/outbox | Control conversaciones | Conservar/extender |
| `/pagos/[token]` | Público precargado | Pago protegido | Conservar |
| `/deliveries` | Operación real | Domicilios | Conservar |
| `/pos` | Operación real | POS/Caja | Conservar |
