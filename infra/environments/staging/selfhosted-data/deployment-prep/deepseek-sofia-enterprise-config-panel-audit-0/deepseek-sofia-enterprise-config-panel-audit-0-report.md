# DEEPSEEK-SOFIA-ENTERPRISE-CONFIG-PANEL-AUDIT-0 — REPORTE COMPLETO

**Fecha:** 2026-07-01
**Auditor:** Automatizado
**Alcance:** Solo auditoría. Sin modificación de código.
**Rutas auditadas:** `/sofia`, `/sofia/sandbox`, `/sofia/conversations`
**Archivos revisados:** 6 frontend + 8 backend

---

## 1. RESUMEN EJECUTIVO

El panel `/sofia` funciona actualmente como un **hub de accesos rápidos camuflado de panel enterprise**. Aunque contiene información valiosa sobre el ecosistema Sofía (IA, WhatsApp, pagos, reglas), su propósito principal hoy es ser un punto de navegación hacia otras rutas (POS, Domicilios, Sandbox, Conversations). No cumple con el rol de "centro enterprise de configuración, gobierno, monitoreo, seguridad y producción readiness" que se necesita.

**Diagnóstico:** La arquitectura de las tres rutas está bien pensada en backend (separación de concerns, providers abstractos, SafetyGuard), pero `/sofia` no refleja esta madurez en el frontend. La información está dispersa entre la página principal y las sub-rutas, y faltan indicadores críticos de producción.

---

## 2. DIAGNÓSTICO ACTUAL DE `/sofia`

### Lo que `/sofia` ES hoy:
- Una pantalla de accesos rápidos con 4 botones principales
- Un dashboard con métricas básicas (pedidos activos, pagos pendientes)
- Un visualizador del estado de conexiones (Hermes, DeepSeek, pagos, POS, stock)
- Un panel de pruebas de IA (health check, test Maxi Family, test bloqueo)
- Un visualizador de reglas de negocio
- Un placeholder de monitoreo (sin datos reales)
- Un sandbox técnico colapsable para simular conversaciones y crear drafts

### Lo que `/sofia` DEBERÍA ser:
- Centro de configuración enterprise (WHATSAAP_MODE, provider, horarios)
- Panel de gobierno (handoff humano, pausa global, límites de tasa)
- Dashboard de monitoreo (webhook health, outbox queue depth, errores)
- Centro de seguridad (SafetyGuard stats, secretos por env, cumplimiento)
- Checklist de producción readiness (qué falta para go-live)
- Punto de entrada a operaciones (sandbox, conversaciones, POS, domicilios)

---

## 3. TABLA 1 — RUTAS

| Ruta | Archivo | Responsabilidad actual | Responsabilidad correcta | Estado |
|------|---------|----------------------|-------------------------|--------|
| `/sofia` | `apps/web/src/app/(app)/sofia/page.tsx` | Hub de accesos rápidos + sandbox colapsable + métricas + pruebas IA | Centro enterprise de configuración, gobierno, monitoreo, seguridad y producción readiness | **MAL UBICADO** — tiene funciones de sandbox y carece de indicadores enterprise |
| `/sofia/sandbox` | `apps/web/src/app/(app)/sofia/sandbox/page.tsx` | Pruebas técnicas del agente, simulación de mensajes, catálogo visual de ofertas | Pruebas técnicas, mensajes simulados, drafts/mock data | **BIEN** — alineado con su propósito |
| `/sofia/conversations` | `apps/web/src/app/(app)/sofia/conversations/page.tsx` | Control de conversaciones WhatsApp, inbox/outbox, pausa/reanudar, handoff humano | Conversaciones WhatsApp, inbound/outbound, aprobación humana, pausa/reanudar | **BIEN** — alineado con su propósito |
| `/deliveries` | `apps/web/src/app/(app)/deliveries/page.tsx` | Operación real de domicilios | Operación real de domicilios | **BIEN** |
| `/pos` | `apps/web/src/app/(app)/pos/page.tsx` | Operación POS/caja | Operación POS/caja | **BIEN** |

---

## 4. TABLA 2 — ELEMENTOS VISIBLES EN `/sofia`

| Elemento visible | Debe quedarse en /sofia | Debe moverse a sandbox | Debe moverse a conversations | Acción recomendada |
|-----------------|------------------------|----------------------|----------------------------|-------------------|
| Estado de conexiones (Hermes, DeepSeek, Pagos, POS, Stock) | ✅ SÍ | No | No | Mantener y enriquecer con más detalle: health endpoint, latencia, uptime |
| Botones "Ver en Domicilios" / "Ver en POS" | ✅ SÍ (como acceso rápido) | No | No | Reducir prominencia. Son accesos operativos, no el propósito principal |
| Botón "Abrir sandbox del agente" | ✅ SÍ (como enlace) | Ya tiene su ruta | No | Mantener como navegación secundaria |
| Botón "Conversaciones WhatsApp" | ✅ SÍ (como enlace) | No | Ya tiene su ruta | Mantener como navegación secundaria |
| Sección "Agente" (modo, horario, estado) | ✅ SÍ | No | No | Expandir con toggle global ON/OFF, schedule config |
| Sección "Pedidos" (métricas) | ✅ SÍ | No | No | Mantener y enriquecer |
| Sección "Conexiones" | ✅ SÍ | No | No | Expandir con health checks en vivo |
| Sección "Motor IA Sofía" (DeepSeek status) | ✅ SÍ | No | No | Expandir con logs de uso, costos, rate limits |
| Botones "Probar Maxi Family" / "Probar bloqueo" / "Probar fallback" | No | ✅ SÍ | No | **MOVER** — son pruebas técnicas, pertenecen al sandbox |
| Sección "Reglas" (6 reglas de validación) | ✅ SÍ | No | No | Mantener y hacer editables en futuro |
| Sección "Datos" (catálogos) | ✅ SÍ | No | No | Completar con datos reales (combos, imágenes) |
| Sección "Métodos de pago" | ✅ SÍ | No | No | Activar configuración cuando provider esté listo |
| Sección "Monitoreo" (placeholder) | ✅ SÍ | No | No | Poblar con datos reales: outbox queue, errores, latencia |
| Sandbox técnico colapsable (simular entrada + crear borrador) | No | ✅ SÍ | No | **MOVER** — es funcionalidad de sandbox, no de panel enterprise |
| "Personalidad y ventas" | ✅ SÍ | No | No | Mantener como guía de conversación |
| "Límites activos de Fase 1" | ✅ SÍ | No | No | Reemplazar por checklist de producción readiness |
| Catálogo visual de 4 ofertas | No | Ya está en sandbox | No | Ya está correctamente en sandbox |

---

## 5. TABLA 3 — PRODUCCIÓN READINESS

| Elemento | Visible actualmente | Necesario para producción | Riesgo | Acción |
|----------|-------------------|--------------------------|--------|--------|
| Estado global de Sofía | ⚠️ Parcial: badges "Sandbox", "No conectado", "POS/Domicilios" | Dashboard de estado global con semáforo verde/amarillo/rojo | P1 — Sin estado claro, no se sabe si Sofía está operativa | Agregar indicador global con health de todos los subsistemas |
| WHATSAPP_MODE | ✅ Visible en `/sofia/conversations` | Debe estar en `/sofia` principal | P1 — El modo WhatsApp es configuración crítica de producción | Mostrar en `/sofia` con toggle de cambio (disabled/mock/supervised/auto) |
| Provider Hermes/WhatsApp | ✅ Visible en `/sofia/conversations` | Debe estar en `/sofia` principal | P1 — Sin visibilidad del provider activo | Mostrar en `/sofia` con indicador de health |
| Estado de webhook | ❌ No visible | Crítico: si el webhook falla, Sofía no recibe mensajes | P0 — Bloquea producción | Agregar health check de webhook con timestamp del último evento recibido |
| Estado DeepSeek/IA | ✅ Visible: provider, modo, seguridad | Bien representado | P2 — Faltan métricas de uso/costo | Agregar contador de tokens, costos, rate limits |
| SafetyGuard | ✅ Visible: safety blocks, handoffs, reglas | Bien representado en backend | P1 — Backend sólido, frontend no muestra todas las protecciones activas | Mostrar: forbidden claims bloqueados, productos bloqueados, pagos bloqueados |
| Handoff humano | ⚠️ Parcial: contador de handoffs, regla de escalamiento | Necesita panel de handoffs pendientes | P1 — Sin visibilidad de handoffs activos | Agregar cola de handoffs pendientes con tiempo de espera |
| Outbox/reintentos | ✅ Visible en `/sofia/conversations` | Necesita contador global en `/sofia` | P1 — Sin visibilidad de mensajes atascados | Agregar badge en `/sofia` con conteo de outbox pendientes |
| Deduplicación inbound/outbound | ❌ No visible | Crítico para no duplicar pedidos | P0 — Bloquea producción | Mostrar configuración de TTL y contador de duplicados detectados |
| Pagos: efectivo, Nequi manual, online | ✅ Visible: lista de métodos | Correcto como referencia | P2 — Falta indicador de provider activo por método | Mostrar qué provider está activo para cada método |
| Regla: WhatsApp no marca PAID | ✅ Visible en reglas: "No marcar pagos sin validacion" | Backend protegido por SafetyGuard | INFO — Bien cubierto | Verificar que el texto sea explícito: "WhatsApp no puede marcar pagos como PAID" |
| Regla Maxi Family | ✅ Visible: botón "Probar Maxi Family", resultado muestra "Maxi Family protegido" | Backend protegido por SafetyGuard con forbidden claims | INFO — Bien cubierto | Mantener prueba, mover a sandbox |
| Catálogo visual de 4 ofertas | ✅ Visible en `/sofia/sandbox` | Correcto en sandbox | P3 — Imágenes usan rutas estáticas, no CDN | Verificar que las imágenes existan en `/public/uploads/sofia-offers/` |
| Multimedia | ✅ Visible en sandbox: mediaSuggestion | Correcto en sandbox | P2 — Sin indicador de si todas las imágenes de ofertas están cargadas | Agregar validación de assets en `/sofia` |
| Checklist producción | ❌ No visible | Necesario para go/no-go | P0 — Sin checklist no hay criterio claro de producción readiness | Agregar checklist con: webhook, IA, provider WhatsApp, pagos, seguridad, monitoreo |
| Seguridad/secrets por env | ✅ Visible: "API key no visible", "Backend only", "Hermes separado" | Bien cubierto | P1 — Falta indicador de rotación de secrets | Agregar timestamp de última rotación de API keys |
| Accesos operativos | ✅ Visible: links a deliveries, POS, sandbox, conversations | Bien como navegación secundaria | P2 — Mucha prominencia | Reducir a barra lateral o menú secundario |

---

## 6. TABLA 4 — HALLAZGOS

| # | Hallazgo | Severidad | Impacto | Recomendación |
|---|----------|-----------|---------|---------------|
| H1 | `/sofia` funciona como hub de accesos rápidos, no como panel enterprise de configuración y gobierno | P0 | Sin centro de gobierno, no hay criterio claro de producción readiness ni control centralizado de Sofía | Rediseñar `/sofia` como dashboard enterprise con: estado global, configuración, seguridad, monitoreo, checklist. Mover sandbox y pruebas a `/sofia/sandbox` |
| H2 | El sandbox técnico colapsable (simular conversación + crear borrador) está dentro de `/sofia` | P1 | Mezcla responsabilidades: el panel enterprise no debería tener herramientas de simulación | Mover toda la sección "Sandbox técnico (desarrollo)" a `/sofia/sandbox` |
| H3 | Los botones "Probar Maxi Family", "Probar bloqueo" y "Probar fallback" están en `/sofia` | P1 | Son pruebas técnicas de IA, no configuraciones enterprise | Mover a `/sofia/sandbox` o a una sección de diagnóstico en el panel enterprise |
| H4 | No hay indicador de health de webhook en ninguna ruta | P0 | Si el webhook de WhatsApp falla, Sofía deja de recibir mensajes sin alerta | Agregar endpoint `GET /admin/sofia/whatsapp/webhook-health` y mostrarlo en `/sofia` |
| H5 | No hay contador de outbox queue pendiente en `/sofia` | P1 | Los mensajes salientes atascados no son visibles sin entrar a conversations | Agregar badge con conteo de outbox pendientes en el dashboard principal |
| H6 | No hay indicador de deduplicación activa | P0 | Sin visibilidad de deduplicación, riesgo de pedidos duplicados en producción | Mostrar configuración de TTL de dedup y contador de mensajes deduplicados hoy |
| H7 | No hay checklist de producción readiness | P0 | Sin checklist, no se puede determinar si Sofía está lista para producción | Agregar checklist interactivo con: webhook OK, IA configurada, provider WhatsApp activo, pagos configurados, seguridad OK, monitoreo OK |
| H8 | Las ofertas destacadas (Maxi Family + 3) están duplicadas entre backend (`sofia-featured-offers.ts`) y frontend (`sandbox/page.tsx` fallback) | P2 | Riesgo de inconsistencia si se modifican en un solo lado | El frontend debe consumir las ofertas desde un endpoint del backend, no tener fallback hardcodeado |
| H9 | La sección "Monitoreo" en `/sofia` es un placeholder sin datos reales | P2 | Da falsa sensación de monitoreo | Poblar con datos reales del backend: logs de errores, outbox queue depth, webhook latency |
| H10 | El endpoint `POST /admin/sofia/ai/test` tiene valores hardcodeados de `sandboxNow` | P3 | La fecha de prueba está fija en `2026-07-01T23:00:00.000Z`, no usa el valor enviado por el frontend | Usar el valor `dto.sandboxNow` si se envía, o calcular la fecha actual |
| H11 | Faltan indicadores de costos de IA (DeepSeek) | P2 | Sin visibilidad de costos, no se puede controlar el gasto operativo | Agregar contador de tokens consumidos hoy y costo estimado |
| H12 | No hay toggle global de Sofía ON/OFF | P1 | No se puede deshabilitar Sofía globalmente en caso de emergencia | Agregar endpoint `PATCH /admin/sofia/global-toggle` y mostrarlo en `/sofia` |
| H13 | La información de "Personalidad y ventas" es estática | P3 | No se puede ajustar el tono sin cambiar código | Futuro: hacer estos parámetros editables desde el panel |
| H14 | Seguridad: SafetyGuard backend es sólido, pero el frontend no muestra todas las protecciones activas | P1 | El operador no sabe qué protecciones están activas sin revisar código | Mostrar checklist de protecciones activas: forbidden claims, payment blocking, product validation, confidence threshold |
| H15 | No hay visibilidad de la cola de handoffs humanos pendientes | P1 | Si un cliente requiere humano y no se atiende, se pierde la venta | Agregar badge con handoffs pendientes y tiempo promedio de respuesta |

---

## 7. TABLA 5 — SEPARACIÓN CORRECTA

| Función | Ruta correcta | Ruta actual | Está bien/mal | Acción |
|---------|--------------|-------------|---------------|--------|
| Configuración de WhatsApp (modo, provider, auto-reply) | `/sofia` | `/sofia` (parcial) + `/sofia/conversations` | **MAL** — dispersa | Consolidar configuración en `/sofia`. Conversations solo muestra estado, no configura |
| Estado global de salud | `/sofia` | No existe | **FALTA** | Crear dashboard de health con semáforo |
| Gobierno (handoff, pausa global, límites) | `/sofia` | `/sofia/conversations` (parcial) | **MAL** — el gobierno global debe estar en `/sofia` | Mover controles globales a `/sofia`; conversations mantiene controles por conversación |
| Monitoreo técnico (webhook, outbox, errores) | `/sofia` | Placeholder vacío | **FALTA** | Poblar con datos reales |
| Seguridad y cumplimiento | `/sofia` | `/sofia` (parcial: solo IA) | **INCOMPLETO** | Agregar: rotación de secrets, auditoría de accesos, logs de SafetyGuard |
| Checklist producción | `/sofia` | No existe | **FALTA** | Crear checklist interactivo |
| Pruebas de agente (simular mensajes) | `/sofia/sandbox` | `/sofia` (sandbox colapsable) + `/sofia/sandbox` | **MAL** — duplicado | Consolidar todo en `/sofia/sandbox` |
| Pruebas de IA (health check, test de escenarios) | `/sofia/sandbox` | `/sofia` | **MAL** — son pruebas, no configuración | Mover a `/sofia/sandbox` o a sección de diagnóstico |
| Catálogo visual de ofertas | `/sofia/sandbox` | `/sofia/sandbox` (bien) | **BIEN** | Mantener |
| Conversaciones WhatsApp (inbound/outbound) | `/sofia/conversations` | `/sofia/conversations` | **BIEN** | Mantener |
| Handoff por conversación | `/sofia/conversations` | `/sofia/conversations` | **BIEN** | Mantener |
| Outbox por conversación | `/sofia/conversations` | `/sofia/conversations` | **BIEN** | Mantener |
| Creación de drafts/pedidos | `/sofia/sandbox` o `/deliveries` | `/sofia` (sandbox colapsable) | **MAL** — es prueba, no operación | Mover a sandbox |
| Operación real de pedidos | `/deliveries` + `/pos` | `/deliveries` + `/pos` | **BIEN** | Mantener |
| Pagos (configuración) | `/sofia` | `/sofia` (solo lectura) | **INCOMPLETO** | Agregar capacidad de configuración de providers |
| Pagos (operación real) | `/pagos` o flujo en POS/Domicilios | `/pagos` | **BIEN** | Mantener |

---

## 8. QUÉ ESTÁ BIEN

1. **Backend sólido y bien abstraído**: Providers para WhatsApp (Mock/Hermes/Null), IA (Rules/DeepSeek/Null), Pagos (Mock/Bold/Null) con factory pattern.
2. **SafetyGuard robusto**: Protege contra forbidden Maxi claims, bloquea que la IA marque pagos, valida productos contra catálogo real, bloquea acciones críticas desde IA.
3. **Separación backend clara**: `SofiaController` para admin, `SofiaWhatsappWebhookController` para webhooks, `SofiaPublicPaymentsController` para pagos públicos.
4. **`/sofia/sandbox` bien diseñado**: Claramente marcado como "sin Hermes, sin IA real, sin pagos reales". Catálogo visual de ofertas correcto. Simulación de mensajes completa con respuesta estructurada.
5. **`/sofia/conversations` bien diseñado**: Control de conversaciones con pausa/reanudar/take-over/release. Outbox con approve-send/retry/cancel. Claramente separado de la operación de pedidos.
6. **Regla Maxi Family protegida**: Tanto en backend (SafetyGuard con forbidden claims) como en frontend (prueba que verifica "porción personal de papitas").
7. **Regla "WhatsApp no marca PAID"**: Backend protegido en SafetyGuard. Frontend lo menciona en reglas.
8. **Seguridad de secrets**: El frontend muestra "API key no visible", "Backend only", confirmando que los secrets no se exponen al cliente.

---

## 9. QUÉ ESTÁ MAL UBICADO

1. **Sandbox técnico colapsable en `/sofia`**: La sección "Sandbox técnico (desarrollo)" con simulación de conversaciones y creación de borradores debe estar en `/sofia/sandbox`.
2. **Pruebas de IA en `/sofia`**: Los botones "Probar Maxi Family", "Probar bloqueo", "Probar fallback" son herramientas de diagnóstico, no de configuración enterprise.
3. **Configuración de WhatsApp dispersa**: WHATSAPP_MODE y provider se ven en `/sofia/conversations` pero deberían tener su sección de configuración en `/sofia`.
4. **Gobierno global mezclado con gobierno por conversación**: Pausa global, toggle ON/OFF, límites de tasa deben estar en `/sofia`, no dispersos.

---

## 10. QUÉ FALTA PARA PRODUCCIÓN REAL

1. **Checklist de producción readiness** (P0): Webhook health, IA configurada, provider WhatsApp activo, pagos configurados, seguridad verificada, monitoreo activo.
2. **Indicador de health de webhook** (P0): Último evento recibido, latencia, errores.
3. **Indicador de deduplicación activa** (P0): TTL configurado, mensajes deduplicados hoy.
4. **Toggle global de Sofía ON/OFF** (P1): Para emergencias.
5. **Monitor de outbox queue** (P1): Conteo de mensajes pendientes, reintentos, fallos.
6. **Monitor de handoffs pendientes** (P1): Cola de conversaciones que requieren humano.
7. **Indicadores de costos IA** (P2): Tokens consumidos, costo estimado diario.
8. **Rotación de secrets** (P1): Indicador de última rotación de API keys.
9. **Logs de SafetyGuard** (P1): Eventos bloqueados hoy, tipo de bloqueo, tendencia.
10. **Validación de assets multimedia** (P2): Verificar que las 4 imágenes de ofertas existen y cargan.

---

## 11. PLAN RECOMENDADO PARA REDISEÑO POSTERIOR

### Fase 1 — Reorganización (sin nueva funcionalidad)
1. Mover sandbox técnico colapsable de `/sofia` a `/sofia/sandbox`
2. Mover pruebas de IA a `/sofia/sandbox`
3. Reducir prominencia de botones de navegación en `/sofia`
4. Consolidar configuración de WhatsApp en `/sofia`

### Fase 2 — Panel enterprise mínimo
5. Crear dashboard de estado global con semáforo (verde/amarillo/rojo)
6. Agregar health de webhook
7. Agregar contador de outbox pendientes
8. Agregar contador de handoffs pendientes
9. Agregar checklist de producción readiness

### Fase 3 — Gobierno y seguridad
10. Agregar toggle global ON/OFF
11. Agregar indicadores de SafetyGuard
12. Agregar indicadores de costos IA
13. Agregar rotación de secrets
14. Hacer configuración de WHATSAPP_MODE editable desde UI

### Fase 4 — Madurez
15. Hacer reglas de negocio editables
16. Hacer personalidad/tono editables
17. Dashboard de tendencias y analytics
18. Integración con sistema de alertas (email/Slack)

---

## 12. RIESGOS POR SEVERIDAD

### P0 — Bloquea producción
- Sin health de webhook visible → si WhatsApp falla, no hay alerta
- Sin visibilidad de deduplicación → riesgo de pedidos duplicados
- Sin checklist de producción readiness → no hay criterio de go/no-go
- `/sofia` no es un panel enterprise real → sin centro de gobierno

### P1 — Riesgo operativo
- Sandbox técnico dentro de `/sofia` → confunde responsabilidades
- Sin toggle global ON/OFF → no se puede deshabilitar en emergencia
- Sin monitor de outbox queue → mensajes atascados sin visibilidad
- Sin monitor de handoffs → clientes esperando sin atención
- Sin visibilidad completa de SafetyGuard → operador no sabe qué protege el sistema
- Sin indicador de rotación de secrets → riesgo de seguridad

### P2 — Mala UX importante
- Ofertas duplicadas backend/frontend → riesgo de inconsistencia
- Sección monitoreo placeholder → falsa sensación de control
- Sin indicadores de costos IA → gasto invisible
- Sin validación de assets multimedia → imágenes rotas en producción

### P3 — Pulido visual
- Fecha hardcodeada en endpoint de prueba
- Parámetros de personalidad estáticos
- Botones de navegación muy prominentes

---

## 13. DECISIÓN FINAL

**DEEPSEEK-SOFIA-ENTERPRISE-CONFIG-PANEL-AUDIT-0: GO CONDICIONADO**

**Condiciones que impiden GO pleno:**
- El diagnóstico textual está completo y detallado (no se requieren screenshots)
- Se identificaron todas las separaciones de responsabilidades
- Se entregaron acciones concretas para cada hallazgo
- Se definió un plan de rediseño en 4 fases

**Lo que impide GO pleno (no bloquea GO condicionado):**
- 4 hallazgos P0 que deben resolverse antes de producción
- La ruta `/sofia` requiere rediseño para ser un verdadero panel enterprise
- Faltan endpoints de health y monitoreo en backend para poblar el dashboard

**Próximo paso recomendado:** Ejecutar `DEEPSEEK-SOFIA-ENTERPRISE-CONFIG-PANEL-REDESIGN-1` para implementar la Fase 1 (reorganización sin nueva funcionalidad).
