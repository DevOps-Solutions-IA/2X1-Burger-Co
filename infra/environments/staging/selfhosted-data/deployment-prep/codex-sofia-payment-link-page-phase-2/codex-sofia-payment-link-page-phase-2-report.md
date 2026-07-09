# CODEX-SOFIA-PAYMENT-LINK-PAGE-PHASE-2

## 1. Resumen ejecutivo
Se implementó la Fase 2 del ecosistema Sofía: link público seguro `/pagos/[token]` para pedidos WhatsApp/Sofía ya operados desde POS/Domicilios. La página carga el pedido precargado, permite seleccionar método de pago sin procesar pagos reales y refleja el método/estado en Domicilios/POS.

Decisión final: **GO**.

## 2. Estado recibido
- `CODEX-SOFIA-PAYMENTS-WHATSAPP-MASTER-PHASED-PLAN-0: GO`.
- `CODEX-SOFIA-WHATSAPP-ORDER-CORE-PHASE-1: GO`.
- `CODEX-SOFIA-ORDER-FLOW-ARCHITECTURE-CORRECTION-0: GO`.
- Arquitectura vigente: Sofía crea pedidos, pero la operación vive en POS/Domicilios.

## 3. Confirmación arquitectura: pedidos operan en POS/Domicilios
No se agregó operación de pedidos al panel Sofía. La generación/consulta del link se expuso desde el pedido operativo en Domicilios/POS y el pedido conserva chip/acento “Sofía”.

## 4. Campos/modelos agregados
Modelo actualizado: `WhatsappDeliveryOrder`.

- `publicPaymentToken`: token público único no predecible.
- `publicPaymentTokenExpiresAt`: expiración del link.
- `paymentLinkCreatedAt`: auditoría de creación.
- `paymentLinkLastOpenedAt`: auditoría de apertura.
- `paymentLinkOpenCount`: contador de aperturas.
- `paymentMethodSelectedAt`: auditoría de selección de método.
- `orderReference`: referencia visible tipo `ORD-xxxxx`.

Migración aplicada: `20260630211800_sofia_public_payment_link`.

## 5. Servicio de link público
Se creó `SofiaPaymentLinkService` con generación/regeneración de token, consulta pública segura, registro de apertura, validación de expiración y selección de método sin marcar `PAID`.

## 6. Endpoints públicos
- `GET /public/sofia/payments/:token`: devuelve payload seguro del pedido precargado.
- `POST /public/sofia/payments/:token/select-method`: registra `ONLINE`, `NEQUI_MANUAL` o `CASH`.

## 7. Endpoints operativos POS/Domicilios
- `POST /orders/:id/sofia-payment-link`: genera/regenera link para pedido Sofía operativo.
- `GET /orders/:id/sofia-payment-link`: consulta link/estado.

Requieren sesión operativa con roles existentes.

## 8. Página `/pagos/[token]`
Ruta pública agregada en Next.js:

- `/pagos/[token]`
- Sin login.
- Sin layout administrativo.
- Mobile-first.
- Pedido precargado.
- Cliente, teléfono, dirección, barrio.
- Productos, cantidades, subtotales, domicilio y total.
- Métodos: online, Nequi manual y efectivo.

## 9. Estados visuales
Implementados:

- loading.
- token inválido.
- link expirado.
- pedido cargado.
- método seleccionado.
- error controlado.

## 10. Seguridad del token
El token se genera con bytes aleatorios, no usa IDs internos y no se expone en respuestas operativas. El endpoint público no devuelve IDs internos ni raw payloads.

## 11. Expiración
El link tiene expiración. Si está vencido, la página devuelve estado controlado y no expone datos sensibles del cliente.

## 12. Reflejo en POS/Domicilios
La selección de método en `/pagos/[token]` actualiza el pedido Sofía operativo:

- `paymentMethod`.
- `paymentStatus`.
- `paymentMethodSelectedAt`.
- `orderReference`.

Domicilios y POS muestran la referencia/método/estado junto al chip “Sofía”.

## 13. Confirmación de que no hay pagos reales
No se integró proveedor real. No se creó cobro real. No se agregó webhook real.

## 14. Confirmación de que no se marca PAID
La selección pública de método nunca marca `PAID`.

- `CASH` queda como `CASH_ON_DELIVERY`.
- `ONLINE` queda como `PENDING_MANUAL_VERIFICATION`.
- `NEQUI_MANUAL` queda como `PENDING_MANUAL_VERIFICATION`.

## 15. Confirmación no Bold real
No se conectó Bold.

## 16. Confirmación no Nequi API
No se conectó API de Nequi.

## 17. Confirmación no WhatsApp real
No se conectó WhatsApp/Hermes real.

## 18. Confirmación no IA real
No se conectó DeepSeek ni agente conversacional real.

## 19. Confirmación no POS/Caja/Stock/Delivery afectados
La fase no modifica checkout, caja ni stock. Se validó regresión crítica de checkout/caja/delivery.

## 20. Tests backend
Resultado: PASS.

Evidencia: `/tmp/codex-sofia-payment-link-page-phase-2/api-test.log`.

- 12 suites PASS.
- 215 tests PASS.
- Incluye generación de link, token no predecible, GET público, token inválido, token expirado, selección de método, no `PAID`, no datos sensibles y reflejo en Domicilios.

## 21. E2E
Resultado: PASS.

Evidencias:

- `/tmp/codex-sofia-payment-link-page-phase-2/e2e-sofia-payment-link.log`.
- `/tmp/codex-sofia-payment-link-page-phase-2/e2e-sofia-order-flow.log`.
- `/tmp/codex-sofia-payment-link-page-phase-2/e2e-checkout-cash.log`.

## 22. Build/typecheck/health
Resultado: PASS.

Evidencias:

- `/tmp/codex-sofia-payment-link-page-phase-2/api-typecheck.log`.
- `/tmp/codex-sofia-payment-link-page-phase-2/api-build.log`.
- `/tmp/codex-sofia-payment-link-page-phase-2/web-typecheck.log`.
- `/tmp/codex-sofia-payment-link-page-phase-2/web-build.log`.
- `/tmp/codex-sofia-payment-link-page-phase-2/health.log`.

## 23. Screenshots
Capturas generadas:

1. `01-sofia-order-in-deliveries-before-link.png`
2. `02-sofia-order-generate-payment-link.png`
3. `03-sofia-order-copy-payment-link.png`
4. `04-public-payment-page-loaded.png`
5. `05-public-payment-order-summary.png`
6. `06-public-payment-methods.png`
7. `07-public-method-selected.png`
8. `08-pos-delivery-payment-method-reflected.png`
9. `09-public-token-invalid.png`
10. `10-public-token-expired.png`
11. `11-public-mobile-view.png`
12. `12-final-summary.png`

Ruta: `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-payment-link-page-phase-2/`.

## 24. Riesgos residuales
- Fase 3 debe implementar control operativo completo para pagos manuales efectivo/Nequi.
- Online provider sigue pendiente y debe entrar por adapter/provider, no acoplado directamente a Bold.
- El TTL actual del link queda definido en backend; se puede convertir a setting configurable en una fase posterior.

## 25. Próxima fase recomendada
Fase 3: pagos manuales efectivo + Nequi, con validación operativa desde Domicilios/POS, eventos auditables y sin marcar pagos como automáticos sin evidencia.

## 26. Decisión final
`CODEX-SOFIA-PAYMENT-LINK-PAGE-PHASE-2: GO`

## Tabla 1: Modelo/Campo
| Modelo/Campo | Cambio | Riesgo | Estado |
|---|---|---:|---|
| `WhatsappDeliveryOrder.publicPaymentToken` | Token público único y no predecible | Bajo | PASS |
| `WhatsappDeliveryOrder.publicPaymentTokenExpiresAt` | Expiración de link | Bajo | PASS |
| `WhatsappDeliveryOrder.paymentLinkCreatedAt` | Auditoría de creación | Bajo | PASS |
| `WhatsappDeliveryOrder.paymentLinkLastOpenedAt` | Auditoría de apertura | Bajo | PASS |
| `WhatsappDeliveryOrder.paymentLinkOpenCount` | Contador de aperturas | Bajo | PASS |
| `WhatsappDeliveryOrder.paymentMethodSelectedAt` | Auditoría de selección | Bajo | PASS |
| `WhatsappDeliveryOrder.orderReference` | Referencia pública `ORD-xxxxx` | Bajo | PASS |

## Tabla 2: Endpoint
| Endpoint | Público/Operativo | Función | Estado |
|---|---|---|---|
| `GET /public/sofia/payments/:token` | Público | Consultar pedido precargado por token | PASS |
| `POST /public/sofia/payments/:token/select-method` | Público | Seleccionar método sin pago real | PASS |
| `POST /orders/:id/sofia-payment-link` | Operativo | Generar/regenerar link desde POS/Domicilios | PASS |
| `GET /orders/:id/sofia-payment-link` | Operativo | Consultar link/estado | PASS |

## Tabla 3: Flujo
| Flujo | Resultado esperado | Resultado final | Estado |
|---|---|---|---|
| Crear pedido Sofía | Pedido aparece en Domicilios/POS | Aparece con chip/acento Sofía | PASS |
| Generar link | URL `/pagos/{token}` segura | Token aleatorio y referencia pública | PASS |
| Abrir link sin login | Pedido precargado | Carga cliente, dirección, ítems y total | PASS |
| Seleccionar Nequi manual | No marcar `PAID` | `PENDING_MANUAL_VERIFICATION` | PASS |
| Token inválido | Error controlado | Mensaje seguro al cliente | PASS |
| Token expirado | Link vencido sin datos sensibles | Estado expirado controlado | PASS |
| Reflejo POS/Domicilios | Método/estado visibles | Visible por referencia del pedido | PASS |

## Tabla 4: Gate
| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/api-typecheck.log` |
| API build | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/api-build.log` |
| API tests | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/api-test.log` |
| Web typecheck | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/web-build.log` |
| E2E Fase 2 | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/e2e-sofia-payment-link.log` |
| E2E Sofía flow | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/e2e-sofia-order-flow.log` |
| E2E checkout/cash | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/e2e-checkout-cash.log` |
| Health | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/health.log` |
| Bundle `localhost:4300` | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/bundle-localhost4300.log` |
| Docker build | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/docker-compose-build-api-web.log` |
| `test.skip` | PASS | `/tmp/codex-sofia-payment-link-page-phase-2/test-skip-check.log` |
