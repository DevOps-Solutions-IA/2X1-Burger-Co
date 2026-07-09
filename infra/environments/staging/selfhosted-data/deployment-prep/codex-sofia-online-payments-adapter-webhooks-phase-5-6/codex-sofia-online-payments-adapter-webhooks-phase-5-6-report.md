# CODEX-SOFIA-ONLINE-PAYMENTS-ADAPTER-WEBHOOKS-PHASE-5-6

## 1. Resumen ejecutivo

Se implemento la arquitectura provider-ready de pagos online para pedidos Sofia, con adapter de proveedores, mock seguro para desarrollo/test, estructura Bold-ready sin activacion real y webhooks idempotentes con validacion de firma, referencia, monto y moneda.

La seleccion de pago online desde `/pagos/[token]` crea `PENDING_ONLINE_PAYMENT` y nunca marca `PAID` desde el cliente. El estado `PAID` solo se alcanza por webhook valido o por acciones operativas autorizadas existentes. No se conectaron pagos reales, no se usaron credenciales reales y no se afecto Caja/Stock/Checkout.

## 2. Estado recibido

| Fase recibida | Estado |
|---|---|
| CODEX-SOFIA-PAYMENTS-WHATSAPP-MASTER-PHASED-PLAN-0 | GO |
| CODEX-SOFIA-WHATSAPP-ORDER-CORE-PHASE-1 | GO |
| CODEX-SOFIA-ORDER-FLOW-ARCHITECTURE-CORRECTION-0 | GO |
| CODEX-SOFIA-PAYMENT-LINK-PAGE-PHASE-2 | GO |
| CODEX-SOFIA-MANUAL-PAYMENTS-PHASE-3 | GO |
| CODEX-SOFIA-POS-DELIVERY-OPERATIONS-PHASE-4 | GO |

## 3. Alcance Fase 5

Se agrego `PaymentProviderAdapter` con implementaciones `MockPaymentProvider`, `BoldPaymentProvider` y `NullPaymentProvider`. El dominio Sofia no llama directamente a Bold.

## 4. Alcance Fase 6

Se agregaron webhooks generales para proveedores de pago, idempotencia por `eventId`, validaciones de referencia/monto/moneda/firma y eventos auditables.

## 5. Configuracion de pago online

`SofiaPaymentSettings` fue extendido con flags de online, provider, mock, Bold, TTL de link y expiracion de intento online. Mock queda permitido solo fuera de produccion.

## 6. Adapter implementado

| Componente | Cambio | Riesgo | Estado |
|---|---|---:|---|
| PaymentProviderAdapter | Contrato comun para createPayment, status, webhook, firma y mapeo | Medio | PASS |
| MockPaymentProvider | Crea checkout mock y parsea webhooks firmados | Medio | PASS |
| BoldPaymentProvider | Estructura Bold-ready sin llamadas reales ni credenciales | Bajo | PASS condicionado a credenciales/docs reales futuras |
| NullPaymentProvider | Bloquea online cuando no hay provider disponible | Bajo | PASS |

## 7. MockPaymentProvider

Genera `checkoutUrl` local `/pagos/mock/[reference]`, estado inicial pendiente y webhooks firmados con `x-mock-payment-signature`. Esta ruta no representa dinero real.

## 8. BoldPaymentProvider preparado

Lee variables futuras de entorno, valida configuracion, no falla build sin credenciales y devuelve error controlado si se intenta usar sin configuracion. No se hicieron llamadas reales.

## 9. NullPaymentProvider

Deshabilita online cuando el provider no esta configurado o no es seguro.

## 10. Flujo online en `/pagos/[token]`

El cliente puede elegir “Pagar en linea”. Al confirmar:

- `paymentMethod = ONLINE`
- `paymentStatus = PENDING_ONLINE_PAYMENT`
- Se guarda provider, referencia, checkout URL y expiracion
- Se registra `ONLINE_PAYMENT_CREATED`
- No se marca `PAID`

## 11. Checkout/mock

Se creo `/pagos/mock/[reference]` como pantalla controlada de desarrollo/test. La simulacion de pago se valida por webhook mock firmado.

## 12. Webhook general

Endpoint implementado:

| Endpoint | Tipo | Funcion | Estado |
|---|---|---|---|
| `POST /integrations/payments/webhook/:provider` | Integracion | Procesa webhooks provider-ready | PASS |
| `POST /dev/sofia/payments/mock-webhook` | Dev protegido | Simula webhook mock con auth/roles | PASS |

## 13. Idempotencia

Se agrego `PaymentWebhookEvent`. Si llega el mismo `eventId`, el evento se ignora como duplicado. Si llega `PAID` repetido sobre un pago ya pagado, no duplica transicion critica.

## 14. Validacion de monto/referencia/firma

| Webhook caso | Resultado esperado | Resultado final | Estado |
|---|---|---|---|
| PAID valido | Marca `PAID` | `PAID` | PASS |
| FAILED valido | Marca `FAILED` | `FAILED` | PASS |
| Duplicado | Ignora transicion | `DUPLICATE_IGNORED` | PASS |
| Monto incorrecto | `MANUAL_REVIEW` | `MANUAL_REVIEW` | PASS |
| Firma invalida | No actualiza pedido | `SIGNATURE_INVALID` | PASS |
| Referencia desconocida | No actualiza pedido | `REFERENCE_UNKNOWN` | PASS |

## 15. Eventos de pago

Se registran eventos como `ONLINE_PAYMENT_CREATED`, `WEBHOOK_MARKED_PAID`, `WEBHOOK_MARKED_FAILED`, `WEBHOOK_AMOUNT_MISMATCH`, `WEBHOOK_SIGNATURE_INVALID` y duplicados ignorados.

## 16. Reflejo en POS/Domicilios

Domicilios/POS muestran `Online pendiente`, `Pagado`, `Pago fallido` y `Revisión manual`, manteniendo chip/acento Sofia y eventos visibles.

## 17. Seguridad

- No se guardaron credenciales reales.
- Mock bloquea simulacion en `production`.
- El cliente publico no puede marcar `PAID`.
- Webhook valida firma para mock y estructura para Bold.
- No se exponen secretos en logs ni respuesta publica.
- No se crean movimientos de caja automaticos.

## 18. Confirmaciones

| Confirmacion | Estado |
|---|---|
| No pagos reales | PASS |
| No credenciales reales | PASS |
| No Bold real activo | PASS |
| No WhatsApp real | PASS |
| No DeepSeek real | PASS |
| Caja intacta | PASS |
| Stock intacto | PASS |
| Checkout intacto | PASS |

## 19. Tests backend

`pnpm --filter @inventory-fastfood/api test`: 12 suites PASS, 216 tests PASS.

## 20. E2E

| E2E | Resultado |
|---|---|
| `sofia-online-payments*.spec.ts` | PASS |
| `sofia-pos-delivery-operations*.spec.ts` | PASS |
| `sofia-manual-payments*.spec.ts` | PASS |
| `sofia-payment-link*.spec.ts` | PASS |
| `phase-delivery-auto-3-checkout-cash-audit.spec.ts` | PASS |

## 21. Build/typecheck/health

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/api-typecheck.log` |
| API build | PASS | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/api-build.log` |
| API test | PASS | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/api-test.log` |
| Web typecheck | PASS | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/web-typecheck.log` |
| Web build | PASS | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/web-build.log` |
| Docker build API/Web | PASS | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/docker-compose-build-api-web.log` |
| Health | PASS | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/health-final.log` |
| Bundle `localhost:4300` | PASS limpio | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/bundle-localhost4300.log` |
| `test.skip` | PASS limpio | `/tmp/codex-sofia-online-payments-adapter-webhooks-phase-5-6/test-skip-check.log` |

## 22. Screenshots

Screenshots guardadas en:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-online-payments-adapter-webhooks-phase-5-6/`

Incluyen pagina online disponible, pago pendiente, checkout mock, PAID por webhook, FAILED, revision manual por mismatch, duplicado idempotente y POS/Domicilios reflejando estado.

## 23. Riesgos residuales

| Riesgo | Estado |
|---|---|
| Bold real requiere confirmar API/firma oficiales antes de activar | Pendiente negocio/proveedor |
| Conciliacion Caja vs pago online no automatizada en esta fase | Pendiente fase futura |
| Provider real debe habilitarse solo con variables seguras | Documentado |

## 24. Proxima fase recomendada

Fase 7: Sofía agente conversacional sandbox con DeepSeek-ready, sin WhatsApp real inicialmente y consumiendo productos/stock reales.

## 25. Decision final

`CODEX-SOFIA-ONLINE-PAYMENTS-ADAPTER-WEBHOOKS-PHASE-5-6: GO`

Los pagos online Sofia quedan provider-ready con adapter, mock seguro, estructura Bold-ready, webhooks idempotentes y reflejo en POS/Domicilios, sin activar pagos reales ni afectar Caja/Stock/Checkout.
