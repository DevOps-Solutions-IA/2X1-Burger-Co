# Sofia - Estado actual

Ultima actualizacion: 2026-08-08.

Este archivo es la fuente de verdad vigente para agentes. Los reportes historicos solo son evidencia de capacidad anterior y no certifican el runtime actual.

## Decision vigente

**Phase 3 implementada en branch y pendiente de PR. Produccion: NOT READY.**

El source candidato incorpora contratos WhatsApp neutrales, endurecimiento inbound y un handler outbound seguro, pero no esta desplegado. Produccion conserva el ejecutable anterior, 33/33 migraciones, receive-only y todos los efectos productivos bloqueados.

## Controles efectivos

| Control | Estado | Fuente |
| --- | --- | --- |
| Modo Sofia | Supervisado | Runtime safety backend |
| WhatsApp | Receive-only; bootstrap QR gobernado | QR gateway + governance settings |
| Envio real | Bloqueado | Runtime safety y adaptadores |
| Auto reply | OFF | Runtime safety |
| Auto Safe productivo | OFF | Runtime safety |
| Produccion | Bloqueada | Runtime safety |
| PAID desde WhatsApp | Imposible | SafetyGuard/payment webhook |
| Pagos publicos | Seleccion bloqueada | `PRODUCTIVE_ACTION` gate |
| DeepSeek | Dry-run de texto | Provider backend |
| Imagen | Sin vision; requiere texto o humano | Fallback multimedia |
| Audio | Solo usa transcripcion disponible | Fallback multimedia |
| Catalogo | Producto persistido y precio positivo | Catalog service |
| Sandbox | Separado y oculto por defecto | Source/scope backend |
| Phase 3 outbound | Implementado pero deshabilitado | Secure command + runtime gate |
| Migracion Phase 3 | 34/34 solo en PostgreSQL efimero | No aplicada a produccion |

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

## Validacion actual

| Capa | Resultado | Limite |
| --- | --- | --- |
| Prisma validate | PASS | Schema candidato local |
| API/Web typecheck, build y lint | PASS | Source candidato committeado |
| Tests Phase 3 focalizados | 47/47 PASS | Sin red externa |
| Tests API no DB | 278/278 PASS | Sin efectos operativos |
| Integracion Phase 3 PostgreSQL | 3/3 PASS | Base efimera aislada |
| Suite critica/RBAC/delivery | 157/157 PASS | Base efimera aislada |
| Playwright estandar/core | 2/2 y 3/3 PASS | Runtimes efimeros desde source |
| Migraciones efimeras | 34/34 PASS | Produccion permanece 33/33 |
| Seguridad focalizada | Secret scan PASS; envio real OFF | Sin credenciales reales |
| Runtime operativo | NO CERTIFICA el candidato | No desplegado por alcance |

## Datos reales, sandbox e historico

- `MOCK_ADMIN` y provider/mode mock siempre son sandbox.
- Conversaciones archivadas son historicas.
- La validacion interna no suma como operacion comercial.
- Con operacion real deshabilitada, la vista principal muestra cero conversaciones comerciales reales.
- No se inventan metricas cuando la fuente no existe.

## CRM y privacidad

- La UI CRM es de consulta; no crea campañas, mensajes, pagos, pedidos ni efectos operativos.
- La identidad principal nueva se deriva con HMAC y se muestra enmascarada.
- `CRM_IDENTITY_HASH_SECRET` debe existir en un secret store aprobado antes de staging remoto.
- El almacenamiento legado de memoria/telefonos y su politica de retencion requieren migracion y aprobacion legal/security antes de produccion.
- Consentimiento comercial explicito y canal outbound aprobado son requisitos previos a cualquier campaña.

## Bloqueadores de produccion

1. Revisar el Draft PR de Phase 3 y completar CI requerido.
2. Revisar y autorizar separadamente la migracion aditiva antes de cualquier despliegue.
3. Aprobar retencion, consentimiento y tratamiento de PII con owner legal/security.
4. Cerrar secret store, rotacion, monitoreo y proteccion de sesion Baileys.
5. Validar cuenta/sesion, QR e inbound fisico sobre el mismo artifact autorizado.
6. Ejecutar backup/restore, canary receive-only, rollback y observacion antes de activar cualquier envio.
7. Autorizar separadamente un destinatario de prueba y el handler outbound; actualmente permanece deshabilitado.

## Owner gates

- QR fisico y allowlist comercial final.
- Secret rotation/acceptance y secret store.
- Security/privacy owner y base juridica CRM.
- Remote, registry, branch protections, approvals y staging.
- Autorizacion futura separada para envio real; no forma parte del estado actual.

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
