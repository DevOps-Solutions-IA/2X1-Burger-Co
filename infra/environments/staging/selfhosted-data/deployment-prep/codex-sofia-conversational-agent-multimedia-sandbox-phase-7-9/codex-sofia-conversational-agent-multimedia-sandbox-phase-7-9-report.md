# CODEX-SOFIA-CONVERSATIONAL-AGENT-MULTIMEDIA-SANDBOX-PHASE-7-9

## 1. Resumen ejecutivo
Se implementó Sofía como agente conversacional en sandbox, sin WhatsApp real, Hermes real, DeepSeek real ni pagos reales. El agente procesa mensajes simulados, detecta intenciones, consulta productos reales, crea/actualiza drafts, confirma pedidos válidos, genera pedido operativo en Domicilios/POS y genera link `/pagos/[token]` cuando aplica.

Decisión: **GO CONDICIONADO** por dos riesgos P3: multimedia usa imágenes reales solo si existen en catálogo y el comando `api test` reportó PASS pero el runner quedó colgado post-PASS y fue interrumpido.

## 2. Estado recibido
- Fase 0 Plan maestro: GO.
- Fase 1 Núcleo pedidos Sofía/WhatsApp: GO.
- Corrección arquitectura POS/Domicilios: GO.
- Fase 2 `/pagos/[token]`: GO.
- Fase 3 efectivo/Nequi manual: GO.
- Fase 4 operación POS/Domicilios: GO.
- Fase 5/6 adapter/webhooks: disponible y no se activaron pagos reales.

## 3. Alcance Fase 7
Se agregó `SofiaAgentService` para procesar mensajes sandbox, clasificar intención, extraer productos/cantidades, detectar campos faltantes, validar horario, sugerir upsell, generar respuestas y confirmar pedidos operativos.

## 4. Alcance Fase 9
Se preparó multimedia simulada, audio transcrito, upsell seguro, recuperación de pedidos abandonados, objeciones frecuentes básicas y handoff humano. No se envía ningún mensaje real.

## 5. SofiaAgentService
Archivo: `apps/api/src/modules/sofia/sofia-agent.service.ts`.

Responsabilidades:
- Procesar mensaje entrante sandbox.
- Registrar inbound/outbound como `WhatsappMessage`.
- Mantener conversación/draft.
- Consultar productos reales activos.
- Aplicar anti-invención.
- Confirmar pedido y crear `WhatsappDeliveryOrder` operativo.
- Generar link de pago si existe `OrderTicket`.

## 6. Intenciones soportadas
GREETING, ASK_MENU, ASK_COMBO, ASK_PRICE, ORDER_ITEM, ADD_ITEM, REMOVE_ITEM, MODIFY_QUANTITY, ASK_DELIVERY, PROVIDE_ADDRESS, PROVIDE_NAME, PROVIDE_PAYMENT_METHOD, CONFIRM_ORDER, CANCEL_ORDER, ASK_HUMAN, UNKNOWN.

## 7. Normalización de mala ortografía
Se normalizan tildes, signos y variantes como `kiero`, `hamburgesa`, `burger`, `domisilio`, `bale`, `si confirmo`, `dale`.

## 8. Consulta de datos reales
Sofía consulta `Product` activo vía Prisma y usa precio, stock directo, categoría e imagen real si existe. No usa catálogo hardcodeado.

## 9. Reglas anti-invención
Si no detecta producto real o la confianza es insuficiente, responde: “Déjame confirmarlo con el equipo para no darte información incorrecta.” No inventa productos, precios, combos, stock ni promociones.

## 10. Horario
Horario validado: 5:00 p.m. a 12:00 a.m., zona `America/Bogota`, con soporte de hora sandbox para pruebas determinísticas.

## 11. Respuestas sandbox
Respuestas cortas, orientadas a venta y sin lenguaje robótico. La respuesta estructurada incluye intención, confianza, items, faltantes, upsell, media, siguiente acción y safeguards.

## 12. Multimedia/imágenes
Sofía sugiere imagen si el producto activo tiene `imageUrl`; si no, muestra placeholder interno “Imagen pendiente de cargar”.

## 13. Audio transcrito
Se permite `AUDIO_TRANSCRIPT` sin proveedor externo. Con confianza baja, Sofía pide confirmación: “Creo que me pediste... ¿Es correcto?”

## 14. Upsell
Regla segura: sugerir una bebida real si el pedido no contiene bebida. No agrega productos sin confirmación.

## 15. Recuperación de pedidos abandonados
Endpoint sandbox genera mensaje de recuperación para drafts pendientes sin enviar WhatsApp real.

## 16. Objeciones frecuentes
Se cubren rutas básicas: humano, producto desconocido, pago/dirección/confirmación por intención y anti-invención. Objeciones comerciales más profundas quedan para aprendizaje supervisado.

## 17. Handoff humano
`ASK_HUMAN` o baja confianza marca conversación `HUMAN_REQUIRED` y pausa Sofía (`sofiaEnabled=false`).

## 18. UI sandbox
Ruta: `/sofia/sandbox`.

Permite:
- escribir mensaje.
- elegir texto/audio transcrito.
- fijar confianza y hora sandbox.
- ver intención, productos, faltantes, upsell, media, respuesta, link y pedido creado.
- recuperar abandonado.
- ver handoff.

## 19. Creación de pedidos operativos
Cuando el cliente confirma con datos mínimos y horario válido, Sofía confirma draft, crea pedido operativo con `OrderTicket`, genera `WhatsappDeliveryOrder` y link `/pagos/[token]`.

## 20. Integración POS/Domicilios
Los pedidos creados aparecen en Domicilios/POS con chip Sofía por los flujos ya existentes. El panel Sofía no opera pedidos.

## 21. Confirmación no WhatsApp real
No se conectó Hermes ni WhatsApp real. Todo queda en sandbox y registros internos.

## 22. Confirmación no DeepSeek real
No se conectó DeepSeek ni IA real. La fase usa reglas/scoring controlado.

## 23. Confirmación no pagos reales
No se conectaron Bold/Nequi API ni pagos reales. Solo se genera link interno existente y no se marca PAID desde el cliente.

## 24. Confirmación Caja/Stock/Checkout intactos
Tests backend y E2E validaron que no se generan ventas, movimientos de caja ni descuento de stock fuera del flujo actual.

## 25. Tests backend
`pnpm --filter @inventory-fastfood/api test` registró `PASS src/tests/app.critical.spec.ts (291.697 s)`. El proceso quedó colgado post-PASS y fue interrumpido para continuar; queda como riesgo P3 del runner.

## 26. E2E
PASS:
- `sofia-agent-multimedia-sandbox*.spec.ts`
- `sofia-pos-delivery-operations*.spec.ts`
- `sofia-manual-payments*.spec.ts`
- `sofia-payment-link*.spec.ts`
- `phase-delivery-auto-3-checkout-cash-audit.spec.ts`

## 27. Build/typecheck/health
PASS:
- API typecheck.
- API build.
- Web typecheck.
- Web build.
- Docker build api/web.
- Health `/api/health`.

## 28. Screenshots
Generadas 13 capturas en:
`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-conversational-agent-multimedia-sandbox-phase-7-9/`

## 29. Riesgos residuales
- Imágenes reales dependen de `imageUrl` en catálogo.
- Objeciones avanzadas quedan como reglas básicas; se recomienda ampliarlas en aprendizaje supervisado.
- El runner API reporta PASS pero no cerró automáticamente.

## 30. Próxima fase recomendada
Fase 8: Hermes/WhatsApp real con modo sandbox/producción, resiliencia, rate limits, colas, firma de proveedor y handoff humano real.

## 31. Decisión final
**CODEX-SOFIA-CONVERSATIONAL-AGENT-MULTIMEDIA-SANDBOX-PHASE-7-9: GO CONDICIONADO**

## Tabla 1: Componente
| Componente | Cambio | Riesgo | Estado |
|---|---|---:|---|
| SofiaAgentService | Nuevo servicio de agente sandbox | Medio | PASS |
| DTO agent | Mensaje sandbox y recuperación | Bajo | PASS |
| Controller | Endpoints protegidos `agent/process` y `agent/recover-abandoned` | Bajo | PASS |
| UI sandbox | Nueva ruta `/sofia/sandbox` | Bajo | PASS |
| Página pagos | Restaurados testids y copy requerido | Bajo | PASS |
| E2E sandbox | Nuevo spec con screenshots | Bajo | PASS |

## Tabla 2: Intención
| Intención | Ejemplo | Acción Sofía | Estado |
|---|---|---|---|
| GREETING | hola | Saludo y guía | PASS |
| ORDER_ITEM | kiero una hamburgesa | Busca producto real | PASS |
| ASK_MENU | menú | Respuesta controlada | PASS |
| PROVIDE_ADDRESS | Calle 9 # 12-34 | Completa dirección | PASS |
| CONFIRM_ORDER | si confirmo | Crea pedido operativo si faltantes=0 | PASS |
| ASK_HUMAN | quiero hablar con alguien | HUMAN_REQUIRED | PASS |
| UNKNOWN | sushi galáctico | Anti-invención | PASS |

## Tabla 3: Multimedia/Ventas
| Multimedia/Ventas | Función | Resultado | Estado |
|---|---|---|---|
| Imagen producto | Sugiere imagen real si existe | Placeholder si falta imagen | PASS |
| Audio transcrito | Procesa transcript sin proveedor real | Pide confirmación con baja confianza | PASS |
| Upsell | Sugiere bebida real | No agrega sin confirmación | PASS |
| Recuperación | Draft abandonado | Mensaje sandbox generado | PASS |
| Handoff | Baja confianza/humano | Pausa Sofía | PASS |

## Tabla 4: Flujo
| Flujo | Resultado esperado | Resultado final | Estado |
|---|---|---|---|
| Mensaje con errores | Detecta ORDER_ITEM | Detectado | PASS |
| Producto inexistente | No inventa | Anti-invención | PASS |
| Faltan datos | Pregunta solo faltantes | Dirección/nombre solicitados | PASS |
| Confirmación | Pedido en Domicilios/POS | Pedido creado con chip Sofía | PASS |
| Link pago | Generado si OrderTicket existe | `/pagos/[token]` generado | PASS |
| Caja/Stock | Sin efecto lateral | Sin movimientos/ventas/stock | PASS |

## Tabla 5: Gate
| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/codex-sofia-conversational-agent-multimedia-sandbox-phase-7-9/api-typecheck.log` |
| API build | PASS | `/tmp/codex-sofia-conversational-agent-multimedia-sandbox-phase-7-9/api-build.log` |
| API test | PASS observado, runner colgado post-PASS | `/tmp/codex-sofia-conversational-agent-multimedia-sandbox-phase-7-9/api-test.log` |
| Web typecheck | PASS | `/tmp/codex-sofia-conversational-agent-multimedia-sandbox-phase-7-9/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-sofia-conversational-agent-multimedia-sandbox-phase-7-9/web-build.log` |
| E2E sandbox | PASS | `e2e-sofia-agent-multimedia-sandbox.log` |
| E2E regressions | PASS | logs E2E fase 2/3/4 y checkout |
| Health | PASS | `/tmp/codex-sofia-conversational-agent-multimedia-sandbox-phase-7-9/health.log` |
| test.skip | PASS | archivo vacío `test-skip-check.log` |
