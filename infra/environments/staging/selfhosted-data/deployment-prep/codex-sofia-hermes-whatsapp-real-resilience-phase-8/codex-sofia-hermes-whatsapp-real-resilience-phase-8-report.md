# CODEX-SOFIA-HERMES-WHATSAPP-REAL-RESILIENCE-PHASE-8 — Reporte final

## 1. Resumen ejecutivo

Se implementó la integración resiliente de Sofía con WhatsApp/Hermes bajo modos seguros: `disabled`, `mock`, `receive_only`, `supervised` y `auto`. La fase queda preparada para Hermes real sin activar envío real por defecto, con adapter de provider, inbound webhook, deduplicación, outbox, aprobación humana, pausa/reanudación, retry controlado, soporte multimedia limitado a ofertas principales, audio seguro y UI interna de conversaciones.

Los pedidos siguen operándose en POS/Domicilios. WhatsApp no marca pagos como `PAID`, no toca Caja, no toca Stock y no ejecuta Checkout.

## 2. Estado recibido

- Plan maestro Sofía + WhatsApp + pagos: GO.
- Núcleo pedidos Sofía/WhatsApp: GO.
- Corrección arquitectura POS/Domicilios: GO.
- `/pagos/[token]`: GO.
- Pagos manuales: GO.
- Operación Sofía en POS/Domicilios: GO.
- Adapter/webhooks pagos online: GO.
- Agente sandbox + multimedia comercial: GO.
- Cierre Fase 7/9: GO.

## 3. Alcance Fase 8

- Configuración segura de WhatsApp/Hermes por env.
- Provider adapter con `MockWhatsappProvider`, `HermesWhatsappProvider` y `NullWhatsappProvider`.
- Webhook inbound `POST /integrations/whatsapp/:provider/webhook`.
- Webhook alias Hermes `POST /integrations/hermes/whatsapp/webhook`.
- Deduplicación inbound por evento/message/hash.
- Deduplicación outbound por inbound + response hash.
- Outbox con estados `APPROVAL_PENDING`, `SUGGESTED`, `QUEUED`, `SENT`, `FAILED`, `RETRYING`, `CANCELLED`.
- Endpoints admin para pausa, toma humana, reactivación, aprobación y cancelación de mensajes.
- UI `/sofia/conversations` para control técnico de conversación.
- E2E mock sin mensajes reales.

## 4. Configuración WHATSAPP_MODE

Variables agregadas:

- `WHATSAPP_MODE=disabled|mock|receive_only|supervised|auto`.
- `WHATSAPP_PROVIDER=hermes|mock|none`.
- `HERMES_BASE_URL`.
- `HERMES_API_TOKEN`.
- `HERMES_WEBHOOK_SECRET`.
- `HERMES_PHONE_NUMBER_ID`.
- `HERMES_TIMEOUT_MS=8000`.
- `HERMES_MAX_RETRIES=3`.
- `SOFIA_AUTO_REPLY_ENABLED=false`.
- `SOFIA_AUTO_REPLY_MIN_CONFIDENCE=0.82`.
- `SOFIA_HUMAN_HANDOFF_ENABLED=true`.
- `SOFIA_REPLY_OUTSIDE_HOURS=false`.
- `SOFIA_WHATSAPP_RATE_LIMIT_PER_MINUTE=20`.
- `SOFIA_WHATSAPP_DEDUP_TTL_MINUTES=1440`.

Modo por defecto: `disabled`.

## 5. WhatsappProviderAdapter

Contrato implementado:

- `parseInboundWebhook`.
- `verifyWebhookSignature`.
- `sendTextMessage`.
- `sendMediaMessage`.
- `getMessageStatus`.
- `normalizePhone`.
- `buildIdempotencyKey`.

Sofía no llama a Hermes directamente.

## 6. MockWhatsappProvider

Provider para tests/E2E. No envía mensajes reales. Genera `providerMessageId` mock con hash de idempotencia para evitar colisiones entre conversaciones.

## 7. HermesWhatsappProvider

Provider Hermes-ready. Lee env, valida configuración, usa timeout, firma HMAC SHA-256 con `HERMES_WEBHOOK_SECRET` y no falla build si no hay credenciales. Si Hermes no está configurado, el factory cae a `NullWhatsappProvider`.

## 8. NullWhatsappProvider

Fallback seguro. Bloquea envío/recepción cuando el provider real no está configurado.

## 9. Endpoint inbound webhook

Endpoints:

- `POST /integrations/whatsapp/:provider/webhook`.
- `POST /integrations/hermes/whatsapp/webhook`.

Flujo:

1. Recibe payload.
2. Resuelve modo/provider.
3. Verifica firma si provider Hermes.
4. Normaliza teléfono.
5. Calcula hash/idempotencia.
6. Guarda `WhatsappInboundEvent`.
7. Ignora duplicados.
8. Crea/actualiza `WhatsappConversation`.
9. Guarda `WhatsappMessage` inbound.
10. Procesa con `SofiaAgentService` si Sofía está activa.
11. Crea outbound según modo.

## 10. Verificación de firma

Hermes usa `HERMES_WEBHOOK_SECRET` y header `x-hermes-signature`. Firma inválida genera evento `SIGNATURE_INVALID` y rechaza el webhook.

## 11. Deduplicación inbound

Se evita reprocesar si coincide:

- `providerEventId`.
- `providerMessageId`.
- `eventHash`.

Duplicado:

- registra `DUPLICATE_IGNORED`.
- no crea mensaje procesado adicional.
- no llama otra vez a Sofía.
- no crea draft/pedido/outbound duplicado.

## 12. Deduplicación outbound

Outbound idempotente con:

- `conversationId`.
- `inboundMessageId`.
- hash de respuesta/media.

Además, `localMessageId` usa hash de idempotency key completa para evitar colisiones entre respuestas iguales en conversaciones distintas.

## 13. Pausa humana/handoff

Estados usados:

- `SOFIA_ACTIVE`.
- `HUMAN_REQUIRED`.
- `HUMAN_TAKEN`.
- `SOFIA_PAUSED`.
- `RESOLVED`.

Endpoints:

- `POST /admin/sofia/conversations/:id/pause`.
- `POST /admin/sofia/conversations/:id/resume`.
- `POST /admin/sofia/conversations/:id/take-over`.
- `POST /admin/sofia/conversations/:id/release`.
- `POST /admin/sofia/outbound/:id/approve-send`.
- `POST /admin/sofia/outbound/:id/cancel`.
- `POST /admin/sofia/outbound/:id/retry`.

## 14. Outbox/reintentos

Outbox persistente en `WhatsappOutboundMessage`.

Reglas:

- `supervised`: `APPROVAL_PENDING`.
- `receive_only`: `SUGGESTED`.
- `mock`: `SENT` mock.
- `auto`: envía solo con flag, confianza y horario.
- fallo de envío: `RETRYING` o `FAILED`.
- fallo permanente: conversación pasa a `HUMAN_REQUIRED`.

## 15. Modos

| Modo WhatsApp | Comportamiento | Seguridad | Estado |
|---|---|---|---|
| disabled | Guarda inbound si llega, no procesa respuesta | Default seguro | PASS |
| mock | Procesa Sofía, registra outbound mock, no envía real | Test/E2E | PASS |
| receive_only | Guarda mensaje y sugerencia, no envía | Piloto lectura | PASS |
| supervised | Crea outbound pendiente de aprobación | Humano aprueba | PASS |
| auto | Envía solo con flag/confidence/horario/Sofía activa | Bloqueado por defecto | PASS |

## 16. Horario y auto-reply

Auto-reply exige:

- `SOFIA_AUTO_REPLY_ENABLED=true`.
- confianza >= `SOFIA_AUTO_REPLY_MIN_CONFIDENCE`.
- horario válido o `SOFIA_REPLY_OUTSIDE_HOURS=true`.
- conversación no pausada.
- sin handoff.

## 17. UI conversaciones

Nueva ruta:

- `/sofia/conversations`.

Muestra:

- modo/provider.
- conversaciones.
- mensajes inbound.
- outbox.
- sugerencias.
- aprobación/cancelación.
- pausa/reactivación/toma/liberación.
- enlaces a Domicilios/POS.

## 18. Flujo pedido real controlado

E2E validó:

- inbound mock `quiero un maxi family`.
- copy correcto con `porción personal de papitas`.
- outbound mock/supervised.
- deduplicación.
- handoff humano.
- audio sin transcript.
- pedido completo con 2x1, nombre, dirección y confirmación.
- pedido visible en Domicilios con chip Sofía.
- link `/pagos` generado.

## 19. Multimedia WhatsApp

Solo se permite media para:

- `/uploads/sofia-offers/maxi-family.webp`.
- `/uploads/sofia-offers/2x1-hamburguesas.webp`.
- `/uploads/sofia-offers/doble-todo.webp`.
- `/uploads/sofia-offers/hamburguesa-sencilla.webp`.

No se exigen imágenes para gaseosas, papitas ni adiciones.

## 20. Audio WhatsApp

Audio sin transcript responde:

`Recibí tu audio, pero necesito que me confirmes el pedido por texto para evitar errores.`

No crea pedido inseguro.

## 21. Seguridad

- Secrets solo por env.
- Salida de secret scan enmascarada.
- Hermes no configurado cae a `NullWhatsappProvider`.
- Mock no envía real.
- Headers de override solo no-producción.
- WhatsApp no marca `PAID`.
- Cliente no puede marcar `PAID`.
- No se exponen raw secrets.
- No se usa `test.skip`.
- No se usa `process.exit(0)`.

## 22. Confirmaciones

- No secrets hardcodeados: PASS.
- No mensajes reales en tests: PASS.
- WhatsApp no marca `PAID`: PASS.
- POS/Domicilios intactos: PASS.
- Pagos/link intactos: PASS.
- Caja/Stock/Checkout intactos: PASS.

## 23. Tests backend

- `pnpm --filter @inventory-fastfood/api typecheck`: PASS.
- `pnpm --filter @inventory-fastfood/api build`: PASS.
- `pnpm --filter @inventory-fastfood/api test`: PASS.
- Resultado full API: 12 suites PASS, 218 tests PASS, exit code 0.
- Runner API termina solo, sin Ctrl+C.

## 24. E2E

- `sofia-hermes-whatsapp*.spec.ts`: PASS.
- `sofia-agent-multimedia-sandbox*.spec.ts`: PASS.
- `sofia-pos-delivery-operations*.spec.ts`: PASS.
- `sofia-online-payments*.spec.ts`: PASS.
- `sofia-manual-payments*.spec.ts`: PASS.
- `phase-delivery-auto-3-checkout-cash-audit.spec.ts`: PASS.

## 25. Build/typecheck/health

- API typecheck: PASS.
- API build: PASS.
- API test: PASS.
- Web typecheck: PASS.
- Web build: PASS.
- Health: PASS.
- Docker `api` y `web` reconstruidos y healthy.

## 26. Screenshots

Guardados en:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-hermes-whatsapp-real-resilience-phase-8/`

Archivos:

- `01-whatsapp-mode-status.png`.
- `02-whatsapp-conversations-list.png`.
- `03-inbound-mock-message.png`.
- `04-sofia-suggested-reply.png`.
- `05-supervised-approval-pending.png`.
- `06-outbound-sent-mock.png`.
- `07-duplicate-ignored.png`.
- `08-human-required.png`.
- `09-sofia-paused.png`.
- `10-sofia-resumed.png`.
- `11-maxi-family-whatsapp-copy.png`.
- `12-media-offer-suggestion.png`.
- `13-order-created-deliveries-chip-sofia.png`.
- `14-payment-link-generated.png`.
- `15-final-summary.png`.

## 27. Riesgos residuales

- Hermes real queda preparado pero requiere credenciales reales y validación de contrato final de firma/payload del proveedor.
- `auto` debe activarse solo en piloto controlado con env explícito.
- Rate limit granular por IP/proveedor puede reforzarse en hardening final.

## 28. Próxima fase recomendada

Fase 10 — Aprendizaje supervisado:

- feedback humano.
- conversaciones etiquetadas.
- versiones de prompts.
- métricas de error.
- tablero de correcciones.

## Tabla 1: Componente | Cambio | Riesgo | Estado

| Componente | Cambio | Riesgo | Estado |
|---|---|---|---|
| Prisma | Campos de conversación/mensajes + `WhatsappInboundEvent` + `WhatsappOutboundMessage` | Migración nueva | PASS |
| Config env | `WHATSAPP_MODE`, Hermes, auto-reply, dedup TTL | Malconfiguración productiva | PASS |
| Adapter | `WhatsappProviderAdapter` | Acoplamiento provider | PASS |
| Mock provider | Mock seguro sin envío real | Colisión idempotencia | PASS corregido |
| Hermes provider | Hermes-ready sin credenciales reales | Contrato final Hermes pendiente | PASS |
| Null provider | Fallback seguro | Provider no configurado | PASS |
| Webhook inbound | `/integrations/whatsapp/:provider/webhook` | Duplicados | PASS |
| Outbox | Aprobación/retry/cancel | Mensajes duplicados | PASS |
| UI conversaciones | `/sofia/conversations` | Confundir con operación pedido | PASS |
| Domicilios | Se mantuvieron test IDs y resumen Sofía | Regresión UI | PASS |

## Tabla 2: Modo WhatsApp | Comportamiento | Seguridad | Estado

| Modo WhatsApp | Comportamiento | Seguridad | Estado |
|---|---|---|---|
| disabled | No procesa ni envía | Default seguro | PASS |
| mock | Simula inbound/outbound | No real send | PASS |
| receive_only | Guarda sugerencia | No auto envío | PASS |
| supervised | Outbound pendiente | Humano aprueba | PASS |
| auto | Envía con flag + confidence + horario | Bloqueado por defecto | PASS |

## Tabla 3: Caso de resiliencia | Resultado | Estado

| Caso de resiliencia | Resultado | Estado |
|---|---|---|
| Inbound duplicado | `DUPLICATE_IGNORED`, sin mensaje/outbound duplicado | PASS |
| Outbound duplicado | idempotency key evita reenvío | PASS |
| Pausa humana | Sofía no responde si pausada | PASS |
| Supervised | no envía sin aprobación | PASS |
| Auto sin flag | queda approval pending | PASS |
| Auto con flag/confidence/hora | mock outbound `SENT` | PASS |
| Audio sin transcript | pide texto, no crea pedido | PASS |
| Maxi Family | conserva `porción personal de papitas` | PASS |
| Copy prohibido | solo aparece en tests negativos | PASS |
| Hermes sin env | fallback seguro | PASS |

## Tabla 4: Gate | Resultado | Evidencia

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/api-typecheck.log` |
| API build | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/api-build.log` |
| API test | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/api-test.log` |
| API exit code | 0 | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/api-test-exit-code.log` |
| Web typecheck | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/web-typecheck-after-queue-testid.log` |
| Web build | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/web-build-after-queue-testid.log` |
| Health | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/health-final.log` |
| E2E Phase 8 | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/e2e-sofia-hermes-whatsapp.log` |
| E2E regressions | PASS | logs `e2e-sofia-*` y `e2e-checkout-cash.log` |
| No test.skip | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/test-skip-check.log` |
| No process.exit(0) | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/process-exit-check.log` |
| Secrets | PASS | `/tmp/codex-sofia-hermes-whatsapp-real-resilience-phase-8/secret-leak-check.log` |

## Tabla 5: Regresión | Resultado | Estado

| Regresión | Resultado | Estado |
|---|---|---|
| POS/Domicilios | Pedidos Sofía siguen visibles y filtrables | PASS |
| Manual payments | Efectivo/Nequi siguen operador-controlados | PASS |
| Online payments | Mock adapter/webhooks siguen idempotentes | PASS |
| `/pagos/[token]` | Link se mantiene integrado | PASS |
| Caja/Checkout | Checkout/caja crítica PASS | PASS |
| Stock | No se descontó fuera del flujo actual | PASS |
| Waiter | No se modificó flujo waiter | PASS |

## Decisión final

`CODEX-SOFIA-HERMES-WHATSAPP-REAL-RESILIENCE-PHASE-8: GO`

Sofía queda integrada con WhatsApp/Hermes de forma resiliente: inbound controlado, deduplicación, pausa humana, modo supervisado, outbound seguro, reintentos, multimedia preparada y pedidos visibles en POS/Domicilios, sin duplicar pedidos ni afectar pagos/Caja/Stock/Checkout.
