# CODEX-SOFIA-QR-PHYSICAL-SCAN-ONLY-1E - Reporte final

## 1. Resumen ejecutivo

Se ejecutó la validación física interactiva 1E sin nueva implementación pesada. El QR real Baileys fue generado y escaneado con WhatsApp Business. El gateway alcanzó `CONNECTED` real y recibió inbound real por `qr_gateway` en modo `receive_only`.

La fase no puede cerrar `GO` pleno porque los eventos reales recibidos quedaron bloqueados por allowlist (`ALLOWLIST_REQUIRED`): el número real emisor no coincide con la allowlist configurada de forma sanitizada (`last4=5414`). Por seguridad no se relajó la allowlist, no se simuló inbound allowlist y no se marcó la fase como GO.

Decisión final: `GO CONDICIONADO`.

## 2. Estado recibido

- `CODEX-SOFIA-QR-TRUTHFUL-STATE-FIX-1B`: GO.
- `CODEX-SOFIA-QR-STORAGE-SESSION-FIX-1C`: GO CONDICIONADO.
- `CODEX-SOFIA-QR-PHYSICAL-CONNECTED-INBOUND-1D`: GO CONDICIONADO.
- Storage Baileys corregido.
- QR real Baileys ya probado en `QR_READY`.

## 3. Precheck seguro

Flags verificados:

```text
WHATSAPP_PROVIDER=qr_gateway
WHATSAPP_MODE=receive_only
WHATSAPP_QR_ENABLED=true
WHATSAPP_QR_ALLOW_RECEIVE=true
WHATSAPP_QR_ALLOW_REAL_SEND=false
SOFIA_QR_PILOT_ALLOWLIST_ENABLED=true
SOFIA_QR_PILOT_RECEIVE_ONLY=true
SOFIA_QR_PILOT_REAL_SEND=false
DEEPSEEK_ENABLED=false
SOFIA_AUTO_REPLY_ENABLED=false
SOFIA_AUTO_SAFE_ENABLED=false
```

Allowlist sanitizada:

```text
allowlistConfigured=true
allowedPhoneLast4=5414
allowedPhoneSha256_12=1837d4338123
```

## 4. QR_READY real

Se encontró sesión `LOGGED_OUT`; se ejecutó logout controlado y se solicitó QR nuevo. Resultado:

```json
{
  "status": "QR_READY",
  "ok": true,
  "connected": false,
  "adapterReal": true,
  "qrAvailable": true,
  "reason": "BAILEYS_QR_READY",
  "realSendingEnabled": false,
  "deepSeekEnabled": false,
  "autoReplyEnabled": false,
  "productionBlocked": true
}
```

Evidencia:

- `/tmp/codex-sofia-qr-physical-scan-only-1e/qr-ready-after-logout-summary.json`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/01-qr-ready-real-before-scan.png`.

## 5. Ventana de escaneo

Se inició polling interactivo y se pidió al operador escanear con WhatsApp Business. El sondeo detectó:

```text
status=CONNECTED
connected=true
adapterReal=true
qrAvailable=false
reason=CONNECTED_REAL
realSendingEnabled=false
```

Evidencia:

- `/tmp/codex-sofia-qr-physical-scan-only-1e/connected-poll.log`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/connected-status-sanitized.json`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/02-connected-real.png`.

## 6. CONNECTED real

Resultado: PASS.

El QR fue escaneado y el gateway quedó conectado con socket real Baileys:

- `status=CONNECTED`.
- `connected=true`.
- `adapterReal=true`.
- `mode=receive_only`.
- `realSendingEnabled=false`.

## 7. Inbound real

Resultado: inbound real recibido, pero no procesado como allowlist.

Evidencia de inbound real:

- `provider=qr_gateway`.
- `source=REAL_BAILEYS_INBOUND`.
- `processingStatus=ALLOWLIST_REQUIRED`.
- `errorMessage=Número fuera de allowlist piloto QR.`

El evento real recibido no coincide con la allowlist configurada, por tanto no se generó conversación allowlist válida ni procesamiento comercial.

Evidencia:

- `/tmp/codex-sofia-qr-physical-scan-only-1e/inbound-events-sanitized.json`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/inbound-summary.json`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/03-inbound-real-conversations.png`.

## 8. Conversations

La pantalla `/sofia/conversations` fue capturada. La fase no valida conversación allowlist procesada porque los eventos reales quedaron bloqueados por allowlist.

## 9. Casos críticos

No se consideran PASS porque el inbound real no pasó allowlist.

Casos pendientes tras corregir allowlist:

- `Hola`.
- `Qué trae el Maxi Family`.
- `Quiero un 2x1`.
- `Ya pagué por Nequi`.
- `Quiero hablar con alguien`.
- `Quiero sushi`.

## 10. SENT=0

Resultado: PASS.

```json
{
  "outboundToday": 0,
  "realSendingEnabled": false,
  "sent": false,
  "reason": "BLOCKED_REAL_SEND_DISABLED",
  "outboundSentDuring1E": 0
}
```

Evidencia:

- `/tmp/codex-sofia-qr-physical-scan-only-1e/outbound-sent-zero.log`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/test-send-blocked.log`.

## 11. Test-send bloqueado

Resultado: PASS.

El endpoint de test-send devolvió bloqueo controlado `BLOCKED_REAL_SEND_DISABLED`. No hubo envío real.

## 12. Governance

Se capturó `/sofia` después de conexión e inbound real. Producción sigue bloqueada, DeepSeek OFF, real send OFF, auto reply OFF y WhatsApp no marca PAID.

Evidencia:

- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/05-governance-after-connected-inbound.png`.

## 13. Build/typecheck

- Web typecheck: PASS.
- Web build: PASS con warnings ESLint preexistentes.
- API typecheck: PASS.
- API build: PASS.
- Health final: PASS.

## 14. Seguridad

No se activó:

- DeepSeek real.
- Auto reply.
- Auto Safe productivo.
- Producción.
- Envío real WhatsApp.
- WhatsApp PAID.

No se ejecutó Prisma reset ni bypass de Prisma Guard.

## 15. Screenshots

- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/01-qr-ready-real-before-scan.png`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/02-connected-real.png`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/03-inbound-real-conversations.png`.
- `/tmp/codex-sofia-qr-physical-scan-only-1e/screenshots/05-governance-after-connected-inbound.png`.

## 16. Riesgos residuales

- La allowlist local no corresponde al número real emisor de los mensajes físicos.
- Falta repetir inbound real con el número correcto en allowlist.
- Falta validar casos críticos comerciales con inbound allowlist procesado.
- DeepSeek dry-run permanece bloqueado hasta cerrar un GO real con allowlist.

## 17. Decisión final

`CODEX-SOFIA-QR-PHYSICAL-SCAN-ONLY-1E: GO CONDICIONADO`

Motivo: QR físico y CONNECTED real PASS, inbound real PASS a nivel transporte, pero inbound allowlist/conversations procesadas no PASS por `ALLOWLIST_REQUIRED`.

## Tabla 1: QR físico

| QR físico | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| QR_READY real | QR Baileys real generado | `qr-ready-after-logout-summary.json`, screenshot 01 | PASS |
| Escaneo WhatsApp Business | Detectado por polling | `connected-poll.log` | PASS |
| CONNECTED real | `status=CONNECTED`, `connected=true` | `connected-status-sanitized.json`, screenshot 02 | PASS |

## Tabla 2: Inbound real

| Inbound real | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| Transporte real | Eventos `REAL_BAILEYS_INBOUND` recibidos | `inbound-events-sanitized.json` | PASS |
| Allowlist | Eventos bloqueados como `ALLOWLIST_REQUIRED` | `inbound-events-sanitized.json` | BLOCKED |
| Conversations procesada | No validada como allowlist | screenshot 03, eventos | PENDING |

## Tabla 3: Casos críticos

| Casos críticos | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| Maxi Family | No procesado por allowlist mismatch | `ALLOWLIST_REQUIRED` | PENDING |
| Nequi/PAID | No se marcó PAID; no se procesó por allowlist | `outbound-sent-zero.log` | SAFE_PENDING |
| Human required | No procesado por allowlist mismatch | `ALLOWLIST_REQUIRED` | PENDING |
| Unknown product | No procesado por allowlist mismatch | `ALLOWLIST_REQUIRED` | PENDING |

## Tabla 4: Seguridad

| Seguridad | Estado | Evidencia |
| --- | --- | --- |
| Envío real | Bloqueado | `test-send-blocked.log` |
| SENT real | 0 | `outbound-sent-zero.log` |
| DeepSeek | OFF | `precheck-safe-flags.log` |
| Auto reply | OFF | `precheck-safe-flags.log` |
| Auto Safe productivo | OFF | `precheck-safe-flags.log` |
| Producción | Bloqueada | QR/governance status |
| Secret regression | Sin hallazgos | `secret-regression-check.log` |
| No real activation | Sin hallazgos | `no-real-activation-check.log` |

## Tabla 5: Gate técnico

| Gate técnico | Resultado | Evidencia |
| --- | --- | --- |
| Health | PASS | `health-before.log`, `health-after.log` |
| Web typecheck/build | PASS | `web-typecheck.log`, `web-build.log` |
| API typecheck/build | PASS | `api-typecheck.log`, `api-build.log` |
| test.skip | Sin hallazgos | `test-skip-check.log` |
| process.exit(0) | Sin hallazgos | `process-exit-check.log` |

## Tabla 6: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
| --- | --- | --- |
| POS | Intacto | Sin cambios de código |
| Caja | Intacta | Sin cambios de código |
| Stock | Intacto | Sin cambios de código |
| Checkout | Intacto | Sin cambios de código |
| Domicilios | Intacto | Sin cambios de código |
| Pagos/precios/catálogo | Intactos | Sin cambios de código |
