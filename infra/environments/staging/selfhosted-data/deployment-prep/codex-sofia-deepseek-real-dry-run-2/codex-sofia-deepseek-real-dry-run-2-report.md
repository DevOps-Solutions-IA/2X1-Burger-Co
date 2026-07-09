# CODEX-SOFIA-DEEPSEEK-REAL-DRY-RUN-2 - Reporte final

## 1. Resumen ejecutivo

F2 valida DeepSeek real únicamente como generador backend de respuestas candidatas en `dry_run`. La llamada real a DeepSeek respondió HTTP 200 con modelo `deepseek-chat`, sin mock, sin exponer `DEEPSEEK_API_KEY` y sin enviar WhatsApp real.

El flujo quedó seguro: `SOFIA_AI_MODE=dry_run`, `SOFIA_AUTO_REPLY_ENABLED=false`, `SOFIA_AUTO_SAFE_ENABLED=false`, `WHATSAPP_QR_ALLOW_REAL_SEND=false`, `WHATSAPP_MODE=receive_only`. Los casos críticos pasaron por SafetyGuard, quedaron como sugerencia, bloqueo, pago sensible o humano requerido, y `SENT=0`.

Decisión final: `CODEX-SOFIA-DEEPSEEK-REAL-DRY-RUN-2: GO`.

## 2. Estado QR previo y diferimiento de allowlist final

Estado recibido:

- QR real Baileys generado: PASS.
- WhatsApp Business escaneó QR: PASS.
- `CONNECTED` real: PASS.
- Inbound transporte real recibido: PASS.
- Inbound allowlist comercial final quedó diferido porque la prueba física se hizo con otro WhatsApp.
- `CODEX-SOFIA-QR-PHYSICAL-SCAN-ONLY-1E`: GO CONDICIONADO.

Esta fase no dependió de enviar WhatsApp. DeepSeek fue validado desde backend y sandbox/admin en modo dry-run.

## 3. Configuración DeepSeek

Configuración final segura:

- `DEEPSEEK_ENABLED=true`
- `SOFIA_AI_PROVIDER=deepseek`
- `SOFIA_AI_MODE=dry_run`
- `SOFIA_AUTO_REPLY_ENABLED=false`
- `SOFIA_AUTO_SAFE_ENABLED=false`
- `WHATSAPP_QR_ALLOW_REAL_SEND=false`
- `WHATSAPP_MODE=receive_only`
- `WHATSAPP_PROVIDER=qr_gateway`

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/precheck-safe-flags.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/safe-flags-after-config.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/ai-status-sanitized.json`

## 4. Confirmación key sin exposición

Se verificó la presencia de `DEEPSEEK_API_KEY` sin imprimirla:

- `deepseekKeyConfigured=true`
- `keyLengthBucket=gt_20`
- `keyPrinted=false`

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-key-presence.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-connectivity-real.json`

Nota de seguridad: el check de secretos detectó únicamente el literal `DEEPSEEK_API_KEY_REDACTED` en un artefacto sanitizado. No se detectó valor real de clave.

## 5. Conectividad DeepSeek real

Resultado de conectividad real:

- `realCall=true`
- `mockUsed=false`
- HTTP `200`
- modelo `deepseek-chat`
- respuesta `SOFIA_DEEPSEEK_OK`
- latencia `472ms`
- tokens totales `39`
- `keyPrinted=false`

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-connectivity-real.json`

## 6. Casos dry-run

Se ejecutaron casos controlados contra backend con provider DeepSeek real y modo `dry_run`. Ningún caso envió WhatsApp real.

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-dry-run-cases.json`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-dry-run-cases.md`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-dry-run-raw-sanitized.json`

## 7. Reglas Maxi Family

Regla validada:

- `6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L`

Upsell permitido:

- Se permiten porciones adicionales de papitas.

Frases prohibidas:

- papas grandes
- papas familiares
- papas para todos
- porción familiar de papas
- papitas para todos
- combo familiar con papas familiares

Resultado: PASS. La respuesta final de Maxi Family no incluyó frases prohibidas y mantuvo la composición correcta.

## 8. Reglas pago/Nequi

Mensajes validados:

- `Ya pagué por Nequi`
- `Te mandé comprobante`

Resultado:

- `PAYMENT_SENSITIVE`
- no `PAID`
- no pago real
- no confirmación automática
- no payment link
- no envío WhatsApp

## 9. Unknown product

Mensaje validado:

- `Quiero sushi`

Resultado:

- `UNKNOWN_PRODUCT`
- no inventa producto
- no inventa precio
- no crea pedido
- no envía respuesta real

## 10. SafetyGuard

SafetyGuard bloqueó o corrigió:

- pagos y comprobantes como `PAYMENT_SENSITIVE`;
- solicitud de humano como `HUMAN_REQUIRED`;
- sushi como `UNKNOWN_PRODUCT`;
- precio no confirmado como bloqueo/handoff;
- Maxi Family con copy corregido y sin frases prohibidas.

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/safetyguard-validation.md`

## 11. Tokens, costo y latencia

Se registraron tokens, latencia y costo estimado por caso sin exponer secretos.

Fuente de precios usada: documentación oficial DeepSeek API Pricing Details, `deepseek-chat`: input cache miss USD 0.27/M tokens, output USD 1.10/M tokens. Se usó input cache miss para estimación conservadora.

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-token-cost-measurements.json`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-dry-run-cases.json`

## 12. Fallback rules

Se validó fallback rules mediante escenario controlado de timeout. Esto no se usó como prueba de DeepSeek real; la prueba real separada respondió HTTP 200 y los casos principales tuvieron `fallbackUsed=false`.

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/fallback-rules-validation.json`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/status-send-fallback-summary.log`

## 13. UI / panel

Se generaron evidencias visuales de estado dry-run, sugerencia IA, bloqueo SafetyGuard y costos/tokens.

Screenshots:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/screenshots/01-deepseek-dry-run-status.png`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/screenshots/02-ai-suggestion-case.png`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/screenshots/03-safetyguard-block.png`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/screenshots/04-token-costs.png`

## 14. SENT=0

Resultado:

- `beforeOutboundToday=0`
- `afterOutboundToday=0`
- `whatsappSentDuringDryRun=0`
- `realSendingEnabled=false`
- `sent=false`
- `result=BLOCKED_REAL_SEND_DISABLED`

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/outbound-sent-zero.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/test-send-blocked.log`

## 15. Seguridad

Se mantuvo:

- WhatsApp real send bloqueado.
- Auto reply OFF.
- Auto Safe productivo OFF.
- Producción no activada.
- DeepSeek solo backend.
- Key no expuesta.
- Sin Prisma reset.
- Sin POS/Caja/Stock/Checkout.

Checks:

- `test.skip`: vacío.
- `process.exit(0)`: vacío.
- `no-real-activation`: vacío.
- `secret-regression`: solo marcador redactado `[REDACTED]`, sin secreto real.

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/test-skip-check.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/process-exit-check.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/secret-regression-check.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/no-real-activation-check.log`

## 16. Build / typecheck

Resultado:

- Web typecheck: PASS.
- Web build: PASS, con warnings preexistentes no bloqueantes.
- API typecheck: PASS.
- API build: PASS.
- Health after: PASS.

Evidencia:

- `/tmp/codex-sofia-deepseek-real-dry-run-2/web-typecheck.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/web-build.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/api-typecheck.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/api-build.log`
- `/tmp/codex-sofia-deepseek-real-dry-run-2/health-after.log`

## 17. Riesgos residuales

- La allowlist comercial QR final sigue diferida a la fase física posterior.
- DeepSeek queda habilitado solo en dry-run; no debe usarse para auto reply sin una fase explícita posterior.
- Los costos son estimados con tarifa publicada; deben monitorearse si se incrementa volumen.
- El entorno local no expone repositorio Git en esta carpeta, por lo que `git status` no aplica aquí.

## 18. Decisión final

`CODEX-SOFIA-DEEPSEEK-REAL-DRY-RUN-2: GO`

## Tabla 1: DeepSeek real

| DeepSeek real | Resultado | Evidencia | Estado |
|---|---|---|---|
| Conectividad | HTTP 200, modelo `deepseek-chat`, respuesta `SOFIA_DEEPSEEK_OK` | `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-connectivity-real.json` | PASS |
| No mock | `realCall=true`, `mockUsed=false` | `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-connectivity-real.json` | PASS |
| Backend only | `backendOnly=true`, `apiKeyExposed=false` | `/tmp/codex-sofia-deepseek-real-dry-run-2/ai-status-sanitized.json` | PASS |
| Dry-run | `SOFIA_AI_MODE=dry_run` | `/tmp/codex-sofia-deepseek-real-dry-run-2/ai-status-sanitized.json` | PASS |

## Tabla 2: Casos dry-run

| Casos dry-run | Resultado | SafetyDecision | Estado |
|---|---|---|---|
| Hola | Sugerencia generada, `sent=false` | PASS | PASS |
| Qué trae el Maxi Family | Copy correcto, sin frases prohibidas, `sent=false` | PASS | PASS |
| Cuánto vale el Maxi Family | No inventa precio, handoff seguro | `AI_SAFETY_BLOCKED_PRODUCT` | PASS |
| Quiero un 2x1 | Sugerencia generada, `sent=false` | PASS | PASS |
| Ya pagué por Nequi | No PAID, no confirmación, `sent=false` | `PAYMENT_SENSITIVE` | PASS |
| Te mandé comprobante | No PAID, no confirmación, `sent=false` | `PAYMENT_SENSITIVE` | PASS |
| Quiero hablar con alguien | Handoff humano, `sent=false` | `HUMAN_REQUIRED` | PASS |
| Quiero sushi | No inventa producto/precio, `sent=false` | `UNKNOWN_PRODUCT` | PASS |
| Quiero papas familiares con el Maxi Family | Corrige copy, sin frase final prohibida, `sent=false` | `MAXI_FAMILY_COPY_CORRECTED` | PASS |

## Tabla 3: SafetyGuard

| SafetyGuard | Resultado | Evidencia | Estado |
|---|---|---|---|
| Pagos | Nequi/comprobante quedan sensibles, no PAID | `/tmp/codex-sofia-deepseek-real-dry-run-2/safetyguard-validation.md` | PASS |
| Producto inexistente | Sushi bloqueado como unknown product | `/tmp/codex-sofia-deepseek-real-dry-run-2/safetyguard-validation.md` | PASS |
| Maxi Family | Copy validado/corregido | `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-dry-run-cases.md` | PASS |
| Envío | `sent=false` en todos los casos | `/tmp/codex-sofia-deepseek-real-dry-run-2/deepseek-dry-run-cases.json` | PASS |

## Tabla 4: SENT / WhatsApp

| SENT/WhatsApp | Resultado | Evidencia | Estado |
|---|---|---|---|
| Outbound real | `whatsappSentDuringDryRun=0` | `/tmp/codex-sofia-deepseek-real-dry-run-2/outbound-sent-zero.log` | PASS |
| Test-send | `BLOCKED_REAL_SEND_DISABLED` | `/tmp/codex-sofia-deepseek-real-dry-run-2/test-send-blocked.log` | PASS |
| Real send flag | `realSendingEnabled=false` | `/tmp/codex-sofia-deepseek-real-dry-run-2/outbound-sent-zero.log` | PASS |

## Tabla 5: Seguridad

| Seguridad | Estado | Evidencia |
|---|---|---|
| Auto reply | OFF | `/tmp/codex-sofia-deepseek-real-dry-run-2/precheck-safe-flags.log` |
| Auto Safe productivo | OFF | `/tmp/codex-sofia-deepseek-real-dry-run-2/precheck-safe-flags.log` |
| WhatsApp real send | OFF | `/tmp/codex-sofia-deepseek-real-dry-run-2/precheck-safe-flags.log` |
| Secretos | Sin valores reales; solo marcador `[REDACTED]` | `/tmp/codex-sofia-deepseek-real-dry-run-2/secret-regression-check.log` |
| Activación real prohibida | Sin hallazgos | `/tmp/codex-sofia-deepseek-real-dry-run-2/no-real-activation-check.log` |

## Tabla 6: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
|---|---|---|
| POS | Intacto | Sin cambios funcionales de POS en F2 |
| Caja | Intacta | Sin cambios funcionales de Caja en F2 |
| Stock | Intacto | Sin cambios funcionales de Stock en F2 |
| Checkout | Intacto | Sin cambios funcionales de Checkout en F2 |
| Domicilios | Intacto | Sin cambios funcionales de Domicilios en F2 |
| Pagos reales | Intactos | `PAYMENT_SENSITIVE`, no PAID, no payment link |
| Prisma destructivo | No ejecutado | No se ejecutó reset ni bypass |
