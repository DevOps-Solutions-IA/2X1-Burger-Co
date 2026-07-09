# CODEX-SOFIA-QR-PHYSICAL-CONNECTED-INBOUND-1D - Reporte final

## 1. Resumen ejecutivo

Se ejecutó la validación física 1D hasta el límite automatizable. El sistema generó QR real Baileys en `QR_READY`, con allowlist local configurada de forma sanitizada, storage escribible, `adapterReal=true`, `qrAvailable=true` y envío real bloqueado.

Durante la ventana de sondeo no se detectó escaneo físico con WhatsApp Business. El QR/socket cerró sin llegar a `CONNECTED`; por tanto no hubo inbound real allowlist ni conversación real nueva validable.

Decisión final: `GO CONDICIONADO`.

DeepSeek dry-run queda bloqueado porque 1D no cerró GO pleno.

## 2. Estado recibido

- `CODEX-SOFIA-QR-TRUTHFUL-STATE-FIX-1B`: GO.
- `CODEX-SOFIA-QR-STORAGE-SESSION-FIX-1C`: GO CONDICIONADO.
- Storage final: `/app/data/whatsapp-auth/whatsapp-sessions/sofia-main`.
- Estado inicial objetivo confirmado: `QR_READY`, `adapterReal=true`, `qrAvailable=true`, `realSendingEnabled=false`.

## 3. Allowlist sanitizada

Allowlist local ya configurada al iniciar 1D:

```text
SOFIA_QR_PILOT_ALLOWLIST_ENABLED=true
SOFIA_QR_PILOT_ALLOWED_PHONES=configured:true last4:5414 sha256_12:1837d4338123
SOFIA_QR_PILOT_RECEIVE_ONLY=true
SOFIA_QR_PILOT_REAL_SEND=false
```

No se imprimió el número completo.

## 4. QR_READY real

Resultado API sanitizado:

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

- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/qr-ready-summary.json`.
- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/qr-status-after-sanitized.json`.
- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/screenshots/01-qr-ready-real.png`.

## 5. Escaneo WhatsApp Business

No se detectó escaneo físico durante la ventana de sondeo. El sistema permaneció en `QR_READY` y luego pasó a `DISCONNECTED` por cierre de conexión.

Evidencia:

- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/connected-poll.log`.
- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/physical-poll-summary.json`.
- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/screenshots/02-not-connected-after-poll.png`.

## 6. CONNECTED real

No alcanzado.

Estado final:

```json
{
  "status": "DISCONNECTED",
  "connected": false,
  "adapterReal": false,
  "qrAvailable": false,
  "reason": "REAL_ADAPTER_NOT_AVAILABLE",
  "realSendingEnabled": false
}
```

## 7. Inbound real

No validado. Al no llegar a `CONNECTED`, no se pudo recibir inbound real desde el número allowlist.

## 8. Conversations

No se validó conversación real nueva de WhatsApp QR físico en esta fase. La condición queda pendiente hasta completar escaneo y mensajes reales.

## 9. Casos críticos

No se ejecutaron con inbound real porque no hubo `CONNECTED`.

Casos pendientes:

- `Hola`.
- `Qué trae el Maxi Family`.
- `Quiero un 2x1`.
- `Ya pagué por Nequi`.
- `Quiero hablar con alguien`.
- `Quiero sushi`.

## 10. SENT=0

Test-send bloqueado:

```json
{
  "result": "BLOCKED_REAL_SEND_DISABLED",
  "sent": false,
  "beforeOutboundToday": 0,
  "afterOutboundToday": 0,
  "realSendingEnabled": false
}
```

Evidencia:

- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/test-send-blocked.log`.
- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/outbound-sent-zero.log`.

## 11. Governance

El panel `/sofia` fue capturado al final de la ventana. Producción permanece bloqueada y no hay activación real.

Evidencia:

- `/tmp/codex-sofia-qr-physical-connected-inbound-1d/screenshots/04-governance-after-physical-window.png`.

## 12. Seguridad

Flags verificados:

- `DEEPSEEK_ENABLED=false`.
- `SOFIA_AUTO_REPLY_ENABLED=false`.
- `SOFIA_AUTO_SAFE_ENABLED=false`.
- `WHATSAPP_QR_ALLOW_REAL_SEND=false`.
- `WHATSAPP_MODE=receive_only`.
- `WHATSAPP_PROVIDER=qr_gateway`.

No se activó producción, DeepSeek real, auto reply, Auto Safe productivo ni envío real.

## 13. Build/typecheck

- Web typecheck: PASS.
- Web build: PASS con warnings ESLint preexistentes.
- API typecheck: PASS.
- API build: PASS.
- Health final: PASS.

## 14. Screenshots

- `01-qr-ready-real.png`: QR real listo.
- `02-not-connected-after-poll.png`: estado no conectado tras ventana física.
- `04-governance-after-physical-window.png`: governance posterior.

## 15. Riesgos residuales

- Falta escaneo físico con WhatsApp Business.
- Falta `CONNECTED`.
- Falta inbound real allowlist.
- Falta conversación real en `/sofia/conversations`.
- Falta validar casos críticos con mensajes reales.
- DeepSeek dry-run permanece bloqueado hasta GO físico real.

## 16. Decisión final

`CODEX-SOFIA-QR-PHYSICAL-CONNECTED-INBOUND-1D: GO CONDICIONADO`

Motivo: QR real Baileys y seguridad PASS, pero no hubo escaneo físico, `CONNECTED` ni inbound real.

## Tabla 1: QR físico

| QR físico | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| QR_READY real | `QR_READY`, `adapterReal=true`, `qrAvailable=true` | `qr-ready-summary.json`, `01-qr-ready-real.png` | PASS |
| Escaneo WhatsApp Business | No detectado | `connected-poll.log` | PENDING |
| CONNECTED real | No alcanzado | `physical-poll-summary.json` | PENDING |

## Tabla 2: Inbound real

| Inbound real | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| Mensaje allowlist | No ejecutado por falta de CONNECTED | `physical-poll-summary.json` | PENDING |
| Conversations | No hay conversación real nueva validada | Reporte 1D | PENDING |
| Provider/mode real | QR Gateway sigue en `receive_only` | `qr-ready-summary.json` | PASS |

## Tabla 3: Casos críticos

| Casos críticos | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| Maxi Family | Pendiente inbound real | Reporte 1D | PENDING |
| Nequi/PAID | No se marcó PAID; no hubo inbound real | `outbound-sent-zero.log` | SAFE_PENDING |
| Human required | Pendiente inbound real | Reporte 1D | PENDING |
| Unknown product | Pendiente inbound real | Reporte 1D | PENDING |

## Tabla 4: Seguridad

| Seguridad | Estado | Evidencia |
| --- | --- | --- |
| Envío real | Bloqueado | `test-send-blocked.log`, `outbound-sent-zero.log` |
| DeepSeek real | OFF | `precheck-safe-flags-sanitized.log` |
| Auto reply | OFF | `precheck-safe-flags-sanitized.log` |
| Auto Safe productivo | OFF | `precheck-safe-flags-sanitized.log` |
| Producción | Bloqueada | `qr-ready-summary.json` |
| Secret regression | Sin hallazgos | `secret-regression-check.log` |
| Real activation check | Sin hallazgos | `no-real-activation-check.log` |

## Tabla 5: Gate técnico

| Gate técnico | Resultado | Evidencia |
| --- | --- | --- |
| Health | PASS | `health-before.log`, `health-after.log` |
| API typecheck/build | PASS | `api-typecheck.log`, `api-build.log` |
| Web typecheck/build | PASS | `web-typecheck.log`, `web-build.log` |
| test.skip | Sin hallazgos | `test-skip-check.log` |
| process.exit(0) | Sin hallazgos | `process-exit-check.log` |

## Tabla 6: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
| --- | --- | --- |
| POS | Intacto | Sin cambios de código en flujo POS |
| Caja | Intacta | Sin cambios de código en flujo Caja |
| Stock | Intacto | Sin cambios de código en Stock |
| Checkout | Intacto | Sin cambios de Checkout |
| Domicilios | Intacto | Sin cambios de Domicilios |
| Pagos/precios/catálogo | Intactos | Sin cambios de lógica comercial |
