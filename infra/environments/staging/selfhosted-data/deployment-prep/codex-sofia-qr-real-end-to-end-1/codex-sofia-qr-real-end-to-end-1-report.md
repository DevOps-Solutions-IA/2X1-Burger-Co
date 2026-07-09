# CODEX-SOFIA-QR-REAL-END-TO-END-1 - Reporte final

## 1. Diagnóstico QR fake anterior

La auditoría local no encontró el patrón fake `sofia-qr-receive-only:*` en `apps/api/src`, `apps/web/src` ni `packages`.

Evidencia:

- `/tmp/codex-sofia-qr-real-end-to-end-1/qr-real-code-audit.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/qr-real-code-audit-after.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/qr-real-diagnosis.md`

## 2. Confirmación QR real Baileys

El flujo principal del QR Gateway de Sofía usa Baileys real:

- `useMultiFileAuthState`
- `fetchLatestBaileysVersion`
- socket Baileys real
- `connection.update`
- `update.qr`
- `messages.upsert`

Se endureció el contrato público para que `QR_READY` y `CONNECTED` no se deriven de estado persistido.

## 3. Archivos modificados

- `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts`
- `apps/web/src/app/(app)/sofia/whatsapp-qr/page.tsx`

## 4. Adapter real

`adapterReal=true` se deriva de `Boolean(this.real.socket)`. Sin socket vivo, el estado público no puede afirmar adapter real operativo.

## 5. Estado `adapterReal`

No se validó físicamente en UI con operador. La lógica queda lista para mostrar `adapterReal=true` solo cuando se inicializa el socket Baileys real.

## 6. QR_READY real

`QR_READY` queda ligado a `connection.update.qr` de Baileys. El endpoint ya no usa QR persistido como prueba pública.

## 7. CONNECTED real

`CONNECTED` queda ligado a `this.real.connectionStatus === 'CONNECTED'` con socket Baileys vivo. El estado persistido ya no prueba conexión pública.

## 8. Inbound real

El inbound real se recibe por `messages.upsert` y se reenvía a `SofiaWhatsappService.processInboundWebhook` con provider `qr_gateway` y mode `receive_only`.

No se recibió inbound físico real en esta ejecución porque no se configuró allowlist ni se escaneó QR con WhatsApp Business desde este entorno.

## 9. Critical cases

No se validaron físicamente los mensajes:

- `Hola`
- `Qué trae el Maxi Family`
- `Quiero un 2x1`
- `Ya pagué por Nequi`
- `Quiero hablar con alguien`
- `Quiero sushi`

Quedan pendientes de operador físico.

## 10. Outbound SENT=0

El provider `qr_gateway` bloquea `sendTextMessage` y `sendMediaMessage` con `BLOCKED_REAL_SEND_DISABLED`.

No se pudo medir `SENT=0` en flujo físico real porque no hubo inbound real ni test-send autenticado desde UI en esta ejecución.

## 11. Test-send bloqueado

La implementación de provider sigue devolviendo bloqueo controlado:

- `sent=false`
- `realSendingEnabled=false`
- `BLOCKED_REAL_SEND_DISABLED`

## 12. Seguridad

No se activó:

- DeepSeek real.
- Auto reply.
- Auto Safe productivo.
- WhatsApp real send.
- Producción.

Checks vacíos:

- `/tmp/codex-sofia-qr-real-end-to-end-1/secret-regression-check.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/no-real-activation-check.log`

## 13. Build/typecheck

- Web typecheck: PASS.
- Web build: PASS.
- API typecheck: PASS.
- API build: PASS.
- Docker build API/Web: PASS.
- Docker recreate API/Web: PASS.
- Health post-deploy: PASS.

Evidencias:

- `/tmp/codex-sofia-qr-real-end-to-end-1/web-typecheck.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/web-build.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/api-typecheck.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/api-build.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/docker-build-api-web.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/docker-up-api-web.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/health-after-deploy.log`

## 14. Checks

- `test.skip`: vacío.
- `process.exit(0)`: vacío.
- Secret regression: vacío.
- No real activation: vacío.
- Health final: PASS.

Evidencias:

- `/tmp/codex-sofia-qr-real-end-to-end-1/test-skip-check.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/process-exit-check.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/health-after.log`

## 15. Screenshots

No se generaron screenshots físicos porque falta operador físico para configurar allowlist, preparar QR, escanear WhatsApp Business y recibir inbound real.

## 16. Prisma Guard

No se ejecutaron API tests completos porque `infra/scripts/test-api.sh` alcanza `infra/scripts/prepare-test-db.sh`, que ejecuta `prisma migrate reset --force`.

Se documentó como:

`BLOCKED_BY_PRISMA_AI_GUARD_SAFE`

Evidencias:

- `/tmp/codex-sofia-qr-real-end-to-end-1/test-api-script-audit.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/prepare-test-db-script-audit.log`
- `/tmp/codex-sofia-qr-real-end-to-end-1/tests.log`

## 17. Allowlist

Se creó script local seguro para configurar allowlist sin imprimir el número completo:

`/tmp/codex-sofia-qr-real-end-to-end-1/configure_allowlist.py`

No se ejecutó porque requiere operador y número real. El número completo no debe pegarse en chat ni incluirse en reportes.

## 18. Decisión

**CODEX-SOFIA-QR-REAL-END-TO-END-1: GO CONDICIONADO**

Motivo: el adapter real Baileys queda endurecido y build/typecheck pasan, pero falta evidencia física obligatoria para GO:

- QR escaneado por WhatsApp Business.
- `CONNECTED` real.
- Inbound real allowlist.
- Conversación visible en `/sofia/conversations`.
- `SENT=0` medido durante el flujo real.

## Tabla 1: QR/Baileys

| Criterio | Resultado | Evidencia | Estado |
|---|---|---|---|
| QR fake `sofia-qr-receive-only:*` | No detectado | `qr-real-code-audit-after.log` | PASS |
| Baileys real | Detectado en servicio QR | `qr-real-diagnosis.md` | PASS |
| `QR_READY` desde `update.qr` | Endurecido | servicio QR | PASS |
| `CONNECTED` desde socket real | Endurecido | servicio QR | PASS |
| QR raw en UI | Oculto | página `/sofia/whatsapp-qr` | PASS |

## Tabla 2: Flujo físico

| Criterio | Resultado | Evidencia | Estado |
|---|---|---|---|
| Allowlist real | Pendiente operador | script creado | CONDITION |
| QR escaneado | No ejecutado | falta operador | CONDITION |
| CONNECTED real | No validado | falta escaneo | CONDITION |
| Inbound real | No recibido | falta CONNECTED | CONDITION |
| Conversations real | No validado | falta inbound real | CONDITION |

## Tabla 3: Seguridad

| Criterio | Resultado | Evidencia | Estado |
|---|---|---|---|
| WhatsApp real send | Bloqueado | provider QR | PASS |
| DeepSeek real | No activado | no-real-activation vacío | PASS |
| Auto reply | No activado | no-real-activation vacío | PASS |
| Auto Safe productivo | No activado | no-real-activation vacío | PASS |
| Secretos | No expuestos | secret-regression vacío | PASS |
| Prisma reset | No ejecutado | Prisma Guard documentado | PASS |

## Tabla 4: Gates técnicos

| Gate | Resultado | Evidencia | Estado |
|---|---|---|---|
| Health | PASS | `health-after.log` | PASS |
| Web typecheck | PASS | `web-typecheck.log` | PASS |
| Web build | PASS | `web-build.log` | PASS |
| API typecheck | PASS | `api-typecheck.log` | PASS |
| API build | PASS | `api-build.log` | PASS |
| Docker build/recreate | PASS | `docker-build-api-web.log`, `docker-up-api-web.log` | PASS |
| Health post-deploy | PASS | `health-after-deploy.log` | PASS |
| API tests | Bloqueado seguro | `tests.log` | CONDITION |

## Tabla 5: Qué no se tocó

| Área | Estado | Evidencia |
|---|---|---|
| POS | Intacto | Sin cambios |
| Caja | Intacta | Sin cambios |
| Stock | Intacto | Sin cambios |
| Checkout | Intacto | Sin cambios |
| Domicilios | Intacto | Sin cambios |
| Pagos | Intacto | Sin cambios |
| Catálogo/precios | Intacto | Sin cambios |
| Maxi Family | Intacto | Sin cambios |
