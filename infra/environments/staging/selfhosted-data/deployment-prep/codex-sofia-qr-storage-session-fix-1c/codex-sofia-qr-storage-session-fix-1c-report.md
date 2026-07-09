# CODEX-SOFIA-QR-STORAGE-SESSION-FIX-1C - Reporte final

## 1. Resumen ejecutivo

Se corrigió la ruta de storage/sesión de Baileys para el WhatsApp QR Gateway de Sofía. El contenedor API ya no depende de `/app/storage`, que no existía/no era escribible, y ahora usa el volumen persistente `whatsapp_auth` montado en `/app/data/whatsapp-auth`.

Resultado principal: el endpoint QR pasó de fallo de adapter/storage a `QR_READY` real con `adapterReal=true`, `qrAvailable=true`, `storageWritable=true` y `sessionStorageReady=true`. No se activó envío real, DeepSeek, auto reply, Auto Safe productivo ni producción.

Decisión final: `GO CONDICIONADO`, porque el QR real fue generado, pero no se ejecutó escaneo físico ni inbound real en esta fase.

## 2. Estado recibido

- `CODEX-SOFIA-QR-TRUTHFUL-STATE-FIX-1B`: GO.
- UI y backend ya reportaban estados honestos.
- Estado previo observado: `FAILED`, `adapterReal=false`, `qrAvailable=false`, `reason=REAL_ADAPTER_FAILED`.
- Riesgo residual: adapter real fallando por ruta de storage/sesión no escribible dentro del contenedor.

## 3. Diagnóstico storage

La auditoría inicial confirmó que el contenedor API corre como `node` (`uid=1000`) y que `/app/storage` no existía. El compose ya tenía un volumen persistente y escribible: `whatsapp_auth:/app/data/whatsapp-auth`.

Se eligió `/app/data/whatsapp-auth/whatsapp-sessions/sofia-main` como storage efectivo de sesión porque:

- Está dentro del contenedor API.
- Está montado sobre volumen Docker persistente.
- Es escribible por `node`.
- No vive dentro del repo ni se publica por nginx.
- No requiere `chmod 777`.

## 4. Causa raíz

El default `WHATSAPP_QR_SESSION_PATH=./storage/whatsapp-sessions` se resolvía dentro del contenedor como `/app/storage/whatsapp-sessions`. Esa ruta no estaba garantizada por el Dockerfile ni por compose. Baileys necesitaba un directorio de auth state escribible antes de inicializar `useMultiFileAuthState`.

## 5. Ruta final de sesión

Ruta runtime efectiva:

```text
/app/data/whatsapp-auth/whatsapp-sessions/sofia-main
```

Ruta mostrada de forma sanitizada por API:

```text
data/whatsapp-auth/whatsapp-sessions/sofia-main
```

## 6. Permisos

Write-test dentro del contenedor API:

```text
uid=1000(node) gid=1000(node)
ok
```

Evidencia: `/tmp/codex-sofia-qr-storage-session-fix-1c/container-write-test-after-deploy.log`.

## 7. Docker/volumen

Se agregó override de entorno al servicio `api`:

```yaml
WHATSAPP_QR_SESSION_PATH: /app/data/whatsapp-auth/whatsapp-sessions
```

El volumen existente permanece:

```yaml
whatsapp_auth:/app/data/whatsapp-auth
```

## 8. `.gitignore`

`.gitignore` ya protegía:

```text
storage/whatsapp-sessions/
apps/api/storage/whatsapp-sessions/
```

La ruta final usada en Docker vive en un volumen nombrado, no en una carpeta versionada del repo.

## 9. Cambios backend

Se actualizó `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts` para:

- Resolver el storage antes de inicializar Baileys.
- Crear el directorio de sesión si no existe.
- Ejecutar write-test seguro.
- Devolver `QR_SESSION_STORAGE_NOT_WRITABLE` si falla la escritura.
- Reportar `storageWritable` y `sessionStorageReady`.
- Mantener `realSendingEnabled=false`.
- Mantener QR raw fuera del status público.

También se actualizó el contrato en `sofia-whatsapp-qr-gateway.types.ts`.

## 10. Cambios compose/env

Se modificó `docker-compose.yml` con un override runtime seguro para `WHATSAPP_QR_SESSION_PATH`. No se modificó `.env` con secretos ni se imprimió su contenido completo.

Flags seguros verificados:

- `DEEPSEEK_ENABLED=false`.
- `SOFIA_AUTO_REPLY_ENABLED=false`.
- `SOFIA_AUTO_SAFE_ENABLED=false`.
- `WHATSAPP_QR_ALLOW_REAL_SEND=false`.
- `WHATSAPP_MODE=receive_only`.

## 11. Storage write-test

Evidencia:

- `/tmp/codex-sofia-qr-storage-session-fix-1c/container-write-test.log`.
- `/tmp/codex-sofia-qr-storage-session-fix-1c/container-write-test-after-deploy.log`.
- `/tmp/codex-sofia-qr-storage-session-fix-1c/session-storage-count.json`.

## 12. Estado QR posterior

Resumen API sanitizado:

```json
{
  "afterStatus": "QR_READY",
  "afterOk": true,
  "adapterReal": true,
  "qrAvailable": true,
  "connected": false,
  "reason": "BAILEYS_QR_READY",
  "storageWritable": true,
  "sessionStorageReady": true,
  "realSendingEnabled": false,
  "deepSeekEnabled": false,
  "autoReplyEnabled": false
}
```

Evidencia:

- `/tmp/codex-sofia-qr-storage-session-fix-1c/qr-storage-api-summary.json`.
- `/tmp/codex-sofia-qr-storage-session-fix-1c/status-after-sanitized.json`.
- `/tmp/codex-sofia-qr-storage-session-fix-1c/connect-result-sanitized.json`.

## 13. QR_READY o WAITING_QR

Resultado alcanzado: `QR_READY`.

El QR fue generado por Baileys y el status incluyó:

- `adapterReal=true`.
- `qrAvailable=true`.
- `reason=BAILEYS_QR_READY`.
- `operatorMessage=QR real de WhatsApp disponible para escanear.`

## 14. CONNECTED

No validado en esta fase. No hubo operador físico escaneando el QR con WhatsApp Business.

## 15. Inbound

No validado en esta fase. Requiere escaneo físico y mensaje real desde número allowlist.

## 16. Seguridad

No se activó:

- DeepSeek real.
- Envío real WhatsApp.
- Auto reply.
- Auto Safe productivo.
- Producción.
- WhatsApp PAID.

No se ejecutó Prisma reset ni migración destructiva.

## 17. Build/typecheck

- Web typecheck: PASS.
- Web build: PASS con warnings ESLint preexistentes.
- API typecheck: PASS.
- API build: PASS.
- Docker build API/Web: PASS.
- Health final: PASS.

Evidencia en `/tmp/codex-sofia-qr-storage-session-fix-1c/`.

## 18. Screenshots

Capturas generadas:

- `/tmp/codex-sofia-qr-storage-session-fix-1c/screenshots/01-storage-ready.png`.
- `/tmp/codex-sofia-qr-storage-session-fix-1c/screenshots/02-qr-ready-or-waiting.png`.

## 19. Riesgos residuales

- Falta escaneo físico de WhatsApp Business.
- Falta validar `CONNECTED`.
- Falta inbound real desde allowlist.
- Falta validar persistencia post-scan de credenciales reales.
- API tests completos no se ejecutaron para evitar Prisma Guard/destructivos.

## 20. Decisión final

`CODEX-SOFIA-QR-STORAGE-SESSION-FIX-1C: GO CONDICIONADO`

La condición es operativa, no de storage: ya existe QR real `QR_READY` con Baileys y storage escribible, pero falta operador físico para escanear y validar inbound real.

## Tabla 1: Storage

| Storage | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| Ruta sesión | Cambiada a volumen persistente `/app/data/whatsapp-auth/whatsapp-sessions` | `docker-compose.yml`, `docker-compose-config-session-check.log` | PASS |
| Usuario contenedor | API corre como `node` | `container-write-test-after-deploy.log` | PASS |
| Escritura | Write-test devuelve `ok` | `container-write-test-after-deploy.log` | PASS |
| Git/session safety | Sesión no vive en repo versionado | `storage-diagnosis.md`, `.gitignore` | PASS |

## Tabla 2: QR

| QR | Resultado | Evidencia | Estado |
| --- | --- | --- | --- |
| Adapter real | `adapterReal=true` | `qr-storage-api-summary.json` | PASS |
| Storage status | `storageWritable=true`, `sessionStorageReady=true` | `status-after-sanitized.json` | PASS |
| QR real | `QR_READY`, `qrAvailable=true`, `reason=BAILEYS_QR_READY` | `connect-result-sanitized.json` | PASS |
| Connected | No hubo escaneo físico | Reporte 1C | PENDING |
| Inbound real | No hubo operador/allowlist real en esta fase | Reporte 1C | PENDING |

## Tabla 3: Seguridad

| Seguridad | Estado | Evidencia |
| --- | --- | --- |
| Envío real WhatsApp | Bloqueado | `realSendingEnabled=false`, `no-real-activation-check.log` |
| DeepSeek real | Desactivado | `deepSeekEnabled=false`, `session-env-sanitized.log` |
| Auto reply | Desactivado | `autoReplyEnabled=false`, `session-env-sanitized.log` |
| Auto Safe productivo | Desactivado | `SOFIA_AUTO_SAFE_ENABLED=false` |
| Secret regression | Sin hallazgos | `secret-regression-check.log` |

## Tabla 4: Gate técnico

| Gate técnico | Resultado | Evidencia |
| --- | --- | --- |
| Docker build API/Web | PASS | `docker-build-api-web.log` |
| Docker up/health | PASS | `docker-up-api-web.log`, `health-after-deploy.log` |
| API typecheck | PASS | `api-typecheck.log` |
| API build | PASS | `api-build.log` |
| Web typecheck | PASS | `web-typecheck.log` |
| Web build | PASS | `web-build.log` |
| Prisma destructivo | No ejecutado | Política 1C |

## Tabla 5: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
| --- | --- | --- |
| POS | Intacto | Sin cambios de alcance |
| Caja | Intacta | Sin cambios de alcance |
| Stock | Intacto | Sin cambios de alcance |
| Checkout | Intacto | Sin cambios de alcance |
| Domicilios | Intacto | Sin cambios de alcance |
| Pagos/precios/catálogo | Intactos | Sin cambios de alcance |
