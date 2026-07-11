# Delivery Phase A — Reporte final y congelamiento

Fecha: 2026-07-10. Repo: `/home/wundah/inventario`, branch `master` (HEAD `54116f4`). Ejecutor: Claude Code (Fable 5). **Sin commits** — pendiente de revisión del owner.

## 1. Resumen ejecutivo

Se cerró la Fase A del sistema de Domicilios sobre la base del workstream previo sin commitear (`delivery-location-logistics-updated-receipt`): se agregó versionado comercial visible (VERSIÓN N + VIGENTE), cuenta vigente única con historial reconstruible, idempotencia también para el envío inicial, PDF térmico rediseñado en negro puro con el logo original, sanitización WinAnsi (cubre el carácter corrupto conocido), eventos de auditoría estándar completos con teléfono siempre enmascarado, endpoints de consulta (PDF vigente/estado/historial), y el panel "Cuenta de domicilio" en `/deliveries`. Se corrigió un **bug real de doble cobro visual** en `/deliveries` (mostraba `subtotal + deliveryFee` cuando `subtotal` ya incluye el fee). 9/9 tests nuevos de Fase A PASS, 18/18 tests delivery del spec crítico PASS, builds/typechecks PASS, 5 PDFs de muestra inspeccionados visualmente. Un fallo externo de Sofía documentado (no corregido, fuera de alcance). Fase declarada CONGELADA.

## 2. Auditoría inicial

`/tmp/delivery-phase-a-final/auditoria-final.md`. Hallazgos clave: PDF con colores y sin logo/versión; `revision` técnica ≠ versión comercial (la ubicación también la incrementa); envío inicial sin idempotencia ni eventos estándar; **teléfono completo** en 2 audits (ubicación y SEND inicial); doble cobro visual del fee en `/deliveries`; carácter corrupto = emoji `U+1F488` en name+code de un producto en la DB viva (seed limpio; catálogo intocable → sanitización en render); sin endpoint para ver la cuenta vigente.

## 3. Arquitectura final

- **Renderer puro** `delivery-receipt.renderer.ts`: datos planos → PDF Buffer, sin DB. `generateDeliveryReceiptPdf()` (service) arma los datos (settings, versión, QR) y delega. Habilita muestras y tests unitarios sin órdenes reales.
- **Versión comercial derivada de auditoría** (`1 + count(REFRESHED)`) — sin migración, como exige el brief; `revision` queda como control técnico de concurrencia.
- **Cuenta vigente por generación determinística**: el PDF siempre se renderiza desde el estado actual de la orden ⇒ es imposible servir una versión vieja; ACTIVE/REPLACED se representa en auditoría e historial (sin persistir PDFs como entidades — decisión explícita permitida por el brief).

## 4. Flujo de creación

POS crea orden DELIVERY (fee calculado y persistido; `subtotal` = productos + fee) → POS dispara `POST /whatsapp/orders/:id/send-delivery-summary` → audit `INITIAL_SEND_REQUESTED` → idempotencia (`ALREADY_SENT` si aplica) → genera PDF v1 (`INITIAL_GENERATED`) → envía → `INITIAL_SENT` (o `INITIAL_SEND_FAILED` sanitizado). El fallo de canal no revierte la orden.

## 5. Flujo de actualización

`replaceItems` → sin cambio real: no-op total (sin versión, sin PDF, sin envío) → con cambio: conserva fee, recalcula subtotal, `revision++` → audita `REFRESHED` (define versión N) → audita `REPLACED` (N-1→REPLACED, N→ACTIVE) → genera PDF actualizado → autoenvía 1× por revisión (`UPDATED_RECEIPT_*`), caption "Pedido actualizado — versión N. Esta es tu nueva cuenta vigente.", archivo `-actualizada-vN.pdf`.

## 6. Flujo de ubicación

`applyDeliveryLocationForLogisticsOnly()`: solo lat/lng/source/receivedAt/deliveryCustomerId/statusUpdatedAt + `revision` técnica + audit (ahora con `phoneMasked`) + realtime. No toca pricing, no genera cuenta, no envía, no incrementa versión comercial — verificado por test nuevo y por los tests previos del spec crítico.

## 7. Versionado — Tabla Versión | Evento | Estado | Envío

| Versión | Evento | Estado | Envío |
|---|---|---|---|
| 1 | Creación de orden | ACTIVE hasta primer cambio | `INITIAL_SENT` idempotente (`{orderId}`) |
| 2 | Primer cambio comercial (`REFRESHED`) | v1→REPLACED, v2→ACTIVE (`REPLACED` audit) | `UPDATED_RECEIPT_SENT` 1× (`{orderId}:{revision}`) |
| N | Cambio N-1 | vN-1→REPLACED, vN→ACTIVE | idem, clave por revisión |
| — | Ubicación WhatsApp | Sin versión nueva (`revision` técnica solamente) | No envía |

## 8. Historial

`GET /orders/:id/delivery-receipt-history`: reconstruye v1 (Creación inicial) + una entrada por `REFRESHED` con resumen del diff de items ("+2 Papas medianas, -1 Gaseosa") derivado de los dtos auditados (CREATE/UPDATE_ITEMS) con nombres de producto resueltos, `previousTotal`/`newTotal` y estado ACTIVE/REPLACED. Sin duplicar datos: todo sale de la auditoría existente.

## 9. Cuenta vigente

Única por diseño (generación determinística). `/deliveries` consume `GET delivery-receipt-status` (versión, VIGENTE, total, estado de envío, última actualización) y abre el PDF vigente con `GET delivery-receipt` (roles: admin/cashier/supervisor/delivery). Nunca puede mostrarse una versión reemplazada como vigente.

## 10. Diseño del PDF — Tabla PDF | Criterio | Resultado | Evidencia

| Criterio | Resultado | Evidencia |
|---|---|---|
| Logo original centrado y nítido | PASS | `pdf-samples/01..05` |
| Impresión negra pura (sin fondos de color/grises) | PASS | Renderer usa solo #000; inspección visual |
| VERSIÓN N visible | PASS | Muestras 01 (V1), 02 (V3), 04 (V2) |
| Estado VIGENTE visible | PASS | Todas las muestras |
| Título CUENTA / CUENTA ACTUALIZADA DE DOMICILIO | PASS | 01 vs 02/04 |
| Nota de reemplazo en actualizadas | PASS | 02 y 04 (en negrita) |
| Textos obligatorios de tarifa/ubicación | PASS | Todas |
| Subtotal productos + Tarifa + TOTAL A PAGAR destacado | PASS | Doble regla + 10.2pt bold, alineado |
| Pedido largo (14 ítems) sin cortes, página continua única | PASS | Muestra 03 + test unitario |
| Dirección/nombres largos con acentos (Ñáñez, ría) | PASS | Muestra 05 |
| Caracteres corruptos/emoji sanitizados (caso 2X1 U+1F488) | PASS | Muestra 04 + test unitario |
| 58 mm térmico (auditado, no asumido) | PASS | `58 * 2.83465` pt conservado |
| Sin textos prohibidos ("por confirmar", "sujeto a ubicación", reason codes) | PASS | grep sobre renderer |

## 11. Logo utilizado

Original: `apps/web/public/brand/sidebar-logo.png` (única versión oficial en el repo, 1254×1254, texto claro sobre negro). Para térmica se generó la variante de impresión `apps/api/src/assets/brand-logo.png` (360×360, invertido a negro-sobre-blanco, umbralizado a monocromo puro, 1.4 KB) — mismo logo, sin invención. Copiado a `dist/assets/` vía `nest-cli.json` (verificado en build).

## 12. Idempotencia

Inicial `DELIVERY_RECEIPT_INITIAL_SENT:{orderId}` (nuevo) + actualizada `DELIVERY_RECEIPT_UPDATED_SENT:{orderId}:{revision}` (preexistente, conservada). Claves distintas por tipo ✔; reintento no duplica ✔ (test con socket mockeado: 2ª llamada → `alreadySent:true`, socket 1 sola vez); sin cambio real no hay revisión nueva ✔; con revisión nueva la vieja no puede reenviarse (la clave incluye revisión y el flujo solo envía la vigente) ✔; sin reintentos infinitos (sin colas nuevas) ✔.

## 13. Fallos/reintentos

Canal caído: `WHATSAPP_SERVICE_UNAVAILABLE` / error sanitizado → orden, versión y PDF persisten; estado FAILED disponible para reintento controlado o intervención manual. Sin teléfono: `CUSTOMER_PHONE_MISSING` → UI "Sin teléfono" (`SKIPPED_NO_PHONE`), sin romper la actualización, sin éxito falso.

## 14. Auditoría

Eventos completos (tabla en `docs/delivery-phase-a-frozen.md`). Correcciones de privacidad: audit de ubicación y audit `SEND` inicial ahora llevan `phoneMasked` (antes teléfono completo — violación detectada en auditoría y corregida). `failureReason` pasa por redacción de teléfonos. Pendiente documentado fuera de alcance: audit de `sale_receipt` (POS ventas) aún registra teléfono completo — POS es módulo protegido, no se tocó.

## 15. Cambios frontend / 16. Cambios backend — Tabla Archivo | Cambio | Motivo

| Archivo | Cambio | Motivo |
|---|---|---|
| `apps/api/src/modules/orders/delivery-receipt.renderer.ts` | **Nuevo**: renderer puro térmico negro + sanitización WinAnsi + logo | F5; muestras/tests sin DB |
| `apps/api/src/assets/brand-logo.png` | **Nuevo**: variante de impresión del logo original | F5 |
| `apps/api/nest-cli.json` | Copia de assets a dist | Logo disponible en build/contenedor |
| `apps/api/src/modules/orders/orders.service.ts` | `generateDeliveryReceiptPdf` → renderer + versión + `INITIAL_GENERATED`; `getDeliveryCommercialVersion/ReceiptStatus/ReceiptHistory`; `generateCurrentDeliveryReceiptPdf`; reorden REFRESHED→REPLACED→PDF→envío; `phoneMasked` en audit de ubicación; helpers PDF muertos eliminados | F2-F4, F7, F12 |
| `apps/api/src/modules/orders/orders.controller.ts` | GET `delivery-receipt` (PDF), `-status`, `-history` | F3, F11 |
| `apps/api/src/modules/whatsapp/whatsapp.service.ts` | Idempotencia inicial + eventos `INITIAL_*` + `phoneMasked` siempre + versión en caption/filename + `sanitizeSendFailureReason` | F6, F8, F12 |
| `apps/api/src/tests/delivery-receipt-phase-a.spec.ts` | **Nuevo**: 9 tests (4 renderer puro + 5 integración) | F13 |
| `apps/api/scripts/render-delivery-receipt-samples.ts` | **Nuevo**: generador de muestras sin DB | F15 |
| `apps/web/src/app/(app)/deliveries/page.tsx` | Fix doble cobro visual (2 lugares); panel Cuenta de domicilio (versión/VIGENTE/envío/Ver cuenta) | F11 |
| `docs/delivery-phase-a-frozen.md` | **Nuevo**: congelamiento | F17 |
| `CLAUDE.md`, `AGENTS.md` | Referencia breve al congelamiento | F17 |
| `.gitignore` | `apps/api/infra/` (corrige colateral: artefactos de backups de Sofía por CWD — 1 línea, no toca Sofía) | Higiene del árbol |

## 17. Pruebas — Tabla Test | Resultado | Evidencia

| Test | Resultado | Evidencia |
|---|---|---|
| T1 cuenta inicial v1 + status ACTIVE + total persistido | PASS | `phase-a-tests.log` |
| T2-T4 cambio comercial → v2, fee conservado, REPLACED, 1 envío | PASS (nuevo + spec crítico 'refreshes delivery account…') | ambos logs |
| T5 sin cambio real → sin versión/PDF/envío | PASS (spec crítico 'does not send a duplicate…') | `critical-delivery-subset.log` |
| T6 idempotencia inicial (2ª llamada skip, socket 1×) | PASS | `phase-a-tests.log` |
| T7 canal fallido conserva orden/versión, FAILED auditado | PASS (spec crítico 'keeps commercial delivery update when… send fails') | `critical-delivery-subset.log` |
| T8 sin teléfono no rompe, `CUSTOMER_PHONE_MISSING` | PASS (spec crítico '…customer phone is missing') | idem |
| T9 ubicación: coordenadas sí, fee/subtotal/versión no, sin PDF/envío | PASS (nuevo + spec crítico 3332) | ambos |
| T10 PDF largo una página, sin cortes, sanitizado | PASS | `phase-a-tests.log` + muestra 03 |
| T11 Domicilios consume última versión (status endpoint v2 tras cambio) | PASS | `phase-a-tests.log` |
| T12 auditoría: phoneMasked, sin teléfono completo en payload | PASS | `phase-a-tests.log` |
| Subset delivery del spec crítico (18 tests de flujo) | **18/18 PASS** | `critical-delivery-subset.log` |
| Nota jest | "Jest did not exit" warning al final (handle abierto preexistente del harness Nest); el proceso terminó y reportó — no se usó `forceExit` | logs |

## 18. Builds — Tabla Gate | Resultado | Motivo

| Gate | Resultado | Motivo |
|---|---|---|
| api typecheck / build | PASS / PASS | `api-typecheck.log`, `api-build.log` (assets en dist verificados) |
| web typecheck / build | PASS / PASS | `web-typecheck.log`, `web-build.log` |
| eslint deliveries | PASS (0 errores) | ejecución en sesión |

## 19. PDFs de muestra

`/tmp/delivery-phase-a-final/pdf-samples/`: `01-inicial-corta`, `02-actualizada` (V3), `03-pedido-largo` (14 ítems), `04-con-adiciones` (emoji sanitizado), `05-direccion-larga` — PDF + PNG inspeccionados uno a uno. Iteración real registrada: el primer render partía "TOTAL A PAGAR" en dos líneas; se corrigió (lineBreak:false + columnas 56/44) y se regeneró antes de dar por buena la muestra.

## 20. Fallos globales externos (no corregidos, fuera de alcance)

1. **Sofía sandbox**: el test 'processes Sofia conversational sandbox messages…' falla — la respuesta de Maxy Family devuelve el fallback anti-invención en vez de la composición. Matcheó el patrón "delivery" por su nombre; es dominio Sofía, el brief prohíbe corregirlo en esta fase. Afecta GLOBAL GATE, no el flujo Delivery.
2. Suite completa `app.critical.spec.ts` sin patrón: no ejecutada íntegra en esta sesión (el runner oficial `test-api.sh` usa `prisma migrate reset`, bloqueado para agentes por el candado de Prisma; se corrió jest directo contra la DB `_test` existente con el reset por-test propio del spec, que es seguro y no destructivo del esquema).
3. Deriva de testids en specs e2e de Sofía (documentada en el reporte de Sofía).

## 21. Riesgos

- El fallo del sandbox Sofía puede indicar catálogo/prompt de seed desalineado en `_test` — revisar en la próxima fase de Sofía.
- Audit de `sale_receipt` (POS) con teléfono completo — pendiente para una fase de POS.
- El producto con emoji en `products.code` (`HAMB-2X1💈`) sigue en la DB viva; el PDF ya es inmune, pero el owner puede querer limpiar ese dato desde la UI de catálogo.
- Working tree compartido: al commitear, separar Fase A Delivery de los cambios de Sofía de esta misma sesión (paths distintos, sin solapamiento salvo `.gitignore`).

## 22. Decisiones finales

**DELIVERY PHASE A GATE: GO** — todos los criterios del brief cumplidos: PDF premium negro con logo original y versión/VIGENTE, cuenta vigente única, historial, autoenvío 1×/revisión con idempotencia inicial y actualizada, canal fallido/sin teléfono no rompen, ubicación logistics-only intacta y testeada, Domicilios muestra última versión (y se corrigió el total inflado), 9/9 + 18/18 tests PASS, builds PASS, muestras inspeccionadas, congelamiento documentado, ningún módulo fuera de alcance tocado.

**GLOBAL REPOSITORY GATE: GO CONDICIONADO** — condicionado por el fallo externo del sandbox de Sofía y la suite crítica completa no ejecutada por el candado de Prisma (instrucción para el owner: `pnpm --filter @inventory-fastfood/api test`).

## 23. Declaración de congelamiento

**DELIVERY PHASE A: FROZEN** — reglas, campos protegidos, eventos, versionado e idempotencia declarados en `docs/delivery-phase-a-frozen.md`; referencia agregada en `CLAUDE.md` y `AGENTS.md`. Cualquier cambio al flujo requiere una nueva fase aprobada por el owner.
