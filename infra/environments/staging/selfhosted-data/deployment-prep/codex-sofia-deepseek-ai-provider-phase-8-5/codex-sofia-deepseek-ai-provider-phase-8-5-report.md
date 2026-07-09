# CODEX-SOFIA-DEEPSEEK-AI-PROVIDER-PHASE-8-5

## 1. Resumen ejecutivo

Se implementó DeepSeek como proveedor IA controlado para Sofía en backend, mediante una capa `SofiaAIProviderAdapter` desacoplada de Hermes, WhatsApp, pagos, POS, Caja y Stock. La IA solo sugiere interpretación y copy; `SofiaAgentService` valida contra datos reales y `SofiaSafetyGuard` bloquea invenciones, precios falsos, claims de pago y errores comerciales de Maxi Family.

Decisión final: **GO CONDICIONADO**.

## 2. Estado recibido

- Fase 7/9 sandbox + multimedia comercial: GO.
- Cierre Fase 7/9 con runner estable, catálogo visual y Maxi Family protegido: GO.
- Fase 8 Hermes/WhatsApp resiliente: GO.
- Hermes/WhatsApp ya tenía adapter, mock, Hermes-ready, Null provider, inbound webhook, deduplicación, outbox, modo supervised/auto protegido, pausa humana y `/sofia/conversations`.

## 3. Arquitectura final Hermes/Sofía/DeepSeek

Flujo final:

`WhatsApp cliente -> Hermes -> Webhook backend -> SofiaWhatsappService -> SofiaAgentService -> SofiaAIProviderAdapter -> DeepSeekAIProvider -> SofiaSafetyGuard -> SofiaAgentService -> WhatsappOutbox -> Hermes -> WhatsApp cliente`

DeepSeek no llama Hermes, no envía WhatsApp, no marca pagos, no crea ventas, no modifica Caja, no descuenta Stock y no decide acciones críticas. La acción operativa sigue controlada por reglas locales, snapshots reales, roles y flujos existentes.

## 4. Dónde se conecta DeepSeek

DeepSeek se conecta únicamente en backend dentro de:

- `apps/api/src/modules/sofia/ai/deepseek-ai.provider.ts`
- `apps/api/src/modules/sofia/ai/sofia-ai-provider.factory.ts`
- `apps/api/src/modules/sofia/sofia-agent.service.ts`

No existe conexión DeepSeek en frontend ni en Hermes.

## 5. Variables env

Se agregaron variables backend seguras:

- `SOFIA_AI_PROVIDER`
- `SOFIA_AI_MODE`
- `DEEPSEEK_ENABLED`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_TIMEOUT_MS`
- `DEEPSEEK_MAX_RETRIES`
- `DEEPSEEK_MAX_TOKENS`
- `SOFIA_AI_MIN_CONFIDENCE`
- `SOFIA_AI_LOG_PROMPTS`
- `SOFIA_AI_REDACT_PERSONAL_DATA`

Defaults seguros: `rules`, `disabled`, `DEEPSEEK_ENABLED=false`.

## 6. SofiaAIProviderAdapter

Se creó contrato común con:

- `analyzeMessage`
- `classifyIntent`
- `extractOrderEntities`
- `draftReply`
- `evaluateConfidence`
- `shouldHandoff`
- `healthCheck`

La salida es estructurada y validable.

## 7. RulesAIProvider

Provider local estable. Es el fallback por defecto y no depende de red ni credenciales.

## 8. DeepSeekAIProvider

Provider DeepSeek preparado para API externa con:

- credenciales solo por env.
- timeout.
- retries.
- JSON estructurado.
- schema parsing.
- fallback a reglas si falla.
- redacción básica de datos personales en payload.
- simulación solo en desarrollo/test mediante headers controlados.

## 9. NullAIProvider

Provider seguro para IA deshabilitada. Devuelve respuesta conservadora y handoff.

## 10. Integración con SofiaAgentService

`SofiaAgentService` ahora:

- normaliza mensaje.
- arma snapshot real de ofertas/productos/pagos/reglas.
- llama `SofiaAIProviderFactory`.
- pasa salida por `SofiaSafetyGuard`.
- conserva reglas locales para drafts, pedidos y links.
- registra diagnóstico IA en `rawPayload`.

## 11. SafetyGuard

`SofiaSafetyGuard` bloquea:

- producto inexistente.
- producto no disponible.
- precio inventado.
- claim de pago pagado.
- intento IA de crear pedido/link.
- copy incorrecto de Maxi Family.
- baja confianza.

## 12. Prompt base

El prompt base vive en backend dentro del provider DeepSeek. Define a Sofía como asistente de pedidos y prohíbe inventar productos, precios, promociones, stock, pagos o tiempos. También exige salida JSON y remite claims prohibidos al snapshot de negocio.

## 13. Modos IA

- `disabled`: no llama IA, usa reglas.
- `suggest`: IA sugiere, Sofía valida.
- `supervised`: IA sugiere y el flujo WhatsApp puede requerir aprobación humana.
- `auto`: solo válido si SafetyGuard pasa y las reglas WhatsApp/horario/confianza lo permiten.

## 14. Fallbacks

Fallback probado para:

- DeepSeek deshabilitado.
- sin API key.
- timeout simulado.
- JSON inválido simulado.
- producto inventado.
- baja confianza.

## 15. UI configuración IA

El panel `/sofia` muestra:

- proveedor IA.
- modo IA.
- estado seguro por defecto.
- conteos de respuestas, safety blocks y handoffs.
- confirmación visual de secrets backend-only.
- regla Maxi Family y validaciones comerciales.

No muestra API key ni secrets.

## 16. Confirmación DeepSeek no llama Hermes directo

DeepSeek solo existe en `modules/sofia/ai`. Hermes sigue en `modules/sofia/whatsapp`. No hay dependencia directa DeepSeek -> Hermes.

## 17. Confirmación Hermes no contiene API key DeepSeek

El grep solo detectó nombres de variables en config/código compilado, no valores. Hermes lee sus propias variables `HERMES_*`; no contiene `DEEPSEEK_API_KEY`.

## 18. Confirmación frontend no expone API key

Frontend muestra estado resumido y “API key no visible”. No existe `DEEPSEEK_API_KEY` en UI. E2E verificó que el body no contiene `DEEPSEEK_API_KEY`, `HERMES_API_TOKEN`, `HERMES_WEBHOOK_SECRET` ni patrones `sk-`.

## 19. Confirmación no autoacciones críticas por IA

La IA no crea pedido, no genera link y no marca pago. `SofiaAgentService` conserva la confirmación local por `CONFIRM_ORDER`, campos completos y horario válido.

## 20. Confirmación Maxi Family protegida

Maxi Family mantiene:

- `6 burgers`
- `porción personal de papitas`
- `Pepsi 1.5 L`
- upsell de papitas adicionales.

Las frases prohibidas aparecen solo en tests/validaciones negativas.

## 21. Confirmación pagos intactos

WhatsApp/DeepSeek no marca `PAID`. Pagos online mock/webhooks y link `/pagos/[token]` pasaron E2E.

## 22. Confirmación POS/Domicilios intactos

E2E POS/Domicilios PASS. Pedidos Sofía siguen operando en Domicilios/POS.

## 23. Confirmación Caja/Stock/Checkout intactos

API tests verifican que no se alteran `cashMovement`, `sale` ni stock por flujo IA. E2E checkout/caja crítico PASS.

## 24. Tests backend

Suite final:

- `api-test-final.log`
- 12 suites PASS.
- 219 tests PASS.
- exit code 0 en `api-test-final-exit-code.log`.

## 25. E2E

PASS:

- `e2e-sofia-deepseek-ai-provider-final-pass.log`
- `e2e-sofia-hermes-whatsapp.log`
- `e2e-sofia-agent-multimedia-sandbox.log`
- `e2e-sofia-pos-delivery-operations.log`
- `e2e-sofia-online-payments.log`
- `e2e-checkout-cash.log`

## 26. Build/typecheck/health

PASS:

- `api-typecheck-final.log`
- `api-build-final.log`
- `web-typecheck-final.log`
- `web-build-final.log`
- `health-final-2.log`

## 27. Screenshots

Generadas en:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-deepseek-ai-provider-phase-8-5/`

Archivos:

- `01-sofia-ai-provider-config.png`
- `02-deepseek-disabled-safe-default.png`
- `03-deepseek-health-check.png`
- `04-ai-sandbox-test.png`
- `05-ai-suggested-response.png`
- `06-safetyguard-product-block.png`
- `07-safetyguard-maxi-family.png`
- `08-ai-fallback-rules.png`
- `09-whatsapp-mock-with-ai.png`
- `10-no-secrets-visible.png`
- `11-final-summary.png`

## 28. Riesgos residuales

- DeepSeek real queda provider-ready, pero no se activó porque no hay credenciales reales configuradas.
- La verificación exacta de firma/endpoint DeepSeek final debe confirmarse al configurar proveedor real.
- Monitoreo persistente de métricas IA puede moverse a tabla dedicada en Fase 10.

## 29. Próxima fase recomendada

Fase 10: aprendizaje supervisado con feedback humano, prompt versions, auditoría de errores frecuentes y tablero de mejora controlada.

## 30. Decisión final

`CODEX-SOFIA-DEEPSEEK-AI-PROVIDER-PHASE-8-5: GO CONDICIONADO`

## Tabla 1: Componente | Función | Estado

| Componente | Función | Estado |
|---|---|---|
| `SofiaAIProviderAdapter` | Contrato IA backend estructurado | PASS |
| `RulesAIProvider` | Fallback local estable | PASS |
| `DeepSeekAIProvider` | Provider DeepSeek preparado con timeout/retries/schema | PASS |
| `NullAIProvider` | Modo seguro deshabilitado | PASS |
| `SofiaSafetyGuard` | Bloquea invenciones, pagos falsos y copy incorrecto | PASS |
| `SofiaAgentService` | Usa adapter IA y valida con datos reales | PASS |
| `/admin/sofia/ai/status` | Estado IA sin secrets | PASS |
| `/admin/sofia/ai/test` | Pruebas controladas backend | PASS |
| `/sofia` | Estado IA visible sin API key | PASS |

## Tabla 2: Variable env | Uso | Seguridad | Estado

| Variable env | Uso | Seguridad | Estado |
|---|---|---|---|
| `SOFIA_AI_PROVIDER` | Selecciona `rules/deepseek/hybrid` | Default `rules` | PASS |
| `SOFIA_AI_MODE` | Controla `disabled/suggest/supervised/auto` | Default `disabled` | PASS |
| `DEEPSEEK_ENABLED` | Habilita DeepSeek real | Default `false` | PASS |
| `DEEPSEEK_API_KEY` | API key backend | No frontend, no DB | PASS |
| `DEEPSEEK_BASE_URL` | Endpoint provider | Solo env | PASS |
| `DEEPSEEK_TIMEOUT_MS` | Timeout externo | Controlado | PASS |
| `DEEPSEEK_MAX_RETRIES` | Reintentos provider | Controlado | PASS |
| `SOFIA_AI_REDACT_PERSONAL_DATA` | Reduce PII en prompt | Default true | PASS |

## Tabla 3: Modo IA | Comportamiento | Riesgo | Estado

| Modo IA | Comportamiento | Riesgo | Estado |
|---|---|---|---|
| `disabled` | Usa reglas, no llama IA | Bajo | PASS |
| `suggest` | IA sugiere, Sofía valida | Controlado | PASS |
| `supervised` | IA sugiere con aprobación humana si aplica | Controlado | PASS |
| `auto` | Solo con SafetyGuard, horario, confianza y WhatsApp permitido | Alto mitigado | PASS |

## Tabla 4: SafetyGuard | Validación | Estado

| SafetyGuard | Validación | Estado |
|---|---|---|
| Productos | Bloquea producto inexistente/no disponible | PASS |
| Precios | Bloquea o reemplaza precio inventado | PASS |
| Pagos | Bloquea claims `PAID` desde IA | PASS |
| Maxi Family | Fuerza copy oficial y upsell correcto | PASS |
| Handoff | Baja confianza o riesgo genera handoff | PASS |
| Acciones críticas | IA no crea pedido/link ni modifica pagos | PASS |

## Tabla 5: Gate | Resultado | Evidencia

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `api-typecheck-final.log` |
| API build | PASS | `api-build-final.log` |
| API test | PASS | `api-test-final.log`, exit code 0 |
| Web typecheck | PASS | `web-typecheck-final.log` |
| Web build | PASS | `web-build-final.log` |
| E2E DeepSeek | PASS | `e2e-sofia-deepseek-ai-provider-final-pass.log` |
| E2E Hermes | PASS | `e2e-sofia-hermes-whatsapp.log` |
| E2E POS/Pagos/Checkout | PASS | logs E2E correspondientes |
| No `test.skip` | PASS | `test-skip-check-final-2.log` vacío |
| No `process.exit(0)` | PASS | `process-exit-check-final-2.log` vacío |
| Secrets | PASS | Solo nombres de variables, sin valores |
| Copy prohibido | PASS | Solo tests/validaciones negativas |
