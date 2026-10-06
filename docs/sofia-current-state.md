# Sofia - Estado actual

Ultima actualizacion: 2026-10-06 (Fase 2 del programa "SOFIA operational reintegration").

Este archivo es la fuente de verdad vigente para agentes. Los reportes historicos solo son evidencia de capacidad anterior y no certifican el runtime actual.

## Estado demostrado en el candidato Fase 2 (2026-10-06)

Candidato: rama `fix/sofia-operational-reintegration-20261005`, HEAD
`5fc0fe75b2f6e39b087384fc4c4aa08f1045f060` (base `08fe398c456d8d5da9f98ddff7a5fbbc644c75ab`).
Imagenes probadas: `inventory-fastfood-api:0.1.0-5fc0fe75b2f6-1791253207` /
`inventory-fastfood-web:0.1.0-5fc0fe75b2f6-1791253207`, sin reconstruir, exactamente
las compiladas desde ese HEAD.

Todo lo siguiente fue verificado en un laboratorio de preproduccion NUEVO y aislado
(`sofia-phase2-preprod-20261006`: red/volumenes propios, Postgres sintetico en tmpfs,
HTTPS real via nginx con CA local efimera y perfil Chromium/Playwright con su propia
base NSS confiando en esa CA, sin `ignoreHTTPSErrors`), destruido por completo al
terminar (contenedores, red y secretos efimeros eliminados). No se toco
`inventario-api-1`/`inventario-web-1`/`inventario-postgres-1` ni ningun laboratorio
previo (`inventario-sofia-qr-canary-*`, `inventario-sofia-phase-a-review-*`): quedaron
`Up` sin reinicio antes y despues.

- UI: `/sofia`, `/sofia/performance`, `/sofia/validation`, `/sofia/conversations`,
  `/sofia/safety`, `/sofia/whatsapp-qr` cargan datos reales tipados desde el backend
  (verificado desde un navegador real; capturas y log de llamadas de red en el
  laboratorio efimero, no conservadas tras la destruccion salvo JSON sanitizado).
- CRM: `customers`, `pipeline`/`pipelines`, `segments`, `campaigns`, `tasks` y
  Customer 360 responden 200 con datos reales del backend (se creo un unico cliente
  sintetico via la API real de CRM para poder probar Customer 360; resto de colas
  legitimamente vacias, nunca fabricadas).
- Envio de campanas: permanece bloqueado de forma incondicional. Prueba real: crear
  campana -> intentar enviar (desde la UI y via API) -> respuesta
  `{"status":"BLOCKED","reason":"BAILEYS_PROACTIVE_OUTREACH_DISABLED","sent":false}`.
- Monitoreo de red del navegador durante toda la sesion (67 llamadas `/api/` reales
  observadas): ninguna mutacion de POS/Caja/Stock/Checkout/Pagos se origino desde la
  UI de SOFIA. Las unicas llamadas fuera de `/sofia/*` fueron lecturas (`GET`) de
  `cash-register/current`, `inventory/movements` y `reports/operational` que alimentan
  un widget compartido del shell de la app (no SOFIA), todas de solo lectura.
- SecureCommand/RBAC: `GET/POST /admin/secure-commands*` protegido por
  `@Roles('admin','supervisor')` + permisos; confirmado con credenciales sinteticas
  reales: admin -> 200, cashier -> 403, sin token -> 401. No existe ruta de creacion
  de comandos (solo listar/detalle/aprobar/rechazar).
- Governance/Runtime Safety: `control/pause-global`, `control/resume-global`,
  `control/kill-switch/activate`, `control/kill-switch/deactivate` ejercidos en el
  laboratorio aislado y revertidos al estado seguro documentado
  (`globalPaused:false`, `killSwitchActive:false`, `qrRealAllowed:false`,
  `deepSeekRealAllowed:false`, `autoSafeProductionAllowed:false`) antes de destruirlo.
- DeepSeek: credencial aprobada ya presente en configuracion protegida del host
  (`.env` del checkout de trabajo, permisos 600), habilitada solo para este
  laboratorio aislado con `SOFIA_AI_MODE=dry_run`. `admin/sofia/ai/status` real:
  `deepseekEnabled:true`, `deepseekConfigured:true`, `apiKeyExposed:false`,
  `backendOnly:true`. `admin/sofia/ai/health-check` real:
  `ok:true, message:"DeepSeek respondio correctamente al sondeo acotado."` (HTTP real
  a DeepSeek, no mock). Un caso de analisis dry-run end-to-end (mensaje -> sugerencia
  IA -> SafetyGuard) **no** se pudo ejercitar en esta imagen de produccion: las rutas
  `agent/process`, `sandbox/*` y `ai/test` estan protegidas por `SofiaTestOnlyGuard`,
  que exige `NODE_ENV=test` (deliberadamente no se activo, para no degradar el
  candidato bajo prueba) y la unica otra via de entrada real es un inbound WhatsApp
  autentico, bloqueado por el punto de corte fisico descrito abajo. SafetyGuard sigue
  siendo arquitectonicamente la autoridad final: ninguna ruta de sugerencia de IA
  aplica una accion sin pasar por el, y las rutas que la bypasean para pruebas estan
  deshabilitadas en modo produccion.
- WhatsApp QR receive-only: arranque del contenedor en modo `WHATSAPP_QR_ENABLED=true`
  sin `WHATSAPP_EXPECTED_ACCOUNT_ID/BUSINESS_IDENTITY/SESSION_OWNER` fue rechazado al
  boot con `SOFIA_PROD_WHATSAPP_ACCOUNT_BINDING_REQUIRED` (invariante permanente
  confirmado activo). Con bindings sinteticos de laboratorio (no un numero/`@lid`
  real) y `WHATSAPP_QR_ALLOW_RECEIVE=true`, `WHATSAPP_QR_SANDBOX_ONLY=false`,
  `WHATSAPP_MODE=receive_only`, `WHATSAPP_QR_ALLOW_REAL_SEND=false`,
  `SOFIA_AUTO_REPLY_ENABLED=false`, `SOFIA_AUTO_SAFE_ENABLED=false`: el endpoint de
  estado respondio `status:"DISABLED"`, `reason:"QR_GOVERNANCE_NOT_APPROVED"`, y el
  intento explicito de aprobar `qrRealAllowed:true` via
  `POST admin/sofia/governance/settings` fue rechazado con
  `{"status":"BLOCKED","reason":"PHASE_NOT_READY"}` porque el gate exige que
  `WHATSAPP_EXPECTED_ACCOUNT_ID` tenga formato de numero real y
  `WHATSAPP_EXPECTED_BUSINESS_IDENTITY` tenga formato `@lid` (identidad que solo se
  observa tras una conexion fisica real previa). **Punto de corte**: generar un QR
  real escaneable requiere que el owner fisico conecte primero una cuenta de WhatsApp
  Business real para obtener su `@lid`, configure ese binding exacto, y solo entonces
  el gate de gobernanza puede aprobarse. No se fabrico ni se simulo ese binding.
  `whatsappOutbound`, `boldMutation` y `orderExecution` se mantuvieron
  `DISABLED_BY_POLICY` durante toda la prueba.

Matriz de capacidades (estado real demostrado, no inferido, al cierre de Fase 2):

| Capacidad | Estado |
| --- | --- |
| UI SOFIA (overview/performance/validation/conversations/safety/whatsapp-qr) | GO (datos reales) |
| CRM (customers/pipeline/segments/campaigns/tasks/360) | GO (datos reales) |
| SecureCommand (listar/detalle/aprobar/rechazar, sin creacion) | GO (RBAC confirmado) |
| Gobernanza (pause/resume/kill-switch) | GO (ejercido y revertido) |
| Safety/Runtime Safety | GO (estado real, sin gates debilitados) |
| DeepSeek dry-run (conectividad/health) | GO (HTTP real, sin mock) |
| DeepSeek dry-run (caso conversacional end-to-end) | BLOCKED (ver nota arriba) |
| QR receive-only (arquitectura y guards) | GO (bindings/guard enforcement reales) |
| QR receive-only (conexion real/CONNECTED) | BLOCKED_PHYSICAL_OWNER_ACTION_REQUIRED |
| Envio real WhatsApp | OFF (bloqueado, confirmado) |
| Auto Reply | OFF (confirmado) |
| Auto Safe productivo | OFF (confirmado) |
| Produccion | NO activada (fuera de alcance de esta fase) |

## Decision vigente (HISTORICO / OBSOLETO respecto al candidato Fase 2 de arriba)

La seccion siguiente describe el estado de un release anterior
(`291d541f408d14b3c9b66942583dc6a8c7522bcb`, 2026-08-12) y se conserva como evidencia
forense. No certifica el runtime del candidato `5fc0fe75` descrito arriba, que
restaura la Torre de Control SOFIA y el CRM sobre ese mismo main seguro.

**El core backend de Phases 3 a 7 esta desplegado en produccion. Las capacidades operativas Sofia, Bold real y WhatsApp automatico permanecen desactivadas y requieren activacion controlada separada.**

El release candidate `291d541f408d14b3c9b66942583dc6a8c7522bcb` paso CI completa en el run `31643203916` y se publico, firmo, atesto y escaneo en GHCR mediante el run `31645550036`. Produccion ejecuta exactamente los digests API `sha256:e32088d15bc8ed385fb4942315e60dff94aa1dd0c5a07ca195a33dccf0a0e62d` y Web `sha256:59445f98eec492c99e5ecdf3065a3c901fef0d736e8b85e6844e4ba3a7b841ac`. La base productiva fue migrada secuencialmente de 33 a 37 y quedo saludable en 37/37. Real Bold, creacion de pedidos/pagos/cocina, envio WhatsApp, inbound QR y auto reply permanecen desactivados.

## Controles verificados del runtime

Estos controles fueron verificados despues del despliegue por identidad de
imagen, health/readiness, smoke no financiero y reconciliacion de filas.

| Control | Estado | Fuente |
| --- | --- | --- |
| Modo Sofia | Supervisado | Runtime safety backend |
| WhatsApp | QR e inbound desactivados hasta binding controlado | Runtime config fail-closed |
| Envio real | Bloqueado | Runtime safety y adaptadores |
| Auto reply | OFF | Runtime safety |
| Auto Safe productivo | OFF | Runtime safety |
| Core productivo | Desplegado | Digests GHCR + readiness 37/37 |
| PAID desde WhatsApp | Imposible | SafetyGuard/payment webhook |
| Pagos publicos | Seleccion bloqueada | `PRODUCTIVE_ACTION` gate |
| DeepSeek | Dry-run de texto | Provider backend |
| Imagen | Sin vision; requiere texto o humano | Fallback multimedia |
| Audio | Solo usa transcripcion disponible | Fallback multimedia |
| Catalogo | Producto persistido y precio positivo | Catalog service |
| Sandbox | Separado y oculto por defecto | Source/scope backend |
| Phase 3 outbound | Implementado pero deshabilitado | Secure command + runtime gate |
| Migraciones | 37/37 productivo | 33->34->35->36->37 secuencial PASS |
| Artefactos | API/Web por digest | GHCR firmado, SBOM/SLSA y 0 HIGH/CRITICAL |
| Phase 7 | Runtime `291d541`; CI `31643203916` PASS | Sin migration 38 |

## Capacidades implementadas

- Prompt canonico persistido `SOFIA_MASTER_PROMPT_V2` con reglas de no invencion, escalamiento y proteccion comercial.
- DeepSeek V4 Flash integrado exclusivamente como candidato de texto en dry-run; SafetyGuard conserva la decision final y `sent=false`.
- Catalogo comercial conectado a `Product`: una configuracion sin producto activo o sin precio positivo se marca `CONFIGURATION_ONLY` y no se ofrece.
- Multimedia honesta: audio sin transcripcion e imagen sin texto no se interpretan; requieren confirmacion escrita o revision humana.
- Inbox sanitizado con scopes `real`, `internal_validation`, `sandbox` e `historical` sin sumar pruebas como operacion real.
- CRM acotado con identidad HMAC, telefono enmascarado, perfil, consentimientos, etiquetas, segmentos y timeline; campañas y envios permanecen bloqueados.
- Provider Bold y webhook firmado disponibles para integracion controlada; una aprobacion externa queda en `MANUAL_REVIEW` y nunca marca PAID.
- Ubicacion WhatsApp logistics-only exige correlacion exacta. Sin identidad confiable queda en revision manual y no toca pricing.
- QR Baileys solo puede iniciar con configuracion habilitada, `qrRealAllowed=true`, pause OFF y kill switch OFF.
- Respuestas administrativas sanitizan secretos, telefonos, direcciones, QR raw y payloads de proveedor.
- El candidato Phase 3 normaliza eventos, reclama inbound de forma atomica, separa estados de la IA y centraliza consentimiento y handoff versionado.
- El candidato Phase 3 agrega estado de entrega append-only, politica de medios metadata-only y binding de cuenta/sesion sin persistir credenciales.
- `SOFIA_SEND_WHATSAPP` usa el nucleo de comandos seguros, pero su definicion y validacion de runtime mantienen la ejecucion deshabilitada.
- Phase 4 agrega estado comercial versionado, catalogo/precio/disponibilidad de dominio, delivery/takeaway, preferencia de pago sin mutacion y confirmacion exacta de borrador.
- Los borradores historicos sin hash, expiracion, fulfillment y pago vinculados son no confirmables hasta ser refrescados.

## Validacion actual

| Capa | Resultado | Limite |
| --- | --- | --- |
| Prisma validate | PASS | Schema candidato local |
| API/Web typecheck, build y lint | PASS | Runtime source `291d541` |
| Phase 6 CI | PASS y fusionada | PR #11 |
| Phase 6 focalizada | 219/219 PASS | PostgreSQL aislado |
| Phase 7 focalizada | 253/253 PASS dos veces; CI remoto PASS | PR #12, run `31316328069` |
| Release candidate final | PASS | CI `31643203916`, SHA `291d541` |
| Concurrency/fault/load | 41/41 PASS | PostgreSQL aislado |
| Checkout/payment Phase 5 | 15/15 PASS | PostgreSQL aislado |
| Suite critica/RBAC | 92/92 PASS | PostgreSQL aislado |
| Migraciones | Fresh, restore 33->37 y produccion 37/37 PASS | Sin migration incompleta o rollback |
| Seguridad | Audit y secret scan PASS; critical/high abiertos 0 | Secretos fuera del repositorio |
| Runtime productivo | API/Web healthy; readiness 37/37 | SHA `291d541`, digests GHCR exactos |
| Reconciliacion | PASS | Ventas, pagos, caja, stock, tickets y webhooks preservados |
| Efectos inesperados | 0 | Sin checkout, intent, link ni transition creados |

## Datos reales, sandbox e historico

- `MOCK_ADMIN` y provider/mode mock siempre son sandbox.
- Conversaciones archivadas son historicas.
- La validacion interna no suma como operacion comercial.
- Con operacion real deshabilitada, la vista principal muestra cero conversaciones comerciales reales.
- No se inventan metricas cuando la fuente no existe.

## CRM y privacidad

- La UI CRM es de consulta; no crea campañas, mensajes, pagos, pedidos ni efectos operativos.
- La identidad principal nueva se deriva con HMAC y se muestra enmascarada.
- `CRM_IDENTITY_HASH_SECRET` debe existir en un secret store aprobado. La clave singular
  `CRM_IDENTITY_HASH_SECRET_PREVIOUS` conserva compatibilidad con la rotacion anterior y
  `CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS` retiene generaciones mas antiguas, de nueva a vieja,
  separadas por coma. Todas las claves deben ser distintas y permanecer disponibles mientras
  existan referencias historicas generadas con ellas.
- El almacenamiento legado de memoria/telefonos y su politica de retencion requieren aprobacion legal/security antes de activar Sofia con clientes.
- Consentimiento comercial explicito y canal outbound aprobado son requisitos previos a cualquier campaña.

## Gates de activacion pendientes

1. Aprobar retencion, consentimiento y tratamiento de PII con owner legal/security.
2. Completar secret store, rotacion y alert routing operativo.
3. Validar binding exacto de cuenta/sesion y ejecutar canary fisico receive-only.
4. Aprobar allowlist comercial y activacion gradual de inbound Sofia.
5. Autorizar separadamente Bold real, un destinatario de prueba, outbound WhatsApp y auto messaging.

### Evidencia parcial del gate 3 (2026-08-17)

El binding exacto de cuenta/sesion y una conexion Baileys real (`CONNECTED`) fueron
validados el 2026-08-17, pero en un entorno Docker aislado local y ad-hoc, **no** en
el pipeline formal de canary del proyecto ni en ningun entorno compartido. Envio
real, auto-reply y auto-safe permanecieron en `false` durante toda la validacion;
un mensaje real de un numero fuera del allowlist llego y fue bloqueado correctamente
(`ALLOWLIST_REQUIRED`), demostrando que el pipeline receive-only funciona de punta a
punta. Detalle completo y campos verificados en
`.engineering/sofia-production/evidence/2026-08-17-receive-only-canary-reconciliation/evidence-report.md`.
Esto es evidencia tecnica de que el mecanismo funciona, no una certificacion de que
el gate 3 esta completo para el programa formal — esa decision queda para el owner.

## Owner gates

- Security/privacy owner, base juridica CRM y retencion de PII.
- Secret rotation/acceptance, secret store y alert routing productivo.
- QR fisico, cuenta/sesion real y allowlist comercial final.
- Credenciales/activacion Bold real y automatic customer messaging autorizados por separado.

## Regla Maxy Family

Composicion autorizada:

```text
6 burgers + 1 porcion personal de papitas + 1 Pepsi 1.5 L
```

Upsell permitido:

```text
Si quieres que todos acompanen con papitas, puedes agregar porciones adicionales.
```

No afirmar papas grandes, familiares o para todos como parte incluida.

## Regla de interpretacion

Una evidencia fisica historica de QR o DeepSeek no sustituye una validacion sobre el artifact actual. Si otro documento contradice este archivo, prevalece este estado y debe investigarse la discrepancia.
