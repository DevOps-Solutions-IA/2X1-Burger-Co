# Sofia - Estado actual

Ultima actualizacion: 2026-08-09.

Este archivo es la fuente de verdad vigente para agentes. Los reportes historicos solo son evidencia de capacidad anterior y no certifican el runtime actual.

## Decision vigente

**Phases 3, 4, 5 y 6 fusionadas. Phase 7 esta implementada en Draft PR #12 y en validacion final. Produccion permanece cerrada.**

El source actual en `main` es `064a2706c099c75b6a4cd68eb916b037cd6dc302` y contiene 37 migraciones. El runtime artifact local validado proviene de `60af56e0eb9635152c99437e301a38a76b4f1007`; el HEAD de codigo revisado es `8c9a6c4bc36acac4a7698ea5e27e00ea34fdea75` y su delta posterior al runtime solo fija acciones CI/CD a commits inmutables. Phase 6 implementa operaciones en vivo, notificaciones y recovery bajo gates. Phase 7 endurece seguridad, resiliencia, observabilidad y release, pero no esta desplegada. Real Bold, envio real WhatsApp, auto reply y produccion permanecen bloqueados. El estado exacto del runtime productivo no debe inferirse del repositorio.

## Controles previstos del candidato

Estos controles describen el source candidato. El runtime productivo no fue
consultado ni modificado y se reporta como `RUNTIME_NOT_VERIFIED`.

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
| Migracion Phase 4 | 35/35 solo en PostgreSQL efimero | No aplicada a produccion |
| Migracion Phase 5 | 36/36 validada antes del merge | No aplicada por este programa |
| Migracion Phase 6 | 37/37 validada y fusionada | No aplicada por este programa |
| Phase 7 | Hardening implementado; Draft PR #12, CI final pendiente | Sin migration 38 |

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
| API/Web typecheck, build y lint | PASS | Runtime source `60af56e` |
| Phase 6 CI | PASS y fusionada | PR #11 |
| Phase 6 focalizada | 219/219 PASS | PostgreSQL aislado |
| Phase 7 focalizada | 253/253 PASS dos veces | Runtime source anterior semanticamente equivalente; CI final pendiente |
| Concurrency/fault/load | 41/41 PASS | PostgreSQL aislado |
| Checkout/payment Phase 5 | 15/15 PASS | PostgreSQL aislado |
| Suite critica/RBAC | 92/92 PASS | PostgreSQL aislado |
| Migraciones | Fresh 37/37; legacy 36->37 PASS | Produccion no migrada por este programa |
| Seguridad | Audit y secret scan PASS; critical/high abiertos 0 | Sin credenciales reales |
| Runtime productivo | NO CERTIFICA el candidato | No desplegado por alcance |

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

1. Completar PR y CI remoto de Phase 7 sobre el SHA final.
2. Aprobar retencion, consentimiento y tratamiento de PII con owner legal/security.
3. Configurar secret store, rotacion y alert routing del entorno objetivo.
4. Autorizar separadamente backup, restore, migraciones productivas y deployment del SHA exacto.
5. Validar cuenta/sesion, QR e inbound fisico sobre el artifact autorizado.
6. Ejecutar canary receive-only, rollback y observacion antes de activar cualquier envio.
7. Autorizar separadamente Bold real, un destinatario de prueba y auto messaging; permanecen deshabilitados.

## Owner gates

- Branch protections, revision independiente y CI remoto del HEAD final.
- Security/privacy owner, base juridica CRM y retencion de PII.
- Secret rotation/acceptance, secret store y alert routing productivo.
- Backup cifrado fresco, validacion de restore aislado y autoridad de rollback.
- Promocion del artifact inmutable al registry y aprobacion de sus digests.
- Migracion productiva, deployment y smoke/readiness autorizados por separado.
- Staging, canary receive-only, ventana de observacion y ownership de incidentes.
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
