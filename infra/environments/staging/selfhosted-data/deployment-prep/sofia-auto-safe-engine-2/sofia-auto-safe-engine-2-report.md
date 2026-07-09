# SOFIA-AUTO-SAFE-ENGINE-2 — Reporte final

## 1. Resumen ejecutivo

Se implementó un Auto Safe Engine explícito para Sofía en modo sandbox/dry-run. El motor evalúa respuestas candidatas después de `SofiaAgentService` y `SofiaSafetyGuard`, registra evidencia auditable y devuelve una decisión estructurada: `AUTO_SAFE_APPROVED`, `HUMAN_REQUIRED`, `BLOCKED` o `DRAFT_ONLY`.

No se conectó QR real, no se activó DeepSeek real, no se enviaron mensajes reales de WhatsApp y no se modificaron flujos operativos de POS, Domicilios, Pagos, Caja, Stock ni Checkout.

## 2. Estado recibido

- `SOFIA-MASTER-ARCHITECTURE-AUDIT-0`: GO.
- `SOFIA-SECURITY-SECRETS-SANITIZATION-0`: GO CONDICIONADO por rotación externa pendiente.
- `SOFIA-COMMERCIAL-BRAIN-PROMPT-CATALOG-MEMORY-1`: GO.

## 3. Alcance real de F2

- Se creó una capa explícita de decisión Auto Safe.
- Se creó matriz declarativa de políticas.
- Se agregó auditoría persistente de decisiones.
- Se integró el resultado con sandbox comercial y respuesta estructurada de Sofía.
- Se agregó endpoint admin/sandbox protegido para evaluación.
- Se agregó visualización mínima en `/sofia/sandbox`.

## 4. Qué se creó

- `apps/api/src/modules/sofia/auto-safe/sofia-auto-safe.types.ts`
- `apps/api/src/modules/sofia/auto-safe/sofia-auto-safe.constants.ts`
- `apps/api/src/modules/sofia/auto-safe/sofia-auto-safe-policy.ts`
- `apps/api/src/modules/sofia/auto-safe/sofia-auto-safe-engine.service.ts`
- `apps/api/src/modules/sofia/auto-safe/sofia-auto-safe.module.ts`
- `prisma/migrations/20260701190000_sofia_auto_safe_engine/migration.sql`
- `tests/e2e/sofia-auto-safe-engine-2.spec.ts`

## 5. Qué se modificó

- `prisma/schema.prisma`: modelo `SofiaAutoSafeDecisionEvent`.
- `apps/api/src/modules/sofia/sofia-agent.service.ts`: evaluación Auto Safe posterior a SafetyGuard.
- `apps/api/src/modules/sofia/sofia.controller.ts`: endpoint `/admin/sofia/sandbox/auto-safe-evaluate`.
- `apps/api/src/modules/sofia/dto/sofia.dto.ts`: DTO de evaluación sandbox.
- `apps/api/src/modules/sofia/sofia.module.ts`: módulo Auto Safe.
- `apps/api/src/modules/sofia/sofia-whatsapp.service.ts`: fallback seguro para audio sin transcript con decisión Auto Safe.
- `apps/web/src/app/(app)/sofia/sandbox/page.tsx`: panel mínimo de decisión Auto Safe.
- `apps/api/src/tests/app.critical.spec.ts`: cobertura crítica Auto Safe.
- `apps/api/src/tests/helpers/test-data.ts`: limpieza de tabla de auditoría en tests.

## 6. Qué no se tocó

No se modificó lógica funcional de POS, Domicilios, Caja, Stock, Checkout, pagos manuales ni pagos online. No se habilitó QR real, DeepSeek real ni envío real de WhatsApp.

## 7. Modelo de decisión Auto Safe

El input canónico incluye mensaje, respuesta candidata, intención, confianza, productos/catálogo, memoria, estado de conversación, SafetyGuard, modo de canal, flags de sandbox, QR/DeepSeek y rotación de secretos.

El output incluye decisión, riesgo, `approved`, `shouldSend`, `shouldCreateOutbox`, `shouldRequireHuman`, reason codes, bloqueos, warnings, respuesta final y auditoría.

## 8. Matriz de políticas

La matriz vive en `sofia-auto-safe-policy.ts` y documenta condiciones, severidad, decisión y reason code. Cubre deshabilitado, secretos pendientes, QR/DeepSeek no listo, humano tomado, pausa, SafetyGuard, baja confianza, producto/precio desconocido, promoción inventada, Maxi Family, pago sensible, quejas y reglas de aprobación.

## 9. Servicio Auto Safe Engine

`SofiaAutoSafeEngineService.evaluate()` aplica reglas conservadoras. En sandbox puede aprobar como simulación, pero no envía WhatsApp real. En runtime no sandbox bloquea si hay rotación pendiente o QR no listo.

## 10. Evento persistente/auditoría

Se agregó `SofiaAutoSafeDecisionEvent` con resumen de input/output, reason codes, nivel de riesgo, estado, preview de respuesta y marca `isSandbox`. No guarda secretos, tokens ni payloads completos.

## 11. Integración con SofiaAgentService

`SofiaAgentService` ahora genera respuesta candidata, aplica SafetyGuard y luego evalúa Auto Safe. La respuesta sandbox incluye `autoSafeDecision` con evidencia para futuras fases.

## 12. Integración con SafetyGuard

SafetyGuard sigue siendo gate obligatorio. Si SafetyGuard bloquea, Auto Safe devuelve `BLOCKED` o `HUMAN_REQUIRED` según severidad.

## 13. Sandbox Auto Safe

`/sofia/sandbox` muestra badge de decisión, reason codes, warnings, final reply y confirmación de “No WhatsApp real enviado”.

## 14. Endpoint admin/sandbox

`POST /admin/sofia/sandbox/auto-safe-evaluate` permite evaluar mensajes/respuestas candidatas con simulación de estado, confianza, modo, rotación pendiente, QR y DeepSeek sin canal real.

## 15. Tests unitarios

La cobertura crítica API valida `AUTO_SAFE_APPROVED`, `HUMAN_REQUIRED`, `BLOCKED`, `DRAFT_ONLY`, rotación pendiente, conversación tomada, pausa, baja confianza, producto inexistente, precio desconocido, promoción inventada, Maxi Family incorrecto, PAID bloqueado, Nequi seguro y quejas.

## 16. Tests de integración

La suite `app.critical.spec.ts` integra endpoint, Prisma, `SofiaAgentService`, SafetyGuard y persistencia `SofiaAutoSafeDecisionEvent`.

## 17. E2E sandbox

`tests/e2e/sofia-auto-safe-engine-2.spec.ts` valida endpoint sandbox, decisión aprobada, Maxi Family bloqueado si incorrecto, PAID bloqueado, queja a humano, producto inexistente y panel visual en `/sofia/sandbox`.

## 18. Evidencia Maxi Family

Auto Safe aprueba la composición correcta:

`6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L`

Y bloquea copy incompleto o términos prohibidos como regla técnica de SafetyGuard/AutoSafe.

## 19. Evidencia pago sensible

`Pago confirmado` / `ya quedó pagado` queda bloqueado con `PAID_CLAIM_BLOCKED`. Una explicación segura de Nequi sin marcar PAID puede aprobarse en sandbox.

## 20. Evidencia queja/reclamo

Mensajes como “me llegó mal el pedido” pasan a `HUMAN_REQUIRED` con `CUSTOMER_COMPLAINT`.

## 21. Evidencia producto inexistente

“quiero sushi galáctico” no crea producto ni pedido, no inventa catálogo y devuelve `HUMAN_REQUIRED` con `UNKNOWN_PRODUCT`.

## 22. Evidencia no QR real

`qrReady=false` por defecto en sandbox y no se conectó gateway real. El grep de activación solo encontró `WHATSAPP_PROVIDER=qr_gateway` en `.env.example` como ejemplo futuro seguro.

## 23. Evidencia no DeepSeek real

`deepSeekReady=false` por defecto en Auto Safe sandbox. No se activó `DEEPSEEK_ENABLED=true` ni se agregó API key.

## 24. Evidencia no WhatsApp real

Todos los flujos reportan `noWhatsappReal: true` o warning `SANDBOX_ONLY`. `shouldSend=false` en sandbox incluso cuando `approved=true`.

## 25. Evidencia POS/Domicilios/Pagos/Caja/Stock/Checkout intactos

Tests API verifican que Auto Safe no cambia stock, movimientos de caja ni ventas. E2E checkout/caja pasó sin regresión.

## 26. Logs de build/typecheck/tests

- API typecheck: `/tmp/sofia-auto-safe-engine-2/api-typecheck.log`
- Web typecheck: `/tmp/sofia-auto-safe-engine-2/web-typecheck.log`
- API build: `/tmp/sofia-auto-safe-engine-2/api-build.log`
- Web build: `/tmp/sofia-auto-safe-engine-2/web-build.log`
- API tests: `/tmp/sofia-auto-safe-engine-2/tests.log`
- API exit code: `/tmp/sofia-auto-safe-engine-2/api-test-exit-code.log`
- E2E Auto Safe: `/tmp/sofia-auto-safe-engine-2/e2e.log`
- E2E comercial: `/tmp/sofia-auto-safe-engine-2/e2e-commercial-brain.log`
- E2E checkout/caja: `/tmp/sofia-auto-safe-engine-2/e2e-checkout-cash.log`
- Health: `/tmp/sofia-auto-safe-engine-2/health-after.log`

## 27. Riesgos residuales

- La rotación externa de secretos sigue pendiente antes de activar QR/DeepSeek/auto real.
- La visualización enterprise completa del panel queda para una fase posterior.
- `shouldSend=true` solo debe habilitarse en fases posteriores con QR listo, rotación cerrada y canal real probado.

## 28. Próxima fase recomendada

F3: panel enterprise `/sofia` con readiness, kill-switch, QR status, métricas Auto Safe, memoria, prompt activo, catálogo y auditoría, sin activar clientes reales hasta cerrar rotación externa.

## 29. Decisión final

`SOFIA-AUTO-SAFE-ENGINE-2: GO`

## Tabla 1: Componente | Resultado | Evidencia | Estado

| Componente | Resultado | Evidencia | Estado |
|---|---|---|---|
| Tipos Auto Safe | Decisiones, riesgos y reason codes canónicos | `sofia-auto-safe.types.ts` | PASS |
| Matriz de política | Reglas declarativas testeables | `sofia-auto-safe-policy.ts` | PASS |
| Servicio Auto Safe | Evalúa y persiste decisiones | `sofia-auto-safe-engine.service.ts` | PASS |
| Auditoría persistente | Modelo `SofiaAutoSafeDecisionEvent` | migración `20260701190000_sofia_auto_safe_engine` | PASS |
| Endpoint sandbox | `/admin/sofia/sandbox/auto-safe-evaluate` | E2E/API PASS | PASS |
| UI sandbox | Panel con badge, reasons y no WhatsApp real | `/sofia/sandbox` | PASS |

## Tabla 2: Caso Auto Safe | Decisión esperada | Resultado | Evidencia

| Caso Auto Safe | Decisión esperada | Resultado | Evidencia |
|---|---|---|---|
| Auto Safe disabled | `DRAFT_ONLY` | `DRAFT_ONLY` | API critical |
| Sandbox seguro Maxi Family | `AUTO_SAFE_APPROVED` sin envío | `AUTO_SAFE_APPROVED`, `shouldSend=false` | API/E2E |
| Secret rotation pendiente no sandbox | `BLOCKED` | `BLOCKED` | API critical |
| Conversación tomada | `HUMAN_REQUIRED` | `HUMAN_REQUIRED` | API critical |
| Sofía pausada | `HUMAN_REQUIRED` | `HUMAN_REQUIRED` | API critical |
| Baja confianza | `HUMAN_REQUIRED` | `HUMAN_REQUIRED` | API critical |
| Producto inexistente | `HUMAN_REQUIRED` | `HUMAN_REQUIRED` | API/E2E |
| Precio desconocido | `HUMAN_REQUIRED` | `HUMAN_REQUIRED` | API critical |
| Promo inventada | `BLOCKED` | `BLOCKED` | API critical |
| PAID desde IA/WhatsApp | `BLOCKED` | `BLOCKED` | API/E2E |
| Queja/reclamo | `HUMAN_REQUIRED` | `HUMAN_REQUIRED` | API/E2E |

## Tabla 3: Regla crítica | Validación | Resultado | Evidencia

| Regla crítica | Validación | Resultado | Evidencia |
|---|---|---|---|
| Maxi Family correcto | Requiere composición exacta | PASS | API/E2E |
| Frases prohibidas | Solo en blocklists/tests/panel técnico | PASS | `maxi-family-prohibited-phrases-check.log` |
| Pago no marca PAID | Claims de pago confirmado bloqueados | PASS | API/E2E |
| Nequi seguro | Explicación sin PAID puede aprobar | PASS | API critical |
| Producto no reconocido | No inventa y escala | PASS | API/E2E |
| Sandbox only | `shouldSend=false` | PASS | API/E2E |

## Tabla 4: Gate | Resultado | Evidencia

| Gate | Resultado | Evidencia |
|---|---|---|
| API typecheck | PASS | `/tmp/sofia-auto-safe-engine-2/api-typecheck.log` |
| Web typecheck | PASS | `/tmp/sofia-auto-safe-engine-2/web-typecheck.log` |
| API build | PASS | `/tmp/sofia-auto-safe-engine-2/api-build.log` |
| Web build | PASS | `/tmp/sofia-auto-safe-engine-2/web-build.log` |
| API tests | PASS, 12 suites, 221 tests, exit code 0 | `/tmp/sofia-auto-safe-engine-2/tests.log` |
| E2E Auto Safe | PASS, 2 tests | `/tmp/sofia-auto-safe-engine-2/e2e.log` |
| E2E comercial | PASS, 2 tests | `/tmp/sofia-auto-safe-engine-2/e2e-commercial-brain.log` |
| E2E checkout/caja | PASS, 2 tests | `/tmp/sofia-auto-safe-engine-2/e2e-checkout-cash.log` |
| Health | PASS | `/tmp/sofia-auto-safe-engine-2/health-after.log` |
| `test.skip` | vacío | `/tmp/sofia-auto-safe-engine-2/test-skip-check.log` |
| `process.exit(0)` | vacío | `/tmp/sofia-auto-safe-engine-2/process-exit-check.log` |
| Secret regression | vacío | `/tmp/sofia-auto-safe-engine-2/secret-regression-check.log` |

## Tabla 5: Qué no se tocó | Estado | Evidencia

| Qué no se tocó | Estado | Evidencia |
|---|---|---|
| QR real | No conectado | `qrReady=false`, no runtime QR |
| DeepSeek real | No activado | `deepSeekReady=false`, sin API key |
| WhatsApp real | No enviado | `noWhatsappReal=true`, `shouldSend=false` sandbox |
| POS/Domicilios | Intactos | Sin cambios funcionales, E2E regresión PASS |
| Pagos | Intactos | No se cambió payment status |
| Caja/Stock/Checkout | Intactos | API critical + E2E checkout/caja PASS |
