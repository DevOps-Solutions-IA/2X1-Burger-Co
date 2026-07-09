# SOFIA-COMMERCIAL-BRAIN-PROMPT-CATALOG-MEMORY-1

## 1. Resumen ejecutivo

F1 queda implementada como cerebro comercial canónico de Sofía para sandbox y pruebas internas. Se agregó prompt maestro versionado, catálogo comercial único, composición oficial de ofertas, memoria persistente por cliente/conversación, eventos de reglas comerciales y validaciones de SafetyGuard contra el catálogo/memoria.

No se activó QR real, DeepSeek real, WhatsApp real, pagos reales ni Auto Safe real. POS/Domicilios/Pagos/Caja/Stock/Checkout permanecen separados e intactos.

## 2. Estado recibido

- `SOFIA-MASTER-ARCHITECTURE-AUDIT-0`: GO.
- `SOFIA-SECURITY-SECRETS-SANITIZATION-0`: GO CONDICIONADO por rotación externa manual pendiente.
- F1 debía construir cerebro comercial sandbox sin activar canales/proveedores reales.

## 3. Alcance real de F1

- Backend: modelos Prisma, migración, servicios de prompt/catálogo/memoria, integración con `SofiaAgentService`, SafetyGuard y endpoints admin.
- Frontend: ajuste mínimo en `/sofia/sandbox` para mostrar prompt, catálogo y memoria usados.
- Tests: API crítica, E2E sandbox comercial, regresión sandbox multimedia, smoke checkout/caja.

## 4. Qué se creó

- Modelos: `SofiaPromptVersion`, `SofiaCommercialCatalogItem`, `SofiaCustomerMemory`, `SofiaConversationMemory`, `SofiaCommercialRuleEvent`.
- Servicios: `SofiaPromptService`, `SofiaCommercialCatalogService`, `SofiaCustomerMemoryService`, `SofiaConversationMemoryService`.
- Seed canónico: `SOFIA_MASTER_PROMPT_V1` y catálogo mínimo Sofía.
- Endpoints admin internos: prompt activo, versiones, catálogo, memoria y sandbox comercial.
- E2E: `tests/e2e/sofia-commercial-brain-prompt-catalog-memory-1.spec.ts`.

## 5. Qué se modificó

- `SofiaAgentService` ahora carga prompt activo, catálogo canónico y memoria.
- `SofiaSafetyGuard` reconoce frases prohibidas adicionales para Maxi Family.
- `/sofia/sandbox` muestra contexto comercial estructurado.
- Tests críticos cubren prompt, catálogo, memoria, Maxi Family y anti-invención.

## 6. Qué no se tocó

- No se modificaron reglas de Caja, Stock, Checkout, POS ni Domicilios.
- No se activó DeepSeek real.
- No se conectó WhatsApp QR real.
- No se enviaron mensajes reales.
- No se cambió el estado de pagos desde IA/WhatsApp.

## 7. Prompt maestro versionado

Versión activa: `SOFIA_MASTER_PROMPT_V1`.

Incluye identidad, tono, misión comercial, límites operativos, reglas de memoria, salida estructurada y protección explícita de Maxi Family.

## 8. Catálogo comercial canónico

Ofertas principales:

- Maxi Family.
- 2x1 Hamburguesas.
- Doble Todo.
- Hamburguesa Sencilla.

Adiciones:

- Carne extra.
- Tocineta.
- Queso.
- Papitas adicionales.

Bebidas:

- Solo se consultan desde productos reales disponibles; no se inventan.

## 9. Memoria persistente

Se agregó memoria por teléfono normalizado y memoria por conversación.

La memoria guarda datos mínimos: nombre, dirección conocida, método preferido, último pedido confirmado, preferencias simples y resumen seguro.

No guarda secretos, tarjetas, comprobantes ni payloads sensibles.

## 10. Integración con SofiaAgentService

`SofiaAgentService` ahora:

- Carga prompt activo.
- Usa catálogo canónico para detectar ofertas y explicar composición.
- Actualiza memoria por interacción.
- Responde “lo mismo de ayer” solo si existe último pedido confiable.
- Registra eventos de regla comercial cuando corrige/bloquea.
- Mantiene DeepSeek real deshabilitado por defecto.

## 11. Integración con SafetyGuard

SafetyGuard valida:

- Productos inexistentes.
- Precios inventados.
- Pago `PAID` desde IA/WhatsApp.
- Claims prohibidos de Maxi Family.
- Acciones críticas no permitidas por IA.

## 12. Sandbox comercial

Ruta ajustada: `/sofia/sandbox`.

Muestra:

- Prompt usado.
- Catálogo detectado.
- Memoria activa.
- Respuesta generada.
- Safety notes vía resultado estructurado.

## 13. Endpoints admin

| Endpoint | Función | Estado |
|---|---|---|
| `GET /admin/sofia/prompt/active` | Prompt activo sanitizado | PASS |
| `GET /admin/sofia/prompt/versions` | Versiones de prompt | PASS |
| `GET /admin/sofia/catalog` | Catálogo comercial activo | PASS |
| `GET /admin/sofia/catalog/:slug` | Detalle de oferta/producto | PASS |
| `GET /admin/sofia/memory/:phone` | Memoria sanitizada | PASS |
| `POST /admin/sofia/sandbox/commercial-message` | Prueba comercial sandbox | PASS |

## 14. Tests unitarios / críticos

Evidencia:

- `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/tests.log`
- `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/app-critical-after-intent-fix.log`

Resultado final API: 12 suites PASS, 220 tests PASS.

## 15. E2E / validación funcional

Evidencia:

- `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/e2e.log`
- `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/e2e-sofia-agent-multimedia-sandbox.log`
- `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/e2e-checkout-cash.log`

Resultados:

- F1 E2E comercial: PASS.
- Regresión sandbox multimedia: PASS.
- Checkout/Caja smoke: PASS.

## 16. Evidencia Maxi Family

Regla protegida:

`El Maxi Family trae 6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L.`

Upsell permitido:

`Si quieres que todos acompañen con papitas, puedes agregar porciones adicionales.`

Frases prohibidas solo aparecen en listas de bloqueo, tests negativos o panel de configuración; no aparecen como copy comercial permitido.

## 17. Evidencia anti-invención

Producto inexistente `sushi galactico` no genera producto, precio ni pedido. La respuesta pasa a confirmación con equipo.

## 18. Evidencia “lo mismo de ayer”

- Sin memoria: Sofía responde que no tiene pedido anterior confirmado.
- Con memoria: Sofía propone repetir el último pedido registrado.

## 19. Evidencia no activar QR real

No se agregó provider QR ni sesión real. El sandbox mantiene `noWhatsappReal=true`.

## 20. Evidencia no activar DeepSeek real

El modo IA continúa `disabled` por defecto. Las pruebas no usan API externa ni claves reales.

## 21. Evidencia POS/Domicilios/Pagos/Caja/Stock/Checkout intactos

- API critical PASS.
- E2E checkout/caja PASS.
- SafetyGuard bloquea `PAID` desde IA/WhatsApp.
- Las órdenes operativas siguen entrando por flujos existentes de Domicilios/POS.

## 22. Logs de build/typecheck/tests

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/api-typecheck.log` |
| Web typecheck | PASS | `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/web-typecheck.log` |
| API build | PASS | `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/api-build.log` |
| Web build | PASS | `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/web-build.log` |
| API tests | PASS | `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/tests.log` |
| E2E F1 | PASS | `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/e2e.log` |
| Health | PASS | `/tmp/sofia-commercial-brain-prompt-catalog-memory-1/health-after.log` |

## 23. Riesgos residuales

- Rotación externa manual de secretos reales/probables sigue pendiente antes de activar QR real, DeepSeek real o Auto Safe con clientes.
- Panel enterprise `/sofia` completo queda para fase posterior.
- Catálogo canónico permite `priceSource=NONE` cuando no hay producto real enlazado; Sofía no inventa precios en esos casos.

## 24. Próxima fase recomendada

F2: Auto Safe Engine sandbox/controlado sobre este cerebro comercial, con SafetyGuard como gate obligatorio antes de cualquier auto-respuesta futura.

## 25. Tablas obligatorias

### Tabla 1: Componente | Resultado | Evidencia | Estado

| Componente | Resultado | Evidencia | Estado |
|---|---|---|---|
| Prompt maestro versionado | `SOFIA_MASTER_PROMPT_V1` activo | API critical + endpoint prompt | PASS |
| Catálogo comercial canónico | 4 ofertas + adiciones | API critical + endpoint catálogo | PASS |
| Memoria persistente | Cliente/conversación persistentes | API critical memoria | PASS |
| SafetyGuard | Maxi, pagos, productos y precios protegidos | API critical + E2E | PASS |
| Sandbox comercial | Endpoint y UI mínima funcional | E2E F1 + sandbox previo | PASS |

### Tabla 2: Caso comercial | Respuesta esperada | Resultado | Evidencia

| Caso comercial | Respuesta esperada | Resultado | Evidencia |
|---|---|---|---|
| Qué trae Maxi Family | 6 burgers + porción personal + Pepsi 1.5 L | PASS | API/E2E |
| Doble Todo | doble carne, doble tocineta, doble queso cheddar en lonjas | PASS | API/E2E |
| Producto inexistente | No inventa, confirma con equipo | PASS | API/E2E |
| Lo mismo de ayer sin memoria | No inventa memoria | PASS | API |
| Lo mismo de ayer con memoria | Propone último pedido | PASS | API |
| Pago por Nequi | No marca pagado | PASS | API |

### Tabla 3: Regla crítica | Validación | Resultado | Evidencia

| Regla crítica | Validación | Resultado | Evidencia |
|---|---|---|---|
| Maxi Family copy | Contiene composición exacta | PASS | API/E2E |
| Frases prohibidas | No aparecen en respuesta comercial | PASS | grep + tests |
| No precios inventados | `priceSource=NONE` no genera precio | PASS | tests |
| No `PAID` desde IA | SafetyGuard bloquea | PASS | tests |
| No pedido final sin confirmación | Draft antes de confirmación | PASS | tests |

### Tabla 4: Gate | Resultado | Evidencia

| Gate | Resultado | Evidencia |
|---|---|---|
| `test.skip` | Vacío | `/tmp/.../test-skip-check.log` |
| `process.exit(0)` | Vacío | `/tmp/.../process-exit-check.log` |
| Secret regression | Vacío | `/tmp/.../secret-regression-check.log` |
| API tests | PASS | `/tmp/.../tests.log` |
| E2E críticos | PASS | `/tmp/.../e2e*.log` |

### Tabla 5: Qué no se tocó | Estado | Evidencia

| Qué no se tocó | Estado | Evidencia |
|---|---|---|
| QR real | No conectado | Código y pruebas sandbox |
| DeepSeek real | No activado | AI mode disabled |
| WhatsApp real | No enviado | `noWhatsappReal=true` |
| Pagos reales | No modificados | PaymentLink intacto |
| Caja/Stock/Checkout | Intactos | API critical + E2E checkout |
| POS/Domicilios | Intactos | Flujos previos PASS |

## 26. Decisión final

`SOFIA-COMMERCIAL-BRAIN-PROMPT-CATALOG-MEMORY-1: GO`

La fase cumple los criterios: prompt versionado, catálogo canónico, memoria persistente, regla Maxi Family, anti-invención, sandbox comercial y validaciones PASS, sin activar QR real, DeepSeek real ni afectar POS/Domicilios/Pagos/Caja/Stock/Checkout.
