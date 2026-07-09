# SOFIA MAIN DASHBOARD REAL DATA CONNECTION - Reporte final

## 1. Resumen ejecutivo

La pagina principal `/sofia` fue desconectada de metricas mezcladas y copy que podia interpretarse como operacion real. Ahora consume una unica fuente backend sanitizada:

```text
GET /admin/sofia/dashboard/summary
```

El dashboard separa explicitamente:

- Operacion real.
- Validacion interna.
- Pendientes/bloqueos.

No se activaron funciones reales. Produccion, envio WhatsApp, auto reply y Auto Safe productivo siguen bloqueados.

Decision: `GO`.

## 2. Endpoints usados

| Endpoint | Uso | Estado |
| --- | --- | --- |
| `GET /admin/sofia/dashboard/summary` | Fuente principal unica para `/sofia` | CREADO / PASS |
| `GET /admin/sofia/enterprise-status` | Fuente interna reutilizada por backend summary | EXISTENTE |
| QR Gateway service status | Fuente interna backend para adapter, QR, connected y receive-only | EXISTENTE |
| AI provider factory status | Fuente interna backend para DeepSeek provider/mode/dry-run | EXISTENTE |

## 3. Endpoints creados

| Endpoint creado | Archivo | Evidencia |
| --- | --- | --- |
| `GET /admin/sofia/dashboard/summary` | `apps/api/src/modules/sofia/sofia.controller.ts` | Controller agregado |
| `getDashboardSummary()` | `apps/api/src/modules/sofia/governance/sofia-governance.service.ts` | Summary sanitizado y separado por scope |

## 4. Datos reales conectados

| Elemento visible | Fuente backend | Estado | Evidencia |
| --- | --- | --- | --- |
| Estado general | `dashboard/summary.general` | Real backend | `dashboard-summary-sanitized.json` |
| WhatsApp QR | `dashboard/summary.whatsappQr` | Real backend QR Gateway | `provider=qr_gateway`, `mode=receive_only` |
| DeepSeek/IA | `dashboard/summary.ai` | Real backend AI provider | `provider=deepseek`, `mode=dry_run` |
| SafetyGuard real | `dashboard/summary.safetyGuard.real` | Real separado, actualmente cero si operacion comercial no habilitada | `realOperationEnabled=false` |
| Conversaciones reales | `dashboard/summary.conversations.realConversations` | Real separado, no mezcla sandbox | `realOperationReason=ALLOWLIST_FINAL_PENDING` |
| Validacion interna | `dashboard/summary.internalValidation` | Separada de operacion real | Seccion propia en UI |
| Seguridad/readiness | `dashboard/summary.security` | Real backend governance/readiness | Produccion bloqueada |

## 5. Datos eliminados por mock/hardcoded/sandbox

| Dato eliminado | Motivo | Accion |
| --- | --- | --- |
| Consumo directo de `metrics/summary` en `/sofia` | Podia mezclar sandbox/historico con operacion real | Reemplazado por `dashboard/summary` |
| Consumo directo de `learning/insights` en vista principal | Es validacion interna, no operacion real | Retirado de `/sofia` principal |
| Consumo directo de `alerts` como KPI principal | No era parte minima del dashboard real-data | Retirado de vista principal |
| Constantes `MAXI_COPY` y `FORBIDDEN` en `/sofia` | Regla/politica hardcoded podia parecer data viva | Retiradas de dashboard principal |
| Timeline historico en vista principal | Puede mezclar auditoria/sandbox como operacion | Retirado de seccion principal |
| Operations PASS hardcoded | POS/Domicilios/Checkout se mostraban como PASS sin fuente real especifica del dashboard | Reemplazado por mensaje de separacion operativa |

## 6. Datos pendientes

| Dato pendiente | Motivo | Accion futura |
| --- | --- | --- |
| Allowlist comercial final | Pendiente por fase posterior | Validar numero final sin exponerlo |
| Inbound real comercial allowlist | Aun no debe contarse como operacion real | Probar despues de allowlist final |
| Envio real interno | Diferido y bloqueado | Ejecutar solo en fase explicita |
| Kill-switch real de piloto con envio | No aplica mientras real send esta OFF | Probar antes de cualquier envio real |
| Last AI health check dedicado | El summary usa ultima decision disponible si existe | Agregar evento health-check si se requiere trazabilidad granular |

## 7. Que muestra ahora `/sofia`

- Hero operativo con badges desde backend.
- Produccion bloqueada y razon de scope.
- Cards principales: WhatsApp QR, IA, envio real, produccion.
- Seccion `Operacion real` con conteos reales separados.
- Seccion `Validacion interna` con sandbox/test-inbound separado.
- Estado general, SafetyGuard y seguridad/readiness.
- Pendientes/bloqueos.
- Navegacion a QR, Conversations, Sandbox y POS.
- Detalle tecnico con endpoint principal, politicas de datos y estado QR/IA.

## 8. Que no muestra porque no hay fuente real

- No inventa inbound comercial si allowlist final esta pendiente.
- No suma sandbox como operacion.
- No muestra PAID real desde WhatsApp.
- No muestra envio real activo.
- No muestra produccion lista.
- No muestra QR raw, token, secreto, telefono completo ni payload crudo.

## 9. Seguridad

| Seguridad | Resultado | Evidencia |
| --- | --- | --- |
| No real activation | 0 hallazgos | `/tmp/sofia-main-dashboard-real-data/no-real-activation-check.log` |
| Secret check | 19 falsos positivos conocidos por nombres `qrString`/redaccion/reportes previos; sin secreto real, sin `data:image`, sin QR raw nuevo | `/tmp/sofia-main-dashboard-real-data/secret-check.log` |
| Summary sanitizado | `noSecrets=true`, `noPii=true`, `noQrRaw=true` | `/tmp/sofia-main-dashboard-real-data/dashboard-summary-shape.log` |
| Auth endpoint | Endpoint admin requiere sesion/token | Validado via Playwright request autenticado |

## 10. Build/typecheck

| Build/typecheck | Resultado | Evidencia |
| --- | --- | --- |
| Web typecheck | PASS | `/tmp/sofia-main-dashboard-real-data/web-typecheck.log` |
| Web build | PASS con warnings ESLint preexistentes no bloqueantes | `/tmp/sofia-main-dashboard-real-data/web-build.log` |
| API typecheck | PASS | `/tmp/sofia-main-dashboard-real-data/api-typecheck.log` |
| API build | PASS | `/tmp/sofia-main-dashboard-real-data/api-build.log` |
| Docker build API/Web | PASS | `/tmp/sofia-main-dashboard-real-data/docker-build-api-web.log` |
| Health after deploy | PASS | `/tmp/sofia-main-dashboard-real-data/health-after.log` |

## 11. Screenshots

| Screenshot | Estado |
| --- | --- |
| `/tmp/sofia-main-dashboard-real-data/screenshots/01-sofia-main-real-data-dashboard.png` | Generado |

## 12. Decision

`SOFIA MAIN DASHBOARD REAL DATA CONNECTION: GO`

Condiciones verificadas:

- `/sofia` consume datos reales desde backend consolidado.
- No muestra mocks como reales.
- No mezcla sandbox con operacion real.
- No inventa metricas.
- Estados coherentes: DeepSeek dry-run, produccion bloqueada, envio real bloqueado.
- Build/typecheck PASS.
- Sin secretos reales expuestos.
- Sin activacion real.
- POS/Caja/Stock/Checkout no tocados.
