# Sofía Claude Direct Ultra Premium — Reporte final

Fecha: 2026-07-09. Repo: `/home/wundah/inventario`. Ejecutor: Claude Code (`/loop`), sin Ralph como controlador. Todos los cambios siguen sin commitear en `master` a la espera de revisión del usuario.

## 1. Resumen ejecutivo

Se auditó el working tree que dejó un proceso de Ralph muerto a mitad de la historia 3 del PRD, se conservó y terminó ese trabajo, y se continuó directamente con Claude Code para llevar las 4 rutas de Sofía (`/sofia`, `/sofia/conversations`, `/sofia/whatsapp-qr`, `/sofia/sandbox`) a una experiencia visual consistente con identidad morada, copy exacto del brief, separación honesta real/interna/sandbox/histórico, y reason codes técnicos colapsados por defecto. Se hicieron ajustes puntuales de backend (labels de reason codes, flag `noSessionAuth`) sin tocar POS, Caja, Stock, Checkout ni Domicilios. Los 4 gates obligatorios (typecheck/build web y api) pasan, los 2 greps de seguridad obligatorios no encuentran hallazgos reales, y se generaron las 8 capturas requeridas (desktop + mobile) más una verificación funcional adicional de la tarjeta de historial del sandbox con datos reales. Envío real, auto reply, Auto Safe productivo y producción permanecen bloqueados; WhatsApp sigue sin poder marcar PAID.

Se detectaron y documentan (sin corregir, por estar fuera de alcance) dos defectos preexistentes no introducidos por este trabajo: un overlap visual en la barra superior compartida (`app-shell.tsx`) en viewport mobile, y un carácter mal codificado en el nombre de un producto del catálogo ("Hamburguesa 2X1�").

**Adenda post-entrega (misma sesión):** al revisar visualmente el resultado con más detalle se encontró que las capturas desktop originales quedaban cortadas a 900px de alto porque el layout usa scroll interno (contenedor `overflow-y-auto`, no scroll de `body`), así que `page.screenshot({fullPage:true})` nunca capturó la mitad inferior de `/sofia` en desktop. Al corregir el método de captura (viewport alto) se encontró que esa mitad inferior sí tenía problemas reales de nivel premium: valores crudos de backend sin traducir (`paused`, `PENDING`, `GO_CONDICIONADO`, `BLOCKED`, `SUPERVISED_PREPRODUCTION`) mostrados como contenido principal en vez de estar humanizados, una lista plana sin iconos en "Pendientes y bloqueos", tarjetas de "Acciones permitidas/bloqueadas" con proporciones rotas (mucho espacio muerto por un problema de `align-items: stretch` en CSS grid), y dos instancias más del typo de acento "Sofia"/"Envio". Todo esto se corrigió en la misma sesión (ver secciones 3 y 4 actualizadas) y se volvió a verificar visualmente con capturas full-height correctas. Se documenta este error de proceso explícitamente porque el veredicto GO CONDICIONADO original se había basado en parte en capturas incompletas.

## 2. Diagnóstico inicial del working tree

Diagnóstico completo en `/tmp/sofia-claude-direct/diagnostico-inicial.md`. Resumen: el proceso de Ralph (`ralph build 1 --prd .agents/tasks/prd-sofia-ultra-premium.json --no-commit`) murió sin registrar fin de iteración, error ni entrada de progreso, dejando 6 componentes nuevos de alta calidad (`SofiaPageShell`, `SofiaSectionCard`, `SofiaScopeTabs`, `SofiaRiskBanner`, `SofiaConversationCard`, `SofiaSandboxCaseCard`) ya cableados en 3 de las 4 rutas, y `SofiaSandboxCaseCard` sin usar en ninguna parte. No se encontró ningún artefacto generado, mock fantasma, ni riesgo de seguridad en ese diff. Se conservó todo el trabajo de Ralph y se completó lo que dejó a medias.

## 3. Cambios backend

- `apps/api/src/modules/sofia/sofia.service.ts`: label de `MAXI_FAMILY_COPY_RISK` alineado a "Riesgo comercial" (antes "Riesgo en copy de Maxi Family"); agregado `noPii: true` y `noSessionAuth: true` al bloque `dataPolicy` del inbox de conversaciones.
- `apps/api/src/modules/sofia/governance/sofia-governance.service.ts`: agregado `noSessionAuth: true` al `dataPolicy` del dashboard summary.
- `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts`: agregado `noSessionAuth: true` y `noQrRaw: true` a la respuesta de `getCode()` (antes solo declaraba `noSecrets`, aunque `qrString` ya era `null` en la práctica).
- `apps/api/src/modules/sofia/governance/sofia-governance.service.ts` (adenda): typo corregido en `pendingChecks` — "Envio real interno diferido" → "Envío real interno diferido".

No se tocó lógica de negocio, flujos de pago, ni ningún endpoint de POS/Caja/Stock/Checkout/Domicilios. `realSendingEnabled` y `whatsappCanMarkPaid` siguen hardcodeados en `false` (defensa en profundidad ya existente, verificada, no modificada).

## 4. Cambios frontend

- `/sofia/page.tsx`: el hero ahora muestra "Centro de Gobierno Sofía" como título principal (antes era solo el eyebrow chico y el título grande decía "Consola supervisada"); descripción alineada al copy exacto del brief.
- `/sofia/conversations/page.tsx`: título, descripción y badges ya coincidían con el brief; se alineó el texto del estado vacío "Operación real pendiente" al copy exacto pedido.
- `/sofia/whatsapp-qr/page.tsx`: título "WhatsApp QR Gateway" promovido a encabezado principal (antes era el eyebrow y el título decía "Canal receive-only para pruebas supervisadas"); descripción alineada al copy exacto.
- `/sofia/sandbox/page.tsx`: título cambiado a "Sandbox Sofía"; descripción basada en el copy pedido con una salvedad de honestidad (ver sección 7); se agregó `SofiaRiskBanner` (ausente hasta ahora en esta ruta) y se cableó `SofiaSandboxCaseCard` en el historial, reemplazando el render manual.

**Adenda — mitad inferior de `/sofia` (encontrada tras corregir el método de captura, ver sección 1):**
- Nuevo helper `humanizeSofiaMode` y `humanizeScope` en `sofia-status-humanize.ts` (junto a los ya existentes `humanizeSecurityStatus`, `humanizeCheckStatus`, `humanizeEventStatus`), reexportados en `components/sofia/index.ts`.
- Paneles "Estado general" / "SafetyGuard" / "Seguridad / readiness" de `/sofia`: los valores `paused`, `PENDING`, `GO_CONDICIONADO`, `BLOCKED` ahora se muestran como "Pausada", "Pendiente", "Go condicionado", "Bloqueado".
- Badges del banner de riesgo principal ("Allowlist", "Security cleanup", "Scope"): ya no muestran `PENDING`/`GO_CONDICIONADO`/`SUPERVISED_PREPRODUCTION` crudos, ahora "Pendiente"/"Go condicionado"/"Preproducción supervisada".
- Tarjeta "WhatsApp QR" del dashboard: el valor ya no cae a `DISCONNECTED` crudo cuando no hay conexión ni QR disponible; ahora usa `humanizeEventStatus` → "Desconectado".
- "Pendientes y bloqueos": ahora distingue visualmente bloqueado (rojo, icono de bloqueo) de pendiente (ámbar, icono de reloj) en vez de una lista plana uniforme.
- "Acciones permitidas"/"Acciones bloqueadas": se agregó `content-start` al grid contenedor para eliminar el espacio muerto causado por el stretch por defecto de CSS grid — las tarjetas ahora se dimensionan a su contenido.
- Typos de acento corregidos: "Modo Sofia" → "Modo Sofía", "Sofia está en modo seguro" → "Sofía está en modo seguro", "...desde Sofia." → "...desde Sofía.".

## 5. Componentes creados/modificados

Creados por Ralph y verificados/conservados: `SofiaPageShell`, `SofiaSectionCard`, `SofiaScopeTabs`, `SofiaRiskBanner`, `SofiaConversationCard`, `SofiaSandboxCaseCard` (los 6 en `apps/web/src/components/sofia/`).

Modificado por esta sesión: ninguno de los componentes en sí — solo se completó su adopción en `/sofia/sandbox` (`SofiaSandboxCaseCard`, `SofiaRiskBanner`) y se ajustó copy en las páginas que los consumen.

Componentes recomendados por el brief que ya existían con otro nombre equivalente (no se renombraron para evitar romper referencias/tests): `SofiaPageHero` ≈ SofiaHero, `SofiaStatusPill`/`SofiaModeBadge` ≈ SofiaStatusBadge, `SofiaStatusCard` ≈ SofiaMetricCard, `SofiaTechnicalDetailsAccordion` ≈ SofiaTechnicalDetails, `SofiaEmptyState`, `SofiaScopeTabs` ≈ SofiaDataScopeTabs. `SofiaSecurityPanel`, `SofiaReadinessPanel` (existe como `SofiaReadinessGrid`), `SofiaQrStatusCard` (existe como `SofiaQrStatusPanel`) y `SofiaAiStatusCard`/`SofiaActionBar` no se crearon como componentes nuevos porque su función ya está cubierta por piezas existentes; forzar una migración 1:1 de nombres no aportaba valor visual y se priorizó no tocar código que funciona.

## 6. Mejoras por ruta

- **/sofia**: jerarquía visual corregida (título grande = "Centro de Gobierno Sofía"), badges dinámicos honestos (reflejan estado real, no texto estático), banner de riesgo ya premium desde el trabajo de Ralph.
- **/sofia/conversations**: tabs de scope y tarjetas de conversación con identidad morada, estado vacío alineado al copy exacto, reason codes colapsados en "Ver detalle técnico" (ya eran así antes de esta sesión).
- **/sofia/whatsapp-qr**: título promovido, guía de 6 pasos y paneles de prueba ya migrados a `SofiaSectionCard`.
- **/sofia/sandbox**: pasó de tener solo el `SofiaPageShell` a tener banner de riesgo, título alineado, e historial con tarjetas `PASS/FAIL/PENDIENTE` verificadas con datos reales (ver sección 8).

## 7. Separación real/sandbox/histórico

Confirmada end-to-end en backend (`sofia.service.ts`: `real`/`internalValidation`/`sandbox`/`historical` nunca se suman entre sí) y en frontend (tabs separados con conteos independientes, banners que declaran explícitamente "Sandbox e histórico no se suman como operación real"). Único matiz documentado: el copy obligatorio de `/sofia/sandbox` decía literalmente "Nada aquí representa operación real", pero el sandbox **sí** puede crear una orden operativa real en Domicilios/POS si se confirma un pedido de prueba hasta el final (funcionalidad preexistente, no introducida por esta sesión, con warnings ya visibles en la UI antes de este trabajo). Aplicar el copy literal habría sido una afirmación falsa y una violación del criterio "Estados honestos" del mismo brief, así que se usó una versión con salvedad explícita en vez de silenciar el riesgo o ignorar el copy pedido. Se documenta aquí como desviación deliberada.

## 8. Seguridad

- Grep `no_real_activation` (`WHATSAPP_QR_ALLOW_REAL_SEND=true`, `SOFIA_AUTO_REPLY_ENABLED=true`, `SOFIA_AUTO_SAFE_ENABLED=true`, `WHATSAPP_MODE=auto_safe`, `SOFIA_PRODUCTION_ENABLED=true`): **0 hallazgos**. Log: `/tmp/sofia-claude-direct/no-real-activation-check.log`.
- Grep `secret_scan` (API keys, `sk-...`, `data:image`, `qrString` con valor, `creds.json`, `session-auth`): 24 líneas, todas coincidencias de nombre de campo (`qrString: null`, tipos TypeScript, redacción por diseño) o referencias en reportes históricos previos — **0 secretos reales, 0 QR raw, 0 session auth expuesto**. Log: `/tmp/sofia-claude-direct/secret-check.log`.
- Frases prohibidas de Maxy Family (`papas grandes`, `papas familiares`, etc.): solo aparecen dentro de `forbiddenClaims`/`prohibitedClaims` (blocklists de `sofia-auto-safe.constants.ts`, `sofia-commercial-catalog.seed.ts`, `sofia-master-prompt.seed.ts`), nunca como copy comercial real.
- Valores de activación (`WHATSAPP_QR_ALLOW_REAL_SEND`, `SOFIA_AUTO_REPLY_ENABLED`, `SOFIA_AUTO_SAFE_ENABLED`) por defecto en `false` en `apps/api/src/config/env.ts`; `realSendingEnabled` en `sofia.service.ts` está hardcodeado con `&& false` como defensa adicional independiente del env var.
- `whatsappCanMarkPaid: false` hardcodeado; el único código que marca `PAID` está en `sofia-payment-link.service.ts`, disparado por webhooks de proveedor de pago (Bold/mock), no por decisión de la IA — no se tocó, está fuera de alcance.
- Capturas de pantalla revisadas manualmente: no se ven teléfonos completos (el `573001112233` visible es un valor de ejemplo prellenado en el formulario de prueba de inbound, no un dato de cliente real), no se ve QR raw, no se ven secretos.

## 9. Build/typecheck

Los 4 gates obligatorios pasan:

```
pnpm --filter @inventory-fastfood/web typecheck   -> PASS
pnpm --filter @inventory-fastfood/web build        -> PASS (solo warnings preexistentes no-explicit-any, ajenos a Sofía)
pnpm --filter @inventory-fastfood/api typecheck    -> PASS
pnpm --filter @inventory-fastfood/api build        -> PASS
```

Logs en `/tmp/sofia-claude-direct/web-typecheck.log`, `web-build.log`, `api-typecheck.log`, `api-build.log`. Re-ejecutados tras la adenda (typecheck web/api + build web/api) — siguen en PASS.

## 10. Screenshots

Los 8 requeridos, generados navegando la app real (Docker, imágenes `web` y `api` reconstruidas con todos los cambios, incluida la adenda) autenticado como admin de desarrollo:

- `01-sofia-desktop.png`, `02-sofia-mobile.png`
- `03-conversations-desktop.png`, `04-conversations-mobile.png`
- `05-whatsapp-qr-desktop.png`, `06-whatsapp-qr-mobile.png`
- `07-sandbox-desktop.png`, `08-sandbox-mobile.png`

Nota de método: las 4 capturas desktop se regeneraron con un viewport alto (1440×4200) en vez de depender de `fullPage:true` sobre el viewport estándar, porque el layout de la app usa un contenedor con `overflow-y-auto` interno en vez de scroll de `document.body` — `fullPage:true` sobre un viewport de 900px de alto solo capturaba esos primeros 900px, no la página completa. Las 4 capturas mobile no tuvieron este problema (en ese breakpoint el layout usa scroll de página normal).

Todos en `/tmp/sofia-claude-direct/screenshots/`. Además se generaron 2 capturas extra de verificación funcional (`verify-sandbox-history.png`, `verify-sandbox-history-2.png`) procesando un mensaje real de sandbox para confirmar que `SofiaSandboxCaseCard` renderiza correctamente con datos reales (resultado `PENDIENTE`, resumen de productos, siguiente acción).

## 11. Qué no se tocó

- POS, Caja, Stock, Checkout, Domicilios, precios, catálogo comercial (solo se leyó para auditoría).
- La regla Maxy Family (composición y frases prohibidas intactas).
- `WHATSAPP_QR_ALLOW_REAL_SEND`, `WHATSAPP_MODE`, `SOFIA_AUTO_REPLY_ENABLED`, `SOFIA_AUTO_SAFE_ENABLED`, `SOFIA_PRODUCTION_ENABLED` — sin cambios, todos en su valor seguro por defecto.
- El flujo de pagos (`sofia-payment-link.service.ts`, providers Bold/mock).
- `app-shell.tsx` (barra superior compartida con el overlap mobile detectado — es global a toda la app, no específico de Sofía; corregirlo está fuera del alcance de este PRD).
- El PRD JSON no se actualizó (las historias 4-10 siguen formalmente `open` en `.agents/tasks/prd-sofia-ultra-premium.json`); no se pidió explícitamente actualizarlo y se prefirió no tocarlo.

## 12. Pendientes

- Corregir el overlap del header compartido en mobile (`app-shell.tsx`) — bug preexistente, no de Sofía, fuera de alcance.
- Investigar el carácter mal codificado en "Hamburguesa 2X1�" en el catálogo comercial sandbox (dato de seed, no de este cambio).
- En `/sofia/whatsapp-qr` se dejaron deliberadamente los estados `DISCONNECTED`/`CONNECTED`/`QR_READY` sin traducir (a diferencia de los enums de negocio del dashboard que sí se humanizaron): son terminología técnica estándar de sesión WhatsApp, reconocible para el operador, distinta en naturaleza a jerga interna como `GO_CONDICIONADO` o `SUPERVISED_PREPRODUCTION`. Si el usuario prefiere traducirlos también, es un cambio menor de 5 minutos.
- Auditoría de seguridad más exhaustiva de historia 9 (esta sesión hizo el grep obligatorio + revisión dirigida, pero no un pentest completo) y QA responsive más exhaustivo de historia 8 (se revisó desktop/mobile en las 4 rutas con capturas full-height correctas, no todos los breakpoints intermedios tipo tablet).
- Reporte de readiness formal de historia 10: el backend (`sofia-readiness.service.ts`) y el frontend (`SofiaReadinessGrid`) ya existen y son consistentes; no se generó un documento de readiness separado más allá de este reporte.

## 13. Decisión final

Mejora fuerte y verificada end-to-end con capturas full-height correctas (visual + funcional + gates + seguridad), sin tocar módulos protegidos, sin activar nada real, sin secretos ni PII expuestos. La adenda de esta sesión corrigió un error propio de verificación (capturas desktop truncadas a 900px) y, al corregirlo, encontró y resolvió una brecha visual real en la mitad inferior de `/sofia` (enums crudos como contenido principal, proporciones de tarjetas rotas) — ya no queda ninguna ruta con ese problema. Quedan pendientes menores y ya documentados, todos fuera del alcance de Sofía (bug de header global preexistente, encoding de catálogo preexistente, profundización de historias 8/9/10 más allá de lo verificado aquí).

**SOFÍA CLAUDE DIRECT ULTRA PREMIUM: GO CONDICIONADO**
