# Sofía Extreme Live Dashboard — Reporte final

Fecha: 2026-07-09. Repo: `/home/wundah/inventario`. Ejecutor: Claude Code (`/loop`), sin Ralph. Contexto: el cierre previo `SOFÍA CLAUDE DIRECT ULTRA PREMIUM: GO CONDICIONADO` fue rechazado explícitamente por el owner por no alcanzar nivel visual premium — la UI era técnicamente correcta pero se leía como "panel administrativo con cards", no como centro de control vivo. Este loop corrige eso.

## 1. Resumen ejecutivo

Se rediseñó `/sofia` desde cero con una arquitectura de "AI Operations Command Center": hero con pulso live, medidor circular de readiness (11/16, severidad por color), 4 tarjetas de señal viva (WhatsApp QR / IA / SafetyGuard / Producción) con puntos de estado pulsantes, comparación de barras real-vs-interno, checklist de bloqueadores priorizado, matriz compacta de acciones permitidas/bloqueadas, y un feed de actividad reciente con eventos reales de auditoría (antes inexistente en la UI). Se conectaron dos endpoints reales que ya existían en el backend pero nunca se habían consumido desde el frontend: `GET /admin/sofia/readiness` (checklist completo, historia 10) y `GET /admin/sofia/governance/events` (auditoría real). Se recuperaron y conectaron dos componentes premium que Ralph/sesiones previas habían construido pero dejado huérfanos: `SofiaReadinessGrid` y `SofiaTimeline`. Se redujo el copy largo en las 4 rutas. Se corrigió una fuga de reason codes crudos en el nuevo feed de actividad (`ADDRESS_MISSING`, `P0_COMMERCIAL`, etc.) antes de cerrar. Los 4 gates pasan, los 2 greps de seguridad no encuentran hallazgos, y las 8 capturas se generaron contra la app real en Docker.

## 2. Diagnóstico visual severo

Documento completo en `/tmp/sofia-extreme-live-dashboard/diagnostico-visual-severo.md`. Resumen: la UI anterior no tenía ninguna figura visual que no fuera texto — cero barras, cero anillos, cero puntos de estado con color+movimiento. Las 3 cards de "Estado general/SafetyGuard/Readiness" (texto plano) se fusionaron en 1 gauge + 4 señales vivas. Las 2 cards de "datos reales/validación interna" (grids de números) se fusionaron en 1 comparación de barras. La lista de "Pendientes y bloqueos" se convirtió en checklist priorizado. Las 2 cajas de "Acciones permitidas/bloqueadas" se convirtieron en una matriz compacta de chips.

## 3. Qué se rediseñó

| Ruta | Problema anterior | Corrección | Estado |
|---|---|---|---|
| `/sofia` | 3 cards de texto plano (Estado general/SafetyGuard/Readiness) sin ninguna figura visual | Gauge circular de readiness + 4 `SofiaLiveSignalCard` con dot pulsante | Corregido |
| `/sofia` | 2 cards de números sueltos para real vs. interno | `SofiaScopeComparison`: barras pareadas con etiqueta directa | Corregido |
| `/sofia` | Lista plana de "Pendientes y bloqueos" sin jerarquía | `SofiaBlockerChecklist`: prioridad Alto/Medio + icono por fila | Corregido |
| `/sofia` | 2 cajas de texto para acciones permitidas/bloqueadas, con espacio muerto (bug de `align-items:stretch`) | `SofiaActionMatrix`: chips compactos, sin espacio muerto | Corregido |
| `/sofia` | Sin ninguna señal de "sistema vivo"; refetch de 30s invisible al usuario | Chip "Live · fecha" con `SofiaLiveStatusDot` pulsante en el hero | Corregido |
| `/sofia` | Sin actividad reciente en la UI (endpoint existía, no se consumía) | `SofiaTimeline` conectado a `GET /admin/sofia/governance/events` | Corregido |
| `/sofia` | Checklist completo de readiness (historia 10) nunca expuesto en UI | `SofiaReadinessGrid` conectado a `GET /admin/sofia/readiness`, detrás de un toggle "Ver checklist completo" | Corregido |
| `/sofia/whatsapp-qr` | Estado del socket (`DISCONNECTED`) mostrado crudo en 3 lugares | Humanizado (`Desconectado`) + `SofiaLiveStatusDot` junto al título de estado | Corregido |
| `/sofia/whatsapp-qr` | Banner de receive-only con 28 palabras | Recortado a 2 frases cortas | Corregido |
| `/sofia/sandbox` | Historial en columna única sin conteo agregado | "Matriz de casos" en grid de 2 columnas + contador PASS/FAIL/PENDIENTE | Corregido |
| `/sofia/conversations` | Banner de acciones bloqueadas con 16 palabras | Recortado a título corto + 1 frase | Corregido |

## 4. Componentes creados

| Componente | Dato real usado | Visualización | Estado |
|---|---|---|---|
| `SofiaLiveStatusDot` | n/a (recibe tone del caller) | Punto de color con anillo `animate-ping` | Nuevo |
| `SofiaProgressBar` | n/a (recibe value/tone) | Barra con track del mismo hue que el fill | Nuevo |
| `SofiaReadinessGauge` | `passedChecks`/`blockedChecks`/`pendingChecks` (o checklist real de `/admin/sofia/readiness`) | Meter circular SVG, severidad por color | Nuevo |
| `SofiaLiveSignalCard` | `whatsappQr`, `ai`, `safetyGuard.real`, `general.productionBlocked` | Card con dot pulsante + chips + última lectura | Nuevo |
| `SofiaBlockerChecklist` | `security.blockedChecks` / `security.pendingChecks` | Lista priorizada Alto/Medio con icono | Nuevo |
| `SofiaScopeComparison` | `conversations.*`, `whatsappQr.inboundToday`, `safetyGuard.*` | Barras pareadas real (morado) vs. interno (gris) | Nuevo |
| `SofiaActionMatrix` | n/a (copy fijo del brief) | Grid 2 columnas de chips con icono | Nuevo |
| `SofiaReadinessGrid` | `GET /admin/sofia/readiness` → `checklist[]` (16 items reales) | Grid agrupado por categoría con pill PASS/WARNING/BLOCKED | Recuperado y conectado (existía sin uso) |
| `SofiaTimeline` | `GET /admin/sofia/governance/events` → eventos reales de auditoría | Timeline vertical con tipo/estado/detalle/hora | Recuperado y conectado (existía sin uso) |

No se creó `SofiaTechnicalDrawer`: `SofiaTechnicalDetailsAccordion` ya cumplía exactamente esa función (colapsado por defecto, sin ruido) desde antes de este loop.

## 5. Textos reducidos

| Texto anterior | Texto nuevo | Motivo |
|---|---|---|
| "Sofía está en modo seguro. Faltan validaciones finales antes de operar con clientes reales. La vista principal no suma sandbox, mocks ni validaciones internas como operación real." | "Modo seguro activo. Producción bloqueada." + "Pedidos reales siguen en POS y Domicilios. Sofía no envía WhatsApp real ni confirma pagos." | 28 → 9 + 12 palabras; el detalle de scope ya lo cubren las señales vivas de abajo |
| "QR Gateway está disponible solo para receive-only/controlado. Envío real, auto reply y auto_safe con clientes permanecen bloqueados. DeepSeek solo puede operar como dry-run." | "Solo receive-only. Envío real bloqueado." + "Auto reply y auto_safe con clientes permanecen apagados. DeepSeek solo opera en dry-run." | 27 → 5 + 11 palabras |
| "Envío real bloqueado, Auto reply OFF, PAID bloqueado y producción bloqueada. Sandbox e histórico no se suman como operación real." | "Envío, auto reply y PAID bloqueados" + "Sandbox e histórico no se suman como operación real." | 20 → 5 + 8 palabras |
| "Siguiente acción: {nextAction}" (sandbox) | "Acción: {nextAction}" | Recorte directo |

## 6. Qué pasó a detalle técnico

`GO_CONDICIONADO`, `PENDING`, `BLOCKED`, `SUPERVISED_PREPRODUCTION`, `qr_gateway`, `fallback rules`, reason codes crudos y endpoint paths permanecen exclusivamente dentro de `SofiaTechnicalDetailsAccordion` (colapsado por defecto) en las 4 rutas. Ningún valor de esos permanece como contenido principal fuera de esa sección — incluido el feed de actividad nuevo, donde se detectó y corrigió una fuga real (ver §9).

## 7. Mejoras por ruta

- **/sofia**: reconstruida con la jerarquía completa pedida (hero → gauge → 4 señales → comparación → bloqueadores/acciones → actividad → navegación → detalle técnico). Above-the-fold (primeros ~900px) muestra hero, banner y gauge — igual que pide el brief.
- **/sofia/whatsapp-qr**: estado del socket humanizado y con dot pulsante; resto de la funcionalidad (connect/disconnect/logout/test-inbound/test-send) intacta.
- **/sofia/sandbox**: historial convertido en "Matriz de casos" con contador PASS/FAIL/PENDIENTE agregado; resto de la funcionalidad intacta.
- **/sofia/conversations**: banner recortado; tabs, cards y estado vacío ya eran sólidos desde el loop anterior, no se rearquitecturó (según alcance del brief, foco en `/sofia`).

## 8. Separación real/sandbox/histórico

Sin cambios de comportamiento — la comparación de barras nueva (`SofiaScopeComparison`) hace más visible, no menos, que "validación interna no cuenta como operación real" (nota explícita bajo las barras). Ningún dato de sandbox/histórico se sumó a los conteos reales.

## 9. Seguridad

| Check | Resultado | Evidencia |
|---|---|---|
| `no_real_activation` grep | 0 hallazgos | `/tmp/sofia-extreme-live-dashboard/no-real-activation-check.log` |
| `secret_scan` grep | 26 líneas, todas falsos positivos por nombre de campo (`qrString`) o referencias a reportes previos — 0 secretos reales | `/tmp/sofia-extreme-live-dashboard/secret-check.log` |
| Frases prohibidas Maxy Family | Solo en blocklists (`forbiddenClaims`/`prohibitedClaims`), 0 como copy comercial | grep manual, sin log dedicado (mismo patrón que sesión anterior) |
| Fuga de reason codes en el nuevo feed de actividad | **Encontrada y corregida en esta misma sesión**: el feed de `governance/events` mostraba `ADDRESS_MISSING, ORDER_CONFIRMATION_MISSING`, `P0_COMMERCIAL`, `MAXI_FAMILY_COPY: CORRECTED_RESPONSE` crudos como contenido principal. Se agregó humanización por tipo de evento (`AUTO_SAFE_DECISION` → split + `humanizeReasonCode`; `COMMERCIAL_RULE` → split + `humanizeReasonCode`; fallback en cadena `humanizeEventStatus → humanizeEventType → humanizeReasonCode`) y se ampliaron los diccionarios (`P0_COMMERCIAL`, `MAXI_FAMILY_COPY_RISK`, `MAXI_FAMILY_COPY`, `CORRECTED_RESPONSE`, `COMMERCIAL_RULE`, `GOVERNANCE`) en `sofia-status-humanize.ts` | Verificado visualmente antes/después, ver §3 |
| `whatsappCanMarkPaid` / `realSendingEnabled` | Sin cambios, siguen hardcodeados en `false` | No se tocó backend de pagos/envío en este loop |
| POS/Caja/Stock/Checkout/Domicilios | No tocados | `git status` — solo archivos bajo `apps/web/src/app/(app)/sofia`, `apps/web/src/components/sofia`, `apps/api/src/modules/sofia` (ya modificados en el loop anterior, sin cambios nuevos de backend en este loop salvo el commit involuntario de rebuild) |

## 10. Build/typecheck

```
pnpm --filter @inventory-fastfood/web typecheck   -> PASS
pnpm --filter @inventory-fastfood/web build        -> PASS (1 error de lint por import sin usar, encontrado y corregido en esta sesión antes del cierre; resto son warnings preexistentes no-explicit-any ajenos a Sofía)
pnpm --filter @inventory-fastfood/api typecheck    -> PASS
pnpm --filter @inventory-fastfood/api build        -> PASS
```

Nota: `tsc --noEmit` (typecheck) no detecta imports sin usar — ese error solo lo atrapa `next build` (ESLint). Se corrigieron 2 imports sin usar (`SofiaOperatorTone` en `SofiaReadinessGauge.tsx`, `Ban` en `/sofia/page.tsx`) antes de que el build pasara limpio.

## 11. Screenshots

Las 8 capturas, generadas contra la app real (Docker, imágenes `web`+`api` reconstruidas) con viewport alto (1440×4600 desktop) para capturar la página completa, ya que el layout usa scroll interno:

| Screenshot | Archivo | Estado |
|---|---|---|
| `/sofia` desktop | `01-sofia-desktop.png` | Generado, revisado |
| `/sofia` mobile | `02-sofia-mobile.png` | Generado, revisado |
| `/sofia/conversations` desktop | `03-conversations-desktop.png` | Generado |
| `/sofia/conversations` mobile | `04-conversations-mobile.png` | Generado |
| `/sofia/whatsapp-qr` desktop | `05-whatsapp-qr-desktop.png` | Generado, revisado |
| `/sofia/whatsapp-qr` mobile | `06-whatsapp-qr-mobile.png` | Generado |
| `/sofia/sandbox` desktop | `07-sandbox-desktop.png` | Generado, revisado |
| `/sofia/sandbox` mobile | `08-sandbox-mobile.png` | Generado |

Todos en `/tmp/sofia-extreme-live-dashboard/screenshots/`. Verificación funcional adicional: se procesó un mensaje real en sandbox y se expandió el toggle "Ver checklist completo" en `/sofia` para confirmar que `SofiaReadinessGrid` renderiza los 16 checks reales agrupados por categoría (capturas `preview-readiness-grid.png`, `preview-timeline.png` en la misma carpeta).

## 12. Pendientes

- Overlap del header compartido en mobile (`app-shell.tsx`) — preexistente, global, fuera de alcance de Sofía.
- Carácter mal codificado en "Hamburguesa 2X1�" del catálogo sandbox — preexistente, dato de seed.
- `DISCONNECTED`/`CONNECTED`/`QR_READY` como `status` de `SofiaStatusPill` (el badge en sí, no el texto) siguen siendo el código técnico interno del componente — es intencional, ya que `SofiaStatusPill` usa esos valores como key de estilo, no como texto visible (el texto visible ya está humanizado vía `label`).
- No se agregaron mini-sparklines ni gráficas de tendencia temporal (el brief las menciona como opcional "mini gráficas"); no hay suficiente densidad de datos históricos por endpoint para una serie de tiempo honesta sin inventar puntos — se priorizaron gauge + señales vivas + timeline real, que sí tienen datos reales de respaldo.

## 13. Decisión final

`/sofia` pasó de ser una sucesión de cards de texto a un centro de control con: 1 medidor circular real, 4 señales vivas con puntos pulsantes, 1 comparación de barras, 1 checklist priorizado, 1 matriz de acciones, y 1 feed de actividad con auditoría real — todo derivado de datos de backend ya existentes, sin inventar ninguna métrica. Se recuperaron y conectaron 2 componentes premium previamente huérfanos (`SofiaReadinessGrid`, `SofiaTimeline`) en vez de reinventarlos. Se encontró y corrigió una fuga real de reason codes en el feed nuevo antes de cerrar, en vez de pasarla por alto. Seguridad intacta, build/typecheck en verde, ningún módulo protegido tocado.

**SOFÍA EXTREME LIVE DASHBOARD: GO CONDICIONADO**

Condicionado porque: (a) `/sofia/conversations` no fue rearquitecturada al mismo nivel (fuera del foco principal indicado en el brief), (b) quedan 2 bugs preexistentes documentados y no corregidos por estar fuera de alcance de Sofía, y (c) no hay mini-gráficas de tendencia temporal por falta de datos históricos reales suficientes para no inventarlas.
