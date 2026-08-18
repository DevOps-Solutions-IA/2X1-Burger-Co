# Evidencia — canary receive-only de WhatsApp con binding exacto de cuenta

- Fecha: 2026-08-17
- Registrado por: sesión de agente (Claude Code), a petición del owner
- Alcance: documentación de hechos ya verificados. No se modificó código runtime.

## Qué se validó

Se conectó un socket Baileys real (no simulado) a un número de WhatsApp real, con
el binding exacto de cuenta (`WHATSAPP_EXPECTED_ACCOUNT_ID` / `WHATSAPP_EXPECTED_BUSINESS_IDENTITY`
/ `WHATSAPP_EXPECTED_SESSION_OWNER`) verificado y coincidente, y se recibió un mensaje
entrante real de un tercero, procesado y auditado correctamente por el pipeline
receive-only existente.

## Dónde ocurrió (entorno)

**Entorno aislado local, no productivo**: proyecto Docker Compose independiente
`inventario-sofia-qr-canary`, levantado en el worktree `/home/wundah/inventario-sofia-qr-canary`,
puertos `3303` (web) / `4303` (api) / `55442` (postgres), base de datos propia y
separada. **No** es el stack normal de Inventario (3301/4300) ni el entorno de
revisión visual compartido (3302/4302). Ninguno de los dos fue tocado, reiniciado
ni afectado — verificado (`docker ps`: ambos con más de 2 días de uptime continuo
al momento de este reporte).

**Tampoco es una ejecución del pipeline formal de canary del proyecto**
(`infra/release/canary-deploy.sh` / `docker-compose.canary.yml`). Es un entorno
ad-hoc construido en esta sesión específicamente para poder generar y escanear un
QR real sin tocar ningún entorno compartido. Esta distinción importa: la evidencia
aquí documentada demuestra que el mecanismo de binding funciona correctamente con
una cuenta real, pero no sustituye una ejecución del pipeline de canary formal si
el proceso del programa lo requiere como paso separado.

## Código que hizo esto posible

El binding exacto de cuenta requiere conocer de antemano el `@lid` que WhatsApp
asigna a la cuenta — un valor que no puede conocerse sin una primera conexión, y
que el código no expone en ningún log/auditoría (a propósito). Para resolver esto
se implementó un modo de descubrimiento acotado, de un solo uso, que captura la
identidad y cierra la sesión de inmediato sin llegar nunca a `CONNECTED` ni
procesar mensajes reales.

- Rama: `feature/sofia-qr-discovery-mode` (push a `origin`, **no fusionada a `main`**)
- Commits relevantes: `77566e5`, `4e3422e`, `9d8d43b`, `2b2c8bf`, `c0b0e64`
- El HEAD de esa rama (`c0b0e64`) es exactamente el código que produjo la
  evidencia de este reporte (confirmado por el timestamp de creación del
  contenedor Docker vs. los timestamps de los logs citados abajo).
- Nuevo flag `WHATSAPP_QR_DISCOVERY_MODE` (default `false`, prohibido en
  `NODE_ENV=production`) — no toca ninguna de las 4 capas de bloqueo de
  producción existentes; solo permite, cuando está explícitamente activo,
  omitir la comparación de identidad exacta durante la captura inicial.
- De paso se encontró y corrigió un bug preexistente y sin relación con el modo
  de descubrimiento: la prueba de escritura de sesión (`writeReadAndRemoveTestFile`)
  abría el archivo con `'wx'` (solo escritura) e intentaba leerlo del mismo
  descriptor — Node siempre lanza `EBADF` en ese caso. Esto bloqueaba **cualquier**
  `connect()` real, con o sin modo de descubrimiento. Corregido a `'wx+'`.

## Binding de cuenta utilizado (enmascarado)

- Número conectado: `5731****03` (según lo reporta `GET /admin/sofia/whatsapp/qr/status`, campo `phoneNumber`, ya enmascarado por el propio backend)
- `WHATSAPP_QR_SESSION_NAME` / `WHATSAPP_EXPECTED_SESSION_OWNER`: `sofia-canary`
- `@lid` de negocio: capturado y configurado como `WHATSAPP_EXPECTED_BUSINESS_IDENTITY`; no se reproduce el valor completo en este documento (dato operativo, no público)

## Hechos verificados

| Hecho | Verificado | Evidencia |
|---|---|---|
| Conexión Baileys real (`CONNECTED`), no simulada | **Sí** | Log: `"opened connection to WA"` → `"WhatsApp QR Gateway CONNECTED (5731****03)"`; `GET .../qr/status` → `status:"CONNECTED"`, `connected:true`, `adapterReal:true`, `reason:"CONNECTED_REAL"` |
| Binding exacto de cuenta verificado (no solo "algún" QR) | **Sí** | `connectedAccountBinding()` comparó `providerAccountId`/`businessIdentity`/`sessionOwner` contra los 3 valores `WHATSAPP_EXPECTED_*` configurados; sin esa coincidencia exacta la conexión se hubiera rechazado (`rejectConnectedSocket`), como se verificó explícitamente en los intentos previos con binding vacío |
| `outbound` (envío real) = false | **Sí** | `WHATSAPP_QR_ALLOW_REAL_SEND=false`, `SOFIA_QR_PILOT_REAL_SEND=false` en todo momento; respuesta de estado: `realSendingEnabled:false`, blocker `REAL_SEND_DISABLED` presente; `outboundToday: 0` |
| `autoReply` = false | **Sí** | `SOFIA_AUTO_REPLY_ENABLED=false`; `autoReplyEnabled:false` en la respuesta de estado |
| `autoSafe` = false | **Sí** | `SOFIA_AUTO_SAFE_ENABLED=false`; blocker `AUTO_SAFE_PRODUCTION_DISABLED` presente en la respuesta de estado |
| Producción no modificada | **Sí** | Stack `inventario-api-1`/`inventario-web-1`/`inventario-postgres-1` (puertos 3301/4300/5432) con >2 días de uptime continuo, sin reinicios, verificado con `docker ps` al cierre de este reporte |
| Entorno normal de desarrollo no modificado | **Sí** | Mismo punto anterior — el trabajo ocurrió exclusivamente en el proyecto Docker `inventario-sofia-qr-canary`, aislado |
| Ningún mensaje real de salida (outbound) fue emitido | **Sí** | `outboundToday: 0` en el momento de este reporte; ningún código de envío (`sendTextMessage`/`sendMediaMessage`) fue invocado — el canal solo procesó inbound |
| Mensaje real entrante recibido y auditado | **Sí** | Un mensaje real, de un número **no** incluido en el allowlist de piloto, llegó, se procesó y quedó registrado con `processingStatus: "ALLOWLIST_REQUIRED"` — comportamiento correcto y esperado (fail-closed): el pipeline funciona de punta a punta, y el allowlist bloqueó correctamente un remitente no autorizado en vez de procesarlo |

## Qué NO se validó ni se afirma aquí

- No se validó el pipeline formal de canary del proyecto (`infra/release/canary-deploy.sh`).
- No se resolvió el gate de "commercial allowlist" (decisión de negocio sobre qué números pueden interactuar en producción real) — el allowlist de este entorno solo contenía el número de prueba del owner.
- No se activó, probó ni preparó ningún envío real, auto-reply, auto-safe, ni ninguna de las demás capacidades cubiertas por la auditoría READ-ONLY previa.
- El entorno aislado (`inventario-sofia-qr-canary`) es efímero y local — esta evidencia no implica que exista infraestructura persistente de canary en ningún ambiente compartido.
