# Sofia Enterprise Production Readiness

Fecha: 2026-07-27  
HEAD observado: `c8a82998ef52`  
Decision: **GO CONDICIONADO para operacion supervisada; NO-GO para produccion**.

## 1. Resumen ejecutivo

Se implemento una base enterprise de Sofia con prompt persistido, catalogo real, DeepSeek text-only en dry-run, SafetyGuard, CRM acotado, pagos fail-closed, inbox con scopes honestos y consola desktop/mobile. La revision independiente identifico bloqueadores de QR, pagos y correlacion de ubicacion; fueron corregidos y validados de forma focalizada.

No se declara produccion lista. El working tree no representa un artifact limpio y permanecen PII legacy, actor de sistema, minimo privilegio WhatsApp, suite critica final y owner gates.

## 2. Loops ejecutados

| Loop | Diagnostico | Correccion | Validacion | Resultado |
| --- | --- | --- | --- | --- |
| Backend | Catalogo/config parcial, pagos y QR con gates incompletos | Catalogo persistido, prompt V2, payment/QR fail-closed | Unit/focused/typecheck/build | PASS focalizado |
| Seguridad | Location fallback, payload/PII y dedup temporal | Correlacion exacta, masking, IDs deterministas | Unit + PostgreSQL efimero | PASS focalizado |
| Frontend | Estados tecnicos y CRM inexistente | Consola supervisada y CRM read-only | Playwright desktop/mobile | PASS |
| Revision independiente | Runtime drift, legacy/PII y estados construidos | Bloqueadores inmediatos corregidos; deuda estructural documentada | Reauditoria de source | CONDICIONADO |

La correccion E2E uso tres iteraciones: error mecanico de insercion, PASS focalizado, fallo de harness por manifest de contenedor y PASS con manifest local explicito. No se ocultaron fallos.

## 3. Arquitectura implementada

| Capacidad | Fuente | Efectos permitidos | Estado |
| --- | --- | --- | --- |
| Prompt | `SOFIA_MASTER_PROMPT_V2` persistido | Generar contexto y reglas | GO interno |
| Catalogo | `Product` activo + precio persistido positivo | Consulta read-only | GO interno |
| DeepSeek | `deepseek-v4-flash`, dry-run | Candidato de texto, nunca envio | GO CONDICIONADO |
| SafetyGuard | Decision previa a acciones | Draft/human/block | GO interno |
| Audio | Transcripcion recibida | Analisis de texto | GO CONDICIONADO |
| Imagen | Sin vision | Handoff/solicitud de texto | GO honesto |
| CRM | Identidad HMAC, consent/tags/timeline | Consulta administrativa | GO CONDICIONADO |
| Campaigns | Endpoint protegido | Envio siempre bloqueado | GO seguro |
| Pagos | Consulta y webhook firmado | Manual review; seleccion bloqueada | GO seguro |
| WhatsApp QR | Baileys receive-only | Bootstrap solo con governance | GO seguro / fisico pendiente |

DeepSeek V4 Flash aparece en la documentacion oficial de modelos/precios y la documentacion actual describe DeepSeek V4 como modelo de texto. No se afirma capacidad visual. Fuentes: [pricing oficial](https://api-docs.deepseek.com/quick_start/pricing-details-usd/) y [integracion oficial](https://api-docs.deepseek.com/quick_start/agent_integrations/github_copilot/).

## 4. Contratos y endpoints

| Endpoint | Gate | Resultado |
| --- | --- | --- |
| `GET /admin/sofia/dashboard/summary` | JWT + roles | Estado backend sanitizado |
| `GET /admin/sofia/conversations/inbox` | JWT + roles | Real/interno/sandbox/historico separados |
| `GET /admin/sofia/whatsapp/qr/status` | JWT + admin/supervisor | QR raw ausente; estado honesto |
| `POST /admin/sofia/whatsapp/qr/connect` | Config + governance + pause + kill switch | Fail-closed |
| `GET /admin/sofia/runtime-safety` | JWT + roles | Declared/effective separados |
| `GET/POST /admin/sofia/crm/customers*` | JWT + admin/supervisor | Read-only operacional |
| `GET /admin/sofia/crm/customers/:id/timeline` | JWT + admin/supervisor | Timeline sanitizado |
| `GET /admin/sofia/crm/segments` | JWT + admin/supervisor | Agregados sin PII |
| `POST /admin/sofia/crm/campaigns/:id/send` | JWT + admin | Siempre bloqueado |
| `POST /public/sofia/payments/:token/select-method` | Throttle + productive gate | Bloqueado antes de DB cuando produccion OFF |

## 5. Limpieza y hardening

- Las configuraciones comerciales sin producto/precio ya no se presentan como vendibles.
- Las URLs multimedia no se persisten en mensajes Sofia.
- Las respuestas admin aplican sanitizacion recursiva.
- QR no puede arrancar solo por un flag de entorno.
- Ubicacion legacy no adivina una orden por cantidad o sufijo telefonico.
- Identificadores de transporte se enmascaran al persistir inbox de ubicacion.
- Logs de ubicacion no imprimen JID ni telefonos.
- Links y metodos de pago permanecen inactivos con produccion OFF.
- Fallbacks de ID de proveedor son deterministas, no temporales.
- Dashboard no afirma pagos, POS, Delivery o Checkout disponibles desde Sofia.

## 6. CRM

El modulo incluye perfil, identidades, consentimientos, tags, segmentos, timeline y detalle de cliente. La UI no ofrece envio, campañas, pedidos, pagos o mutaciones operativas. La identidad nueva usa HMAC y masking.

Pendiente obligatorio: migrar/cifrar la memoria legacy que conserva telefono normalizado y aprobar base juridica, retencion, eliminacion y acceso. `CRM_IDENTITY_HASH_SECRET` debe venir de secret store.

## 7. Validaciones

| Validacion | Resultado | Evidencia |
| --- | --- | --- |
| Prisma validate | PASS | Ejecucion local |
| API typecheck/build/lint | PASS | Ejecucion local |
| Web typecheck/build/lint | PASS | Ejecucion local |
| Sofia/WhatsApp focalizado | 13 suites / 49 tests PASS | `/tmp/sofia-enterprise-production-program` |
| Gate QR/payment safety | 4 suites / 20 tests PASS | Output de Jest |
| Ubicacion no correlacionada | 1/1 PASS, 91 skipped por filtro | PostgreSQL efimero aislado |
| Full critical | NO CERTIFICADA FINAL | R3 anterior 90/91; focal corregido PASS |
| Playwright | 2/2 PASS | `playwright-source.log` |
| Visual desktop | PASS inspeccionado | `screenshots/01-sofia-dashboard-desktop.png` |
| Security scan | 0 activaciones reales; 0 secret patterns | `security-scan-summary.txt` |
| `git diff --check` | PASS | Ejecucion local |

Los skips del escenario focalizado provienen de `--testNamePattern`; no se agregaron `test.skip` ni se redujeron assertions del spec.

## 8. Estado visual

La consola muestra QR deshabilitado/bloqueado, receive-only, IA no disponible o dry-run segun runtime, produccion bloqueada, cero metricas reales cuando no existen y validacion interna separada. Desktop y mobile cargan sin overflow ni errores de consola/servidor en los specs oficiales.

## 9. Archivos relevantes

| Area | Archivos |
| --- | --- |
| Backend Sofia | `apps/api/src/modules/sofia/**` |
| WhatsApp safety | `apps/api/src/modules/whatsapp/whatsapp.service.ts` |
| Location gate | `apps/api/src/modules/orders/orders.service.ts` |
| Prisma/CRM | `prisma/schema.prisma`, `prisma/migrations/2026072713*` |
| Frontend Sofia/CRM | `apps/web/src/app/(app)/sofia/**`, `apps/web/src/features/sofia/**` |
| E2E | `tests/e2e/ephemeral/operator-console.spec.ts`, `tests/e2e/ephemeral/mobile.spec.ts` |
| Fuente de verdad | `docs/sofia-current-state.md`, `.engineering/modules/*.md` |

## 10. Bloqueadores y owner gates

| Bloqueador | Owner | Accion | Produccion |
| --- | --- | --- | --- |
| Source dirty / artifact anterior | Engineering/release | Changeset limpio, artifact, canary y rollback | BLOQUEA |
| PII/memoria legacy | Security/privacy | Migracion/cifrado y retention policy | BLOQUEA |
| Actor automatico humano | Backend/audit | Actor de sistema persistente | BLOQUEA |
| WhatsApp legacy QR/sesion | Security/backend | Minimo privilegio y deprecacion controlada | BLOQUEA |
| Critical final | Testing | PASS completo sobre candidato | BLOQUEA |
| Secret store/rotacion | Owner/security | Custodia y aceptacion | BLOQUEA |
| QR/allowlist fisicos | Owner/operations | Validar mismo artifact, SENT=0 | BLOQUEA |
| Staging/CI/approvals | Owner/release | Gates remotos required | BLOQUEA |
| Consentimiento CRM | Legal/privacy | Politica y evidencia explicita | BLOQUEA |

## 11. Decision

**SOFIA IMPLEMENTATION: GO CONDICIONADO.**  
**SOFIA PRODUCTION READINESS: NO-GO.**

La consola supervisada y sus controles internos son funcionales para validacion aislada. No existe base tecnica ni de custodia suficiente para habilitar clientes reales. Produccion, envio real, Auto Reply, Auto Safe, PAID y QR fisico permanecen OFF.

No se hizo commit ni push. No se modifico produccion ni la DB operativa.
