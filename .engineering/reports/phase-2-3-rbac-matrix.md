# Phase 2.3 - Matriz RBAC

Fecha: 2026-07-14.

## Cobertura de fuente

| Política | Handlers | Criterio |
| --- | ---: | --- |
| JWT + roles | 230 | `JwtAuthGuard` y `@Roles` efectivos a nivel clase/método |
| JWT autenticado | 6 | Autenticación requerida sin restricción adicional de rol |
| Público explícito | 8 | `@Public` visible y auditable |
| Capability token | 2 | Link público Sofía con token de capacidad validado por servicio |
| Firma de proveedor | 3 | Webhooks WhatsApp/Hermes/pagos con verificación de firma |
| Sin clasificar | 0 | El auditor falla si aparece una ruta nueva sin política |

Total: **249 handlers en 32 controladores**. Evidencia: `validation/rbac-source-audit.json`.

## Matriz runtime crítica

| Endpoint | Método | Admin | Supervisor | Cashier | Waiter | Delivery | Sin auth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/users` | GET | Permitido | Según contrato | Denegado | Denegado | Denegado | 401 |
| `/cash-register/current` | GET | Permitido | Permitido | Permitido | Denegado | Denegado | 401 |
| `/sales` | GET | Permitido | Según contrato | Permitido | Denegado | Denegado | 401 |
| `/orders` | GET | Permitido | Permitido | Permitido | Según contrato | Según contrato | 401 |
| `/inventory/stock` | GET | Permitido | Permitido | Según permisos | Denegado | Denegado | 401 |
| `/purchases` | GET | Permitido | Según contrato | Denegado | Denegado | Denegado | 401 |
| `/reports/daily` | GET | Permitido | Permitido | Permitido | Denegado | Denegado | 401 |
| `/admin/sofia/dashboard/summary` | GET | Permitido | Permitido | Según contrato | Denegado | Denegado | 401 |
| `/admin/sofia/conversations/inbox` | GET | Permitido | Permitido | Según contrato | Denegado | Denegado | 401 |
| `/admin/sofia/whatsapp/qr/status` | GET | Permitido | Permitido | Según contrato | Denegado | Denegado | 401 |

La ejecución automatizada no confía en esta tabla manual: calcula y verifica **70 decisiones runtime**. La suite backend adicional cubre 54 escenarios RBAC y terminó PASS. Los valores `Según contrato` se comparan con el status esperado codificado por endpoint/rol, no se aceptan como comodín.

## Resultado

`RBAC MATRIX: GO` para la foundation: inventario fail-closed completo y rutas críticas probadas en runtime. Los E2E de mutaciones sensibles exhaustivas continúan en Phase 2.5.
