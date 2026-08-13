# Sofia - Estado actual

Ultima actualizacion: 2026-08-12.

Este archivo es la fuente de verdad vigente para agentes. Los reportes historicos solo son evidencia de capacidad anterior y no certifican el runtime actual.

## Decision vigente

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
- `CRM_IDENTITY_HASH_SECRET` debe existir en un secret store aprobado; durante rotacion, una unica
  `CRM_IDENTITY_HASH_SECRET_PREVIOUS` permite reconocer replays historicos sin reescribir hashes.
- El almacenamiento legado de memoria/telefonos y su politica de retencion requieren aprobacion legal/security antes de activar Sofia con clientes.
- Consentimiento comercial explicito y canal outbound aprobado son requisitos previos a cualquier campaña.

## Gates de activacion pendientes

1. Aprobar retencion, consentimiento y tratamiento de PII con owner legal/security.
2. Completar secret store, rotacion y alert routing operativo.
3. Validar binding exacto de cuenta/sesion y ejecutar canary fisico receive-only.
4. Aprobar allowlist comercial y activacion gradual de inbound Sofia.
5. Autorizar separadamente Bold real, un destinatario de prueba, outbound WhatsApp y auto messaging.

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
