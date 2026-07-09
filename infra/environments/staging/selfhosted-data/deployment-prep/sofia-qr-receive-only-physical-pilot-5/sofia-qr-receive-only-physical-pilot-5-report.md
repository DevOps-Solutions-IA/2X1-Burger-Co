# SOFIA-QR-RECEIVE-ONLY-PHYSICAL-PILOT-5

## 1. Resumen ejecutivo

F5 dejó el piloto QR de Sofía preparado para validación física controlada en `receive_only`, con allowlist de piloto, inbound simulado por el mismo pipeline seguro, deduplicación, endpoint de eventos sanitizado, test de envío real bloqueado y evidencias E2E. No se activó DeepSeek real, autoenvío, auto_safe productivo ni producción.

Decisión: `GO CONDICIONADO`. La condición pendiente es operativa: no hubo operador/dispositivo WhatsApp Business disponible para escanear QR físico y validar `CONNECTED` con inbound real allowlist. El receive_only simulado, las barreras de seguridad y las regresiones críticas quedaron en PASS.

## 2. Estado recibido

- `SOFIA-MASTER-ARCHITECTURE-AUDIT-0`: GO.
- `SOFIA-SECURITY-SECRETS-SANITIZATION-0`: GO CONDICIONADO por rotación externa pendiente.
- `SOFIA-COMMERCIAL-BRAIN-PROMPT-CATALOG-MEMORY-1`: GO.
- `SOFIA-AUTO-SAFE-ENGINE-2`: GO.
- `SOFIA-ENTERPRISE-GOVERNANCE-PANEL-3`: GO.
- `SOFIA-WHATSAPP-QR-GATEWAY-4`: GO CONDICIONADO por falta de escaneo físico QR.

## 3. Decisión de no rotar secretos todavía

La rotación externa sigue pendiente por decisión de negocio. Por eso F5 mantiene producción bloqueada y no habilita DeepSeek real, envío real ni auto_safe con clientes.

## 4. Alcance real F5

Se reforzó el modo piloto receive_only. El QR físico queda listo para validación manual controlada, pero la evidencia automatizada usa `test-inbound` seguro porque CI/Codex no puede escanear WhatsApp Business.

## 5. Qué se creó

- Variables seguras de piloto QR en backend y `.env.example`.
- Control de allowlist para inbound físico `qr_gateway`.
- Endpoint admin `GET /admin/sofia/whatsapp/qr/inbound-events`.
- Compatibilidad de `test-send` con payload `phone/text`.
- Test API crítico F5.
- E2E `tests/e2e/sofia-qr-receive-only-physical-pilot-5.spec.ts`.
- Screenshots F5 en `/tmp/sofia-qr-receive-only-physical-pilot-5/screenshots/`.

## 6. Qué se modificó

- `apps/api/src/config/env.ts`: schema env F5.
- `.env.example`: placeholders seguros F5 sin números reales.
- `apps/api/src/modules/sofia/sofia-whatsapp.service.ts`: allowlist antes de llamar a Sofía/outbox.
- `apps/api/src/modules/sofia/whatsapp/qr-gateway/*`: eventos sanitizados y payload operativo.
- `apps/api/src/modules/sofia/dto/sofia.dto.ts`: DTO flexible para test-send bloqueado.
- `apps/api/src/tests/app.critical.spec.ts`: cobertura F5.

## 7. Qué no se tocó

No se tocó lógica funcional de POS, Domicilios, pagos, Caja, Stock ni Checkout. No se movió operación de pedidos a `/sofia`. No se activó Hermes Agent. No se guardaron números reales en repo.

## 8. Estado de seguridad

- `realSendingEnabled=false`.
- `autoReplyEnabled=false`.
- `deepSeekEnabled=false`.
- `whatsappCanMarkPaid=false`.
- Producción sigue `BLOCKED`.
- `.env.example` no contiene secretos reales ni números reales.

## 9. QR físico connect

Automatizado: `POST /admin/sofia/whatsapp/qr/connect` genera estado `QR_READY` y QR operativo temporal de control. Físico: no escaneado por ausencia de operador/dispositivo en este entorno.

## 10. QR status

E2E valida `provider=qr_gateway`, `mode=receive_only`, `realSendingEnabled=false`, `autoReplyEnabled=false`, `deepSeekEnabled=false`.

## 11. Inbound real o simulado

Inbound simulado PASS por endpoint admin controlado. Inbound físico real allowlist queda pendiente de validación manual.

## 12. Allowlist

Variables agregadas:

- `SOFIA_QR_PILOT_ALLOWLIST_ENABLED=false`
- `SOFIA_QR_PILOT_ALLOWED_PHONES=`
- `SOFIA_QR_PILOT_RECEIVE_ONLY=true`
- `SOFIA_QR_PILOT_REAL_SEND=false`

Si allowlist está activa y no hay números, inbound físico `qr_gateway` queda en `ALLOWLIST_REQUIRED`, crea registro inbound/conversación para auditoría y no llama a Sofía ni crea outbound.

## 13. Deduplicación

La suite API completa mantiene deduplicación QR PASS. El E2E F5 valida inbound simulado sin envío real.

## 14. Outbound bloqueado

`POST /admin/sofia/whatsapp/qr/test-send` con `phone/text` retorna `BLOCKED_REAL_SEND_DISABLED`, `sent=false`, `realSendingEnabled=false`.

## 15. Nequi/PAID bloqueado

Caso API F5 valida “Ya pagué por Nequi”: no aparece `SENT`, no se marca PAID, y el estado enterprise mantiene `whatsappCanMarkPaid=false`.

## 16. Quejas a humano

Caso API F5 valida “Me llegó mal el pedido” con reason `CUSTOMER_COMPLAINT`.

## 17. Producto inexistente

Caso API F5 valida “Quiero sushi” con reason `UNKNOWN_PRODUCT`, sin pedido, sin precio inventado y sin envío real.

## 18. Conversations

E2E F5 valida `/sofia/conversations` con inbound QR simulado y provider `qr_gateway`.

## 19. Governance/readiness

E2E F5 valida `/sofia`: QR card visible, `Receive-only`, `Sending real: false`, producción `BLOCKED`, DeepSeek real disabled y WhatsApp no marca PAID.

## 20. Screenshots

- `/tmp/sofia-qr-receive-only-physical-pilot-5/screenshots/01-sofia-qr-status.png`
- `/tmp/sofia-qr-receive-only-physical-pilot-5/screenshots/02-sofia-whatsapp-qr-management.png`
- `/tmp/sofia-qr-receive-only-physical-pilot-5/screenshots/03-sofia-conversations-inbound.png`
- `/tmp/sofia-qr-receive-only-physical-pilot-5/screenshots/04-sofia-sandbox.png`

## 21. Logs build/typecheck/tests

- API typecheck: `/tmp/sofia-qr-receive-only-physical-pilot-5/api-typecheck.log`
- Web typecheck: `/tmp/sofia-qr-receive-only-physical-pilot-5/web-typecheck.log`
- API build: `/tmp/sofia-qr-receive-only-physical-pilot-5/api-build.log`
- Web build: `/tmp/sofia-qr-receive-only-physical-pilot-5/web-build.log`
- API tests: `/tmp/sofia-qr-receive-only-physical-pilot-5/tests.log`
- API exit code: `/tmp/sofia-qr-receive-only-physical-pilot-5/api-test-exit-code.log`
- E2E F5: `/tmp/sofia-qr-receive-only-physical-pilot-5/e2e.log`
- E2E checkout/caja: `/tmp/sofia-qr-receive-only-physical-pilot-5/e2e-checkout-cash.log`
- Health after: `/tmp/sofia-qr-receive-only-physical-pilot-5/health-after.log`

## 22. Riesgos residuales

- QR físico real no fue escaneado en este entorno.
- Inbound real allowlist no fue probado con dispositivo físico.
- Rotación externa de secretos sigue pendiente.
- Producción, DeepSeek real, envío real y auto_safe con clientes permanecen bloqueados.

## 23. Qué queda bloqueado hasta rotación

- QR productivo.
- Envío real.
- DeepSeek real.
- Auto Safe productivo con clientes.
- Producción.

## 24. Próxima fase recomendada

Ejecutar piloto manual asistido con operador: configurar allowlist local en `.env`, escanear QR con WhatsApp Business, enviar mensajes reales desde número allowlist y recolectar evidencia `CONNECTED` + inbound real. No avanzar a envío real hasta rotación externa y fase explícita.

## 25. Decisión final

`SOFIA-QR-RECEIVE-ONLY-PHYSICAL-PILOT-5: GO CONDICIONADO`

La condición es la falta de escaneo físico real y mensaje real allowlist en este entorno. Los controles receive_only automatizados y regresiones críticas quedaron PASS.

## Tabla 1: Componente

| Componente | Resultado | Evidencia | Estado |
|---|---|---|---|
| Env piloto QR | Variables seguras agregadas, sin números reales | `.env.example`, `env.ts` | PASS |
| Allowlist | Inbound físico no allowlist queda en `ALLOWLIST_REQUIRED` | API critical F5 | PASS |
| Inbound QR simulado | Crea conversación/mensaje y aparece en conversations | E2E F5 | PASS |
| Inbound físico QR | No ejecutado por falta de dispositivo/operador | Evidencia manual pendiente | PENDIENTE |
| Outbound QR | Bloqueado con `BLOCKED_REAL_SEND_DISABLED` | API/E2E F5 | PASS |
| Governance | Producción BLOCKED, receive_only visible | E2E F5 | PASS |

## Tabla 2: Piloto QR

| Piloto QR | Resultado esperado | Resultado | Evidencia |
|---|---|---|---|
| QR connect | QR_READY, no envío real | PASS automatizado | E2E F5 |
| Escaneo físico | CONNECTED | No ejecutado | Entorno sin WhatsApp Business físico |
| Inbound allowlist real | Conversación receive_only | Pendiente físico | Próxima validación manual |
| Inbound simulado | Conversación visible | PASS | E2E F5 |
| Test send | Bloqueado | PASS | API/E2E F5 |

## Tabla 3: Bloqueo de seguridad

| Bloqueo de seguridad | Estado | Motivo | Evidencia |
|---|---|---|---|
| Producción | BLOCKED | Rotación externa pendiente | E2E F5 enterprise-status |
| DeepSeek real | Disabled | F5 no activa IA real | E2E F5 |
| Auto Safe producción | Disabled | F5 receive_only | E2E F5 |
| WhatsApp real send | Blocked | `WHATSAPP_QR_ALLOW_REAL_SEND=false` | API/E2E F5 |
| WhatsApp PAID | Blocked | `whatsappCanMarkPaid=false` | E2E F5 |

## Tabla 4: Gate

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `api-typecheck.log` |
| Web typecheck | PASS | `web-typecheck.log` |
| API build | PASS | `api-build.log` |
| Web build | PASS con warnings preexistentes | `web-build.log` |
| API tests | PASS, 12 suites, 224 tests, exit code 0 | `tests.log`, `api-test-exit-code.log` |
| E2E F5 | PASS, 2 tests | `e2e.log` |
| E2E Checkout/Caja | PASS, 2 tests | `e2e-checkout-cash.log` |
| Health | PASS | `health-after.log` |
| `test.skip` | Vacío | `test-skip-check.log` |
| `process.exit(0)` | Vacío | `process-exit-check.log` |
| Secret regression | Vacío | `secret-regression-check.log` |
| No real activation | Vacío | `no-real-activation-check.log` |
| UI secret check | Vacío | `ui-secret-check.log` |

## Tabla 5: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
|---|---|---|
| POS | Intacto | API critical + E2E checkout/caja |
| Domicilios | Intacto | API critical |
| Pagos | Intacto, WhatsApp no marca PAID | API/E2E F5 |
| Caja | Intacta | E2E checkout/caja |
| Stock | Intacto | API critical F5 |
| Checkout | Intacto | E2E checkout/caja |
| DeepSeek real | No activado | No real activation check |
| Envío WhatsApp real | No activado | API/E2E F5 |
