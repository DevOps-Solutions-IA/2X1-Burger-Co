# SOFIA-WHATSAPP-QR-GATEWAY-4 Report

## 1. Resumen ejecutivo

Se implementó un WhatsApp QR Gateway dedicado para Sofía en modo controlado `receive_only`, separado de Hermes Agent y del WhatsApp interno POS. La fase entrega estado QR visible, contrato backend, endpoints admin, QR controlado, inbound normalizado, deduplicación, integración con conversations/governance/readiness y bloqueo explícito de envío real.

Decisión: `SOFIA-WHATSAPP-QR-GATEWAY-4: GO CONDICIONADO`.

Condición: no se realizó escaneo físico de WhatsApp QR por falta de dispositivo/sesión real en el entorno. El gateway queda adapter-ready y probado con `test-inbound` receive_only.

## 2. Estado recibido

- Auditoría maestra: GO.
- Seguridad/secrets: GO CONDICIONADO por rotación externa manual pendiente.
- Cerebro comercial F1: GO.
- Auto Safe F2: GO.
- Governance panel F3: GO.

## 3. Alcance real F4

- QR Gateway dedicado de Sofía.
- Receive-only controlado.
- Test inbound usando mismo pipeline Sofía WhatsApp.
- Outbound real bloqueado.
- Integración con `/sofia`, `/sofia/whatsapp-qr` y `/sofia/conversations`.
- Sin QR productivo, sin DeepSeek real, sin auto_safe producción.

## 4. Qué se creó

- `sofia-whatsapp-qr-gateway.types.ts`
- `sofia-whatsapp-qr-gateway.provider.ts`
- `sofia-whatsapp-qr-gateway.service.ts`
- `sofia-whatsapp-qr-gateway.controller.ts`
- `/sofia/whatsapp-qr`
- `tests/e2e/sofia-whatsapp-qr-gateway-4.spec.ts`

## 5. Qué se modificó

- `WhatsappProviderAdapter` y factory para `qr_gateway`.
- Env schema con variables QR seguras.
- `.env.example` con defaults seguros.
- `SofiaModule`.
- Governance/readiness para QR F4.
- `/sofia` card QR.
- `/sofia/conversations` copy/tipos QR.
- API critical tests.

## 6. Qué no se tocó

- POS.
- Domicilios.
- Caja.
- Stock.
- Checkout.
- Pagos manuales.
- Pagos online.
- DeepSeek real.
- Envío WhatsApp real.

## 7. Contrato QR Gateway

Se agregó `SofiaWhatsappQrStatusResponse` con provider, mode, status, conexión, QR, sesión sanitizada, métricas inbound/outbound, blockers, warnings y flags de seguridad.

## 8. Configuración segura

Defaults seguros:

- `WHATSAPP_PROVIDER=qr_gateway`
- `WHATSAPP_MODE=receive_only`
- `WHATSAPP_QR_ENABLED=false`
- `WHATSAPP_QR_ALLOW_REAL_SEND=false`
- `WHATSAPP_QR_ALLOW_RECEIVE=true`
- `WHATSAPP_QR_SANDBOX_ONLY=true`

## 9. Storage de sesión

Ruta sanitizada visible: `storage/whatsapp-sessions/sofia-main`.

El runtime no expone path absoluto. Si el contenedor no puede escribir el path relativo, el gateway no falla en F4 y registra warning sanitizado `SESSION_STORAGE_NOT_WRITABLE_IN_CURRENT_RUNTIME`.

## 10. Estado QR

Estados soportados: `DISABLED`, `DISCONNECTED`, `WAITING_QR`, `QR_READY`, `CONNECTED`, `RECONNECTING`, `FAILED`, `LOGGED_OUT`.

## 11. Provider QR o adaptador creado

`SofiaWhatsappQrGatewayProvider` normaliza inbound QR, marca provider `qr_gateway` y bloquea cualquier envío con `BLOCKED_REAL_SEND_DISABLED`.

## 12. Inbound receive_only

`POST /admin/sofia/whatsapp/qr/test-inbound` pasa por `SofiaWhatsappService.processInboundWebhook('qr_gateway')`, crea conversación, mensaje inbound, sugerencia outbound `SUGGESTED` y no envía real.

## 13. Outbound bloqueado

`POST /admin/sofia/whatsapp/qr/test-send` devuelve `BLOCKED_REAL_SEND_DISABLED`, `sent=false`, `realSendingEnabled=false`.

## 14. Endpoints admin QR

- `GET /admin/sofia/whatsapp/qr/status`
- `POST /admin/sofia/whatsapp/qr/connect`
- `GET /admin/sofia/whatsapp/qr/code`
- `POST /admin/sofia/whatsapp/qr/disconnect`
- `POST /admin/sofia/whatsapp/qr/logout`
- `POST /admin/sofia/whatsapp/qr/test-inbound`
- `POST /admin/sofia/whatsapp/qr/test-send`

## 15. Integración con governance/readiness

`enterprise-status` refleja:

- provider `qr_gateway`.
- `qrGatewayReady=true`.
- `qrReceiveOnlyReady=true`.
- `realSendingEnabled=false`.
- producción `BLOCKED`.

## 16. Card/página frontend QR

- `/sofia` muestra card QR Gateway receive-only.
- `/sofia/whatsapp-qr` muestra estado, QR controlado, test inbound, test send bloqueado y warnings.

## 17. Integración conversations

Inbound QR aparece en `/sofia/conversations` con provider `qr_gateway`.

## 18. Evidencia test inbound

E2E `sofia-whatsapp-qr-gateway-4.spec.ts`: PASS.

## 19. Evidencia deduplicación

API critical y E2E envían el mismo `externalMessageId` dos veces; la segunda respuesta devuelve `DUPLICATE_IGNORED`.

## 20. Evidencia test send bloqueado

API critical y E2E validan `BLOCKED_REAL_SEND_DISABLED`.

## 21. Evidencia no QR envío real

`realSendingEnabled=false` en status, governance y UI. Check no-real-activation vacío.

## 22. Evidencia no DeepSeek real

Status QR devuelve `deepSeekEnabled=false`; enterprise status mantiene `deepSeekReady=false`.

## 23. Evidencia no Auto Safe producción

Readiness mantiene producción bloqueada y `AUTO_SAFE_PRODUCTION_DISABLED`.

## 24. Evidencia no WhatsApp PAID

Enterprise status mantiene `payments.whatsappCanMarkPaid=false`.

## 25. Evidencia no secretos

`secret-regression-check.log` y `ui-secret-check.log` vacíos.

## 26. Evidencia no tocar POS/Domicilios/Pagos/Caja/Stock/Checkout

E2E Checkout/Caja PASS. API tests mantienen stock/cash/sales sin cambios en pruebas QR.

## 27. E2E QR

`/tmp/sofia-whatsapp-qr-gateway-4/e2e.log`: PASS, 2 tests passed.

## 28. Screenshots

- `/tmp/sofia-whatsapp-qr-gateway-4/screenshots/01-sofia-qr-card.png`
- `/tmp/sofia-whatsapp-qr-gateway-4/screenshots/02-sofia-whatsapp-qr-management.png`
- `/tmp/sofia-whatsapp-qr-gateway-4/screenshots/03-sofia-conversations-qr-inbound.png`
- `/tmp/sofia-whatsapp-qr-gateway-4/screenshots/04-sofia-sandbox-still-separated.png`

## 29. Logs build/typecheck/tests

- API typecheck: `/tmp/sofia-whatsapp-qr-gateway-4/api-typecheck.log`
- Web typecheck: `/tmp/sofia-whatsapp-qr-gateway-4/web-typecheck.log`
- API build: `/tmp/sofia-whatsapp-qr-gateway-4/api-build.log`
- Web build: `/tmp/sofia-whatsapp-qr-gateway-4/web-build.log`
- API tests: `/tmp/sofia-whatsapp-qr-gateway-4/tests.log`
- E2E QR: `/tmp/sofia-whatsapp-qr-gateway-4/e2e.log`
- E2E Checkout/Caja: `/tmp/sofia-whatsapp-qr-gateway-4/e2e-checkout-cash.log`

## 30. Riesgos residuales

- Rotación externa de secretos sigue pendiente.
- QR físico real no fue escaneado en este entorno.
- Envío real permanece bloqueado.
- DeepSeek real permanece desactivado.
- Auto Safe producción permanece deshabilitado.

## 31. Próxima fase recomendada

F5: Piloto QR receive_only con sesión física controlada, después de rotación externa manual, sin autoenvío real y con monitoreo de inbound.

## 32. Decisión final

`SOFIA-WHATSAPP-QR-GATEWAY-4: GO CONDICIONADO`

## Tabla 1: Componente

| Componente | Resultado | Evidencia | Estado |
|---|---|---|---|
| Contrato QR | Implementado | `sofia-whatsapp-qr-gateway.types.ts` | PASS |
| Provider QR | Implementado con envío bloqueado | `SofiaWhatsappQrGatewayProvider` | PASS |
| Service QR | Status, connect, code, inbound, send block | API critical | PASS |
| UI QR | `/sofia` y `/sofia/whatsapp-qr` | E2E screenshots | PASS |
| Conversations | Inbound QR visible | E2E conversations | PASS |

## Tabla 2: QR/WhatsApp Gate

| QR/WhatsApp Gate | Estado | Motivo | Evidencia |
|---|---|---|---|
| Receive-only | PASS | Test inbound usa pipeline Sofía | E2E QR |
| Deduplicación | PASS | Duplicado ignorado | API critical/E2E |
| Real send | BLOCKED | `BLOCKED_REAL_SEND_DISABLED` | API critical/E2E |
| Producción | BLOCKED | Rotación/auto_safe/real send pendientes | Enterprise status |
| WhatsApp PAID | BLOCKED | `whatsappCanMarkPaid=false` | Enterprise status |

## Tabla 3: Caso QR

| Caso QR | Resultado esperado | Resultado | Evidencia |
|---|---|---|---|
| Status inicial | `qr_gateway`, receive_only, send false | Cumple | E2E QR |
| Connect | QR controlado disponible | Cumple | Screenshot QR management |
| Test inbound | Conversación y mensaje inbound | Cumple | E2E QR |
| Duplicado | `DUPLICATE_IGNORED` | Cumple | E2E QR |
| Test send | `BLOCKED_REAL_SEND_DISABLED` | Cumple | E2E QR |

## Tabla 4: Gate

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `api-typecheck.log` |
| Web typecheck | PASS | `web-typecheck.log` |
| API build | PASS | `api-build.log` |
| Web build | PASS | `web-build.log` |
| API tests | PASS, 223 tests | `tests.log` |
| E2E QR | PASS | `e2e.log` |
| E2E governance | PASS | `e2e-governance.log` |
| E2E Checkout/Caja | PASS | `e2e-checkout-cash.log` |
| No test.skip/process.exit | PASS | checks vacíos |
| No secrets/no real activation | PASS | checks vacíos |

## Tabla 5: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
|---|---|---|
| DeepSeek real | Desactivado | QR/enterprise status |
| Auto Safe producción | Bloqueado | Readiness |
| WhatsApp real send | Bloqueado | Test send |
| POS/Domicilios | Intactos | Smoke/E2E |
| Pagos/Caja/Stock/Checkout | Intactos | API tests/E2E |
