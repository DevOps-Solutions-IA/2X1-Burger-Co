# CODEX-SOFIA-MANUAL-PAYMENTS-PHASE-3

## 1. Resumen ejecutivo
Se implementó la Fase 3 de pagos manuales Sofía: efectivo contra entrega, Nequi manual pendiente de verificación y validación manual por operador desde Domicilios/POS. El cliente nunca puede marcar `PAID`; solo roles operativos autorizados pueden validar manualmente el pago.

Decisión final: **GO**.

## 2. Estado recibido
- `CODEX-SOFIA-PAYMENTS-WHATSAPP-MASTER-PHASED-PLAN-0: GO`
- `CODEX-SOFIA-WHATSAPP-ORDER-CORE-PHASE-1: GO`
- `CODEX-SOFIA-ORDER-FLOW-ARCHITECTURE-CORRECTION-0: GO`
- `CODEX-SOFIA-PAYMENT-LINK-PAGE-PHASE-2: GO`

## 3. Configuración de pagos manuales
Se agregó `SofiaPaymentSettings` con:

- efectivo habilitado.
- Nequi manual habilitado.
- número Nequi configurable.
- titular Nequi opcional.
- reglas de preparación.
- regla de validación por operador.
- texto de instrucciones.

Nequi no se puede usar desde la página pública si no hay número configurado.

## 4. Flujo efectivo
En `/pagos/[token]`, el cliente selecciona efectivo y debe confirmar explícitamente:

- estado final público: `CASH_ON_DELIVERY`.
- mensaje: “Pago en efectivo contra entrega confirmado.”
- no se marca `PAID`.
- no afecta Caja.
- no afecta Stock.
- no ejecuta checkout.

## 5. Flujo Nequi manual
En `/pagos/[token]`, el cliente selecciona Nequi y ve:

- número configurado.
- titular si existe.
- valor exacto.
- referencia del pedido.
- instrucciones operativas.
- botón “Ya transferí”.

Al confirmar:

- `paymentMethod = NEQUI_MANUAL`.
- `paymentStatus = PENDING_MANUAL_VERIFICATION`.
- no se marca `PAID`.

## 6. Validación manual operador
En Domicilios para pedidos Sofía se agregaron acciones protegidas:

- “Marcar pagado”.
- “Marcar fallido”.
- “Enviar a revisión”.

Solo `admin`, `cashier` y `supervisor` pueden ejecutar estas acciones. `PAID` registra `manuallyVerifiedAt` y `manuallyVerifiedById`.

## 7. Eventos de pago
Se agregó `SofiaPaymentEvent` para auditar:

- efectivo confirmado por cliente.
- transferencia Nequi declarada por cliente.
- operador marcó pagado.
- operador marcó fallido.
- operador envió a revisión.

Cada evento guarda estado anterior, estado nuevo, método, actor si aplica, fecha y mensaje.

## 8. Reflejo en POS/Domicilios
Las tarjetas Sofía mantienen:

- chip “Sofía”.
- acento violeta.
- referencia.
- método.
- estado de pago legible.
- historial de eventos.
- acciones manuales de operador.

## 9. Estados públicos en `/pagos/[token]`
Se muestran estados claros:

- `UNSELECTED`: elige método.
- `CASH_ON_DELIVERY`: pago contra entrega confirmado.
- `PENDING_MANUAL_VERIFICATION`: transferencia pendiente de verificación.
- `PAID`: pago recibido.
- `FAILED`: pago no confirmado.
- `MANUAL_REVIEW`: pago en revisión.
- `CANCELLED`: pago cancelado.

## 10. Confirmación de que no hay Bold real
No se conectó Bold.

## 11. Confirmación de que no hay Nequi API
No se conectó API de Nequi. Nequi es manual y validado por operador.

## 12. Confirmación de que no hay WhatsApp real
No se conectó WhatsApp/Hermes real.

## 13. Confirmación de que no hay IA real
No se conectó DeepSeek ni agente real.

## 14. Confirmación de que no se marca PAID desde cliente
El endpoint público solo permite seleccionar `CASH`, `NEQUI_MANUAL` u `ONLINE` disponible. El cliente no puede enviar `PAID`; se valida con tests.

## 15. Confirmación de Caja/Stock/Checkout intactos
Marcar `PAID` manualmente no crea venta, no crea movimiento de caja y no descuenta stock fuera del flujo existente. Se validó regresión checkout/caja.

## 16. Tests backend
Resultado: PASS.

Evidencia: `/tmp/codex-sofia-manual-payments-phase-3/api-test.log`

- 12 suites PASS.
- 215 tests PASS.
- Incluye Nequi configurado, evento público, bloqueo sin auth, operador marcando `PAID` y eventos de pago.

## 17. E2E
Resultado: PASS.

Evidencias:

- `/tmp/codex-sofia-manual-payments-phase-3/e2e-sofia-manual-payments.log`
- `/tmp/codex-sofia-manual-payments-phase-3/e2e-sofia-payment-link.log`
- `/tmp/codex-sofia-manual-payments-phase-3/e2e-sofia-order-flow.log`
- `/tmp/codex-sofia-manual-payments-phase-3/e2e-checkout-cash.log`

## 18. Build/typecheck/health
Resultado: PASS.

Evidencias:

- `/tmp/codex-sofia-manual-payments-phase-3/api-typecheck.log`
- `/tmp/codex-sofia-manual-payments-phase-3/api-build.log`
- `/tmp/codex-sofia-manual-payments-phase-3/web-typecheck.log`
- `/tmp/codex-sofia-manual-payments-phase-3/web-build.log`
- `/tmp/codex-sofia-manual-payments-phase-3/health.log`

## 19. Screenshots
Capturas generadas en `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-manual-payments-phase-3/`:

1. `01-payment-page-methods-before.png`
2. `02-cash-method-selected.png`
3. `03-cash-confirmed-public.png`
4. `04-delivery-card-cash-on-delivery.png`
5. `05-nequi-method-selected.png`
6. `06-nequi-instructions.png`
7. `07-nequi-pending-verification-public.png`
8. `08-delivery-card-nequi-pending.png`
9. `09-operator-mark-paid-action.png`
10. `10-delivery-card-paid.png`
11. `11-payment-events-history.png`
12. `12-final-summary.png`

## 20. Riesgos residuales
- La conciliación contable completa de pagos Sofía contra Caja debe definirse en una fase futura para evitar doble recaudo.
- Online sigue como método futuro sin proveedor real.
- El número Nequi queda preparado por configuración; debe cargarse con dato real del negocio antes de operar.

## 21. Próxima fase recomendada
Fase 4: refinamiento operativo en POS/Domicilios para filtros, reportes operativos y conciliación visual de pagos Sofía, o Fase 5: adapter de pagos online provider-ready.

## 22. Decisión final
`CODEX-SOFIA-MANUAL-PAYMENTS-PHASE-3: GO`

## Tabla 1: Estado/Método
| Estado/Método | Cambio | Regla | Estado |
|---|---|---|---|
| `CASH` | Confirmación explícita cliente | Queda `CASH_ON_DELIVERY`, no `PAID` | PASS |
| `NEQUI_MANUAL` | Instrucciones con número configurable | Queda `PENDING_MANUAL_VERIFICATION`, no `PAID` | PASS |
| `PAID` | Solo operador autorizado | Registra verificador y evento | PASS |
| `FAILED` | Solo operador autorizado | Registra evento | PASS |
| `MANUAL_REVIEW` | Solo operador autorizado | Registra evento | PASS |
| `CANCELLED` | Estado agregado a enum | Preparado para cierre manual | PASS |

## Tabla 2: Endpoint/Acción
| Endpoint/Acción | Rol | Función | Estado |
|---|---|---|---|
| `GET /public/sofia/payments/:token` | Público | Muestra métodos configurados | PASS |
| `POST /public/sofia/payments/:token/select-method` | Público | Confirma efectivo o declara Nequi transferido | PASS |
| `PATCH /admin/sofia/payment-settings` | Admin/Cajero/Supervisor | Configura efectivo/Nequi manual | PASS |
| `PATCH /orders/:id/sofia-payment-status` | Admin/Cajero/Supervisor | Marca `PAID`, `FAILED`, `MANUAL_REVIEW` | PASS |
| `GET /orders/:id/sofia-payment-events` | Admin/Cajero/Supervisor | Lista historial de eventos | PASS |

## Tabla 3: Flujo
| Flujo | Resultado esperado | Resultado final | Estado |
|---|---|---|---|
| Efectivo público | `CASH_ON_DELIVERY`, no `PAID` | Confirmado y visible en Domicilios | PASS |
| Nequi público | `PENDING_MANUAL_VERIFICATION`, no `PAID` | Confirmado y visible en Domicilios | PASS |
| Operador marca pagado | `PAID` con auditoría | Verificador y evento registrados | PASS |
| Cliente intenta `PAID` | Rechazado | 400 en endpoint público | PASS |
| Sin auth marca pagado | Rechazado | 401/403/404 esperado | PASS |
| POS/Domicilios | Chip Sofía + estado/método | Visible y legible | PASS |
| Caja/Stock/Checkout | Sin afectación | Regresión E2E PASS | PASS |

## Tabla 4: Gate
| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/codex-sofia-manual-payments-phase-3/api-typecheck.log` |
| API build | PASS | `/tmp/codex-sofia-manual-payments-phase-3/api-build.log` |
| API tests | PASS | `/tmp/codex-sofia-manual-payments-phase-3/api-test.log` |
| Web typecheck | PASS | `/tmp/codex-sofia-manual-payments-phase-3/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-sofia-manual-payments-phase-3/web-build.log` |
| E2E manual payments | PASS | `/tmp/codex-sofia-manual-payments-phase-3/e2e-sofia-manual-payments.log` |
| E2E payment link | PASS | `/tmp/codex-sofia-manual-payments-phase-3/e2e-sofia-payment-link.log` |
| E2E order flow | PASS | `/tmp/codex-sofia-manual-payments-phase-3/e2e-sofia-order-flow.log` |
| E2E checkout/cash | PASS | `/tmp/codex-sofia-manual-payments-phase-3/e2e-checkout-cash.log` |
| Health | PASS | `/tmp/codex-sofia-manual-payments-phase-3/health.log` |
| Docker build | PASS | `/tmp/codex-sofia-manual-payments-phase-3/docker-compose-build-api-web.log` |
| Bundle `localhost:4300` | PASS | `/tmp/codex-sofia-manual-payments-phase-3/bundle-localhost4300.log` |
| `test.skip` | PASS | `/tmp/codex-sofia-manual-payments-phase-3/test-skip-check.log` |
