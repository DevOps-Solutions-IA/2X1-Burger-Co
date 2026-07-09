# CODEX-SOFIA-CONFIG-PANEL-CLEANUP-0

## 1. Resumen ejecutivo

Se limpió y reorganizó el panel `/sofia` para que funcione como centro de configuración, conexiones, reglas, monitoreo técnico y aprendizaje supervisado. La operación de pedidos Sofía queda explícitamente fuera del panel y permanece en Domicilios/POS, donde los pedidos se identifican con chip/acento Sofía y estado de pago visible.

Decisión final: **GO**.

## 2. Estado recibido

- `CODEX-SOFIA-PAYMENTS-WHATSAPP-MASTER-PHASED-PLAN-0: GO`.
- `CODEX-SOFIA-WHATSAPP-ORDER-CORE-PHASE-1: GO`.
- `CODEX-SOFIA-ORDER-FLOW-ARCHITECTURE-CORRECTION-0: GO`.
- Arquitectura aceptada: Sofía crea pedidos, pero Domicilios/POS los operan.

## 3. Qué se eliminó del panel Sofía

No se eliminó el sandbox técnico porque sigue siendo necesario para QA y E2E controlado, pero dejó de ser la experiencia principal. Se removió del copy principal la idea de operar pedidos desde Sofía y se reemplazó por lenguaje de configuración/monitoreo.

## 4. Qué se conservó

- Endpoints internos mock/admin de Sofía.
- Sandbox técnico controlado para crear conversación/draft/pedido mock.
- `data-testid` existentes usados por E2E.
- Enlace a Domicilios y POS.
- Resumen técnico no operativo de pedidos creados por Sofía.

## 5. Qué se movió a POS/Domicilios

La operación del pedido no se movió en código porque ya estaba corregida en la fase anterior. Esta fase reforzó visualmente que la operación vive en Domicilios/POS y no en `/sofia`.

## 6. Nueva estructura del panel

- Header: Sofía, asistente virtual de ventas por WhatsApp, sandbox/no conectado/operación en POS.
- Estado general: agente, horario, operación separada.
- Accesos operativos: ver pedidos Sofía en Domicilios/POS.
- Conexiones: Hermes/WhatsApp, DeepSeek, pagos, POS/Domicilios, stock/productos, `/pagos`.
- Reglas operativas: no inventar precios, no vender agotados, no confirmar sin datos, no marcar pagado sin validación.
- Datos disponibles: productos activos, combos, bebidas, imágenes, zonas/domicilios.
- Métodos de pago: efectivo, Nequi manual, pago online futuro, link `/pagos`.
- Monitoreo/aprendizaje: eventos mock, feedback pendiente, aprendizaje supervisado.
- Personalidad/ventas: tono, saludo, upsell, escalamiento humano.
- Sandbox técnico controlado: QA interno.

## 7. Estado de conexiones

| Conexión | Estado | Nota |
|---|---:|---|
| Hermes / WhatsApp | No configurado | Sin tráfico real |
| DeepSeek | No configurado | Sin IA real |
| Pagos | No configurado | Sin Bold/Nequi API/webhooks |
| POS / Domicilios | Conectado | Pedidos Sofía visibles en flujo normal |
| Stock / Productos | Conectado | Lectura de productos vendibles |
| `/pagos` | Fase futura | No implementado en esta fase |

## 8. Reglas operativas

Sofía queda limitada a consumir datos y crear origen de pedido. No cobra, no confirma pagos reales, no cambia estados operativos y no reemplaza los módulos de Domicilios/POS.

## 9. Datos que consume Sofía

El panel muestra resumen de productos activos desde `/products/sellable` y deja señaladas fuentes futuras para combos, imágenes y pagos sin inventar datos.

## 10. Métodos de pago configurables

Se muestran como preparación futura:

- Efectivo contra entrega.
- Nequi manual.
- Pago online provider-ready.
- Link `/pagos`.

No se conectaron pagos reales.

## 11. Monitoreo técnico

El panel ahora diferencia eventos mock, feedback pendiente y aprendizaje supervisado. Los logs reales de Hermes/IA/pagos quedan como fase futura.

## 12. Feedback/aprendizaje

Se agregó sección visible para aprendizaje supervisado con correcciones humanas y versiones controladas. No hay autoentrenamiento ni integración IA real.

## 13. Confirmación de que no opera pedidos

El panel muestra copy explícito: “Este panel no cambia estados operativos ni recauda pedidos. Sofía crea pedidos; POS/Domicilios los gestionan.” El E2E valida que no existan botones operativos “Preparar”, “Despachar” o “Cobrar” en `/sofia`.

## 14. Confirmación de que pedidos Sofía siguen en POS/Domicilios

El E2E crea un pedido Sofía desde sandbox, valida chip Sofía y paymentStatus `UNSELECTED` en Domicilios, luego valida chip Sofía y origen en POS.

## 15. Confirmación de chip/color Sofía

No se modificaron `apps/web/src/app/(app)/deliveries/page.tsx` ni `apps/web/src/features/pos/PosActiveOrdersPanel.tsx`. Los E2E confirmaron que los selectores `deliveries-sofia-order-chip`, `deliveries-sofia-payment-status`, `pos-sofia-order-chip` y `pos-sofia-order-origin` siguen presentes.

## 16. Confirmación Caja/Stock/Checkout intactos

La regresión `phase-delivery-auto-3-checkout-cash-audit.spec.ts` pasó. Esta fase no modificó backend, caja, stock, checkout ni delivery pricing.

## 17. Tests

| Test | Resultado | Evidencia |
|---|---:|---|
| Web typecheck | PASS | `/tmp/codex-sofia-config-panel-cleanup-0/web-typecheck.log` |
| API typecheck | PASS | `/tmp/codex-sofia-config-panel-cleanup-0/api-typecheck.log` |
| Web build | PASS | `/tmp/codex-sofia-config-panel-cleanup-0/web-build.log` |
| API build | PASS | `/tmp/codex-sofia-config-panel-cleanup-0/api-build.log` |
| E2E panel Sofía | PASS, 2/2 | `/tmp/codex-sofia-config-panel-cleanup-0/e2e-sofia-config-panel.log` |
| E2E arquitectura Sofía | PASS, 2/2 | `/tmp/codex-sofia-config-panel-cleanup-0/e2e-sofia-order-flow.log` |
| E2E checkout/caja | PASS, 2/2 | `/tmp/codex-sofia-config-panel-cleanup-0/e2e-checkout-cash.log` |
| `test.skip` | PASS, 0 ocurrencias | `/tmp/codex-sofia-config-panel-cleanup-0/test-skip-check.log` |
| Bundle `localhost:4300` | PASS, 0 ocurrencias | `/tmp/codex-sofia-config-panel-cleanup-0/bundle-localhost4300.log` |

## 18. Build/typecheck/health

- `pnpm --filter @inventory-fastfood/api typecheck`: PASS.
- `pnpm --filter @inventory-fastfood/api build`: PASS.
- `pnpm --filter @inventory-fastfood/web typecheck`: PASS.
- `pnpm --filter @inventory-fastfood/web build`: PASS.
- Health final: PASS.
- Docker local web rebuild/restart: PASS, web healthy.

## 19. Screenshots

Capturas generadas en `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-config-panel-cleanup-0/`:

- `01-sofia-panel-before-cleanup.png`
- `02-sofia-panel-after-header.png`
- `03-sofia-agent-status.png`
- `04-sofia-connections.png`
- `05-sofia-operational-rules.png`
- `06-sofia-data-consumed.png`
- `07-sofia-payment-methods-config.png`
- `08-sofia-feedback-monitoring.png`
- `09-link-to-deliveries-pos.png`
- `10-sofia-order-in-deliveries-chip.png`
- `11-sofia-order-in-pos-chip.png`
- `12-final-summary.png`

## 20. Riesgos residuales

- P3: el sandbox técnico sigue visible al final del panel para QA; puede moverse a ruta interna secundaria cuando exista un panel de configuración persistente.
- P3: los valores de combos/imágenes/pagos son placeholders de configuración futura, no integraciones reales.
- Negocio: faltan credenciales/decisiones reales para Hermes, DeepSeek, pagos y `/pagos`.

## 21. Próxima fase recomendada

Fase 2: implementar `/pagos/[token]` como página pública segura, usando pedido operativo como fuente de verdad y reflejando estado de pago en Domicilios/POS.

## 22. Decisión final

**CODEX-SOFIA-CONFIG-PANEL-CLEANUP-0: GO**

## Tabla 1: Elemento

| Elemento | Antes | Decisión | Después | Estado |
|---|---|---|---|---|
| Header Sofía | Núcleo/sandbox como foco principal | Reorientar a configuración | “Sofía”, asistente virtual, sandbox/no conectado/operación en POS | GO |
| Pedidos en Sofía | Sandbox muy prominente | Mantener solo QA controlado | Sandbox técnico al final, no operación diaria | GO |
| Acciones operativas | Riesgo de confusión por copy | Eliminar operación de pedido del mensaje principal | Copy explícito: POS/Domicilios gestionan | GO |
| Domicilios/POS | Flujo operativo real | Conservar intacto | Links claros y chips validados | GO |
| Pagos reales | No implementados | No conectar | Estados de configuración futura | GO |

## Tabla 2: Sección Sofía

| Sección Sofía | Función | Operativa sí/no | Estado |
|---|---|---:|---|
| Estado general | Estado del agente y horario | No | GO |
| Conexiones | Estado técnico de integraciones | No | GO |
| Reglas operativas | Límites del agente | No | GO |
| Datos disponibles | Catálogo/stock consumible | No | GO |
| Métodos de pago | Preparación futura | No | GO |
| Personalidad y ventas | Tono y upsell | No | GO |
| Monitoreo/aprendizaje | Eventos y feedback | No | GO |
| Accesos operativos | Navegar a POS/Domicilios | No, solo enlace | GO |
| Sandbox técnico | QA interno controlado | No operación diaria | GO |

## Tabla 3: Flujo pedido Sofía

| Flujo pedido Sofía | Dónde se opera | Evidencia | Estado |
|---|---|---|---|
| Crear pedido mock | Sandbox técnico controlado | E2E panel Sofía PASS | GO |
| Ver pedido Sofía | Domicilios | Screenshot `10-sofia-order-in-deliveries-chip.png` | GO |
| Ver pedido Sofía | POS | Screenshot `11-sofia-order-in-pos-chip.png` | GO |
| Validar pago `UNSELECTED` | Domicilios/POS | E2E panel Sofía y arquitectura PASS | GO |
| Operación diaria | Domicilios/POS | Copy y enlaces explícitos | GO |

## Tabla 4: Gate

| Gate | Resultado | Evidencia |
|---|---:|---|
| Panel Sofía limpio | PASS | `02-sofia-panel-after-header.png` |
| Panel no opera pedidos | PASS | E2E valida ausencia de botones operativos |
| Configuración/conexiones/reglas/monitoreo visibles | PASS | Screenshots `03` a `09` |
| Pedidos Sofía siguen en Domicilios | PASS | `10-sofia-order-in-deliveries-chip.png` |
| Pedidos Sofía siguen en POS | PASS | `11-sofia-order-in-pos-chip.png` |
| Caja/Stock/Checkout intactos | PASS | `e2e-checkout-cash.log` |
| API/Web build | PASS | `api-build.log`, `web-build.log` |
| Health | PASS | `health.log` |
| `test.skip` nuevo | PASS, 0 | `test-skip-check.log` |
