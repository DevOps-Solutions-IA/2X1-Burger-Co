# CODEX-SOFIA-QR-TRUTHFUL-STATE-FIX-1B - Reporte final

## 1. Resumen ejecutivo

Se corrigió la contradicción operativa de `/sofia/whatsapp-qr`: la UI ya no muestra éxito si el backend reporta que no existe adapter real, no hay QR real, no hay conexión o no hay QR emitido por Baileys.

Resultado final: **CODEX-SOFIA-QR-TRUTHFUL-STATE-FIX-1B: GO**.

## 2. Problema observado

La UI mostraba toast verde `QR receive-only preparado` aunque el estado real indicaba:

- `Status: DISCONNECTED`
- `Adapter real: No disponible`
- `Connected: No`
- `QR pendiente`
- `Sin QR activo`

## 3. Causa raíz del falso éxito

El frontend ejecutaba `toast.success('QR receive-only preparado')` en cualquier `onSuccess` HTTP del endpoint `connect`, sin validar:

- `adapterReal`
- `qrAvailable`
- `connected`
- `status`
- QR real emitido por Baileys

Además, el contrato del backend no exponía `ok`, `reason` ni `operatorMessage`, lo que obligaba a la UI a inferir estado.

## 4. Cambios backend

Archivos:

- `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.types.ts`
- `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts`

Cambios:

- Se agregó `ok`.
- Se agregó `reason`.
- Se agregó `operatorMessage`.
- Se agregó `lastErrorCode`.
- Se agregó `lastErrorMessage` sanitizado.
- Se agregó `lastConnectionUpdateAt`.
- `QR_READY` público solo se permite con QR real de Baileys.
- `CONNECTED` público solo se permite con socket Baileys vivo.
- `lastError` y `lastErrorMessage` sanitizan paths internos y secretos.
- `connect()` devuelve estado honesto: si falla adapter real, `ok=false`.

## 5. Cambios frontend

Archivo:

- `apps/web/src/app/(app)/sofia/whatsapp-qr/page.tsx`

Cambios:

- Se eliminó el toast ambiguo `QR receive-only preparado`.
- Se agregaron toasts condicionados por estado real.
- El botón ahora dice `Solicitar QR real`.
- La card muestra acción requerida y `reason`.
- La UI solo muestra QR si:
  - `adapterReal=true`
  - `qrAvailable=true`
  - `status='QR_READY'`
  - `qrImageDataUrl` existe
- Se reemplazó `Código QR controlado` por estado honesto: `QR real de WhatsApp` o `Sin QR activo`.

## 6. Contrato `connect`

El resultado ahora incluye:

- `ok`
- `status`
- `adapterReal`
- `qrAvailable`
- `connected`
- `realSendingEnabled=false`
- `reason`
- `operatorMessage`

Validación real actual:

- `status=FAILED`
- `ok=false`
- `adapterReal=false`
- `qrAvailable=false`
- `connected=false`
- `reason=REAL_ADAPTER_FAILED`
- `operatorMessage=Adapter real falló. Revisa logs backend sanitizados.`

Evidencia:

- `/tmp/codex-sofia-qr-truthful-state-fix-1b/connect-result-sanitized.json`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/api-truth-validation-final.log`

## 7. Estados corregidos

- `adapterReal=false`: no permite mensaje de QR preparado.
- `qrAvailable=false`: no renderiza QR.
- `connected=false`: no muestra conexión.
- `FAILED`: muestra acción requerida.
- `WAITING_QR`: se comunica como espera, no como éxito.
- `QR_READY`: solo si existe QR real escaneable.
- `CONNECTED`: solo si Baileys abre conexión real.

## 8. Toasts corregidos

Toasts nuevos:

- `WhatsApp Business conectado`
- `QR real de WhatsApp listo para escanear`
- `Esperando QR real de WhatsApp`
- `Adapter real no disponible` / mensaje operativo real

Evidencia:

- `/tmp/codex-sofia-qr-truthful-state-fix-1b/toast-language-check-final.log`

## 9. QR fake eliminado o confinado

No se detectó `sofia-qr-receive-only:*`.

No se detectó `QR receive-only preparado`.

No se detectó `Código QR controlado`.

Solo queda `sofia-qr-receive-only-warning` como `data-testid` técnico, no como copy de éxito.

Evidencia:

- `/tmp/codex-sofia-qr-truthful-state-fix-1b/fake-qr-language-audit-final.log`

## 10. Validación UI

La UI muestra estado honesto:

- `FAILED`
- `Adapter real: No disponible`
- `Connected: No`
- `DeepSeek real: disabled`
- Acción requerida con `REAL_ADAPTER_FAILED`

Evidencia visual:

- `/tmp/codex-sofia-qr-truthful-state-fix-1b/screenshots/01-initial-disconnected-truth.png`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/screenshots/02-connect-result-truth.png`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/screenshots/03-no-false-success-toast.png`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/screenshots/04-status-card-truth.png`

## 11. Screenshots

Screenshots generados con login UI real de desarrollo. No se guardó token ni QR raw.

## 12. Build/typecheck

- Web typecheck: PASS.
- Web build: PASS.
- API typecheck: PASS.
- API build: PASS.
- Docker build/recreate API/Web: PASS.
- Health post-deploy: PASS.

Evidencias:

- `/tmp/codex-sofia-qr-truthful-state-fix-1b/web-typecheck.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/web-build.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/api-typecheck-final.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/api-build-final.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/docker-build-api-web.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/docker-up-api-web.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/health-after-deploy.log`

## 13. Seguridad

- No DeepSeek real.
- No auto reply.
- No Auto Safe productivo.
- No envío real WhatsApp.
- No producción.
- No PAID.
- No Prisma reset.
- No bypass Prisma Guard.
- No secretos expuestos.
- No números completos expuestos.
- No QR raw expuesto.

Evidencias:

- `/tmp/codex-sofia-qr-truthful-state-fix-1b/secret-regression-check-final.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/no-real-activation-check-final.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/test-skip-check.log`
- `/tmp/codex-sofia-qr-truthful-state-fix-1b/process-exit-check.log`

## 14. Qué no se tocó

- POS.
- Caja.
- Stock.
- Checkout.
- Domicilios.
- Pagos.
- Catálogo.
- Precios.
- Reglas Maxi Family.

## 15. Riesgos residuales

- El adapter real falla por permiso de escritura en storage (`REAL_ADAPTER_FAILED`). El error ya se muestra sanitizado.
- Para validación QR física posterior hay que corregir el storage writable del contenedor o configurar `WHATSAPP_QR_SESSION_PATH` a una ruta escribible.
- No se ejecutó DeepSeek dry-run porque la precondición del siguiente prompt exige `CODEX-SOFIA-QR-REAL-END-TO-END-1: GO`, y esa fase cerró GO CONDICIONADO.

## 16. Decisión final

**CODEX-SOFIA-QR-TRUTHFUL-STATE-FIX-1B: GO**

## Tabla 1: Contradicción

| Contradicción | Corrección | Evidencia | Estado |
|---|---|---|---|
| Toast verde sin QR real | Toast condicionado por `status`, `adapterReal`, `qrAvailable`, `connected` | `page.tsx` | PASS |
| `connect` sin resultado operativo claro | Contrato con `ok`, `reason`, `operatorMessage` | `connect-result-sanitized.json` | PASS |
| QR visible sin pruebas suficientes | QR solo si `adapterReal && qrAvailable && status='QR_READY' && qrImageDataUrl` | `page.tsx` | PASS |
| Error con path interno | Error sanitizado | `connect-result-sanitized.json` | PASS |

## Tabla 2: Estado QR

| Estado QR | Mensaje UI | Condición | Estado |
|---|---|---|---|
| `adapterReal=false` | Adapter real no disponible | Sin socket real | PASS |
| `WAITING_QR` | Esperando QR real de WhatsApp | Socket iniciado sin QR | PASS |
| `QR_READY` | QR real listo para escanear | QR Baileys real disponible | PASS |
| `CONNECTED` | WhatsApp Business conectado | Baileys conectado | PASS |
| `FAILED` | Adapter real falló | Error sanitizado | PASS |

## Tabla 3: Gate técnico

| Gate técnico | Resultado | Evidencia |
|---|---|---|
| Web typecheck | PASS | `web-typecheck.log` |
| Web build | PASS | `web-build.log` |
| API typecheck | PASS | `api-typecheck-final.log` |
| API build | PASS | `api-build-final.log` |
| Docker deploy | PASS | `docker-up-api-web.log` |
| Health | PASS | `health-after-deploy.log` |

## Tabla 4: Seguridad

| Seguridad | Estado | Evidencia |
|---|---|---|
| DeepSeek real | OFF | no real activation check vacío |
| Auto reply | OFF | no real activation check vacío |
| Auto Safe productivo | OFF | no real activation check vacío |
| WhatsApp real send | OFF | no real activation check vacío |
| Secretos | No expuestos | secret check vacío |
| QR raw | No expuesto en UI | screenshot + código |

## Tabla 5: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
|---|---|---|
| POS | Intacto | Sin cambios |
| Caja | Intacta | Sin cambios |
| Stock | Intacto | Sin cambios |
| Checkout | Intacto | Sin cambios |
| Domicilios | Intacto | Sin cambios |
| Pagos | Intactos | Sin cambios |
| Catálogo/precios | Intactos | Sin cambios |
