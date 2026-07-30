# Sofia - Estado actual

Ultima actualizacion: 2026-07-27.

Este archivo es la fuente de verdad vigente para agentes. Los reportes historicos solo son evidencia de capacidad anterior y no certifican el runtime actual.

## Decision vigente

**Implementacion supervisada: GO CONDICIONADO. Produccion: NOT READY.**

Sofia puede operar en sandbox, validacion interna y dry-run sin efectos productivos. No esta autorizada para atender clientes en produccion, enviar mensajes, activar QR fisico, seleccionar pagos ni modificar POS, Caja, Stock, Checkout o Domicilios.

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

## Validacion actual

| Capa | Resultado | Limite |
| --- | --- | --- |
| Prisma validate | PASS | Schema local |
| API typecheck/build/lint | PASS | Source actual dirty |
| Web typecheck/build/lint | PASS | Source actual dirty |
| Tests Sofia/WhatsApp focalizados | 13 suites, 49 pruebas PASS | Sin red externa |
| Gate de ubicacion no correlacionada | PASS en PostgreSQL efimero | Escenario focalizado |
| Suite critica completa | NO CERTIFICADA en el source final | Ultimo full run previo: 90/91; correccion focal posterior PASS |
| Playwright desktop/mobile | 2/2 PASS | Runtime aislado desde source |
| Seguridad focalizada | Sin activaciones reales ni secretos detectados | Literales sinteticos de test excluidos |
| Artifact limpio | NO DEMOSTRADO | Working tree mezclado y sin commit autorizado |
| Runtime operativo | NO CERTIFICA este source | Imagen anterior sin provenance vigente |

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

1. Consolidar changeset y construir artifact limpio con `SOURCE = COMMIT = ARTIFACT = RUNTIME`.
2. Migrar o cifrar el almacenamiento legado de telefonos/memoria y aprobar retencion/eliminacion.
3. Reemplazar la atribucion automatica a un usuario humano por actor de sistema persistente.
4. Restringir y sanear la superficie WhatsApp legado que expone QR/sesion a roles operativos.
5. Ejecutar suite critica completa sobre el candidato final y obtener PASS sin timeout.
6. Cerrar rotacion de secretos, KMS/secret store, security owner y monitoreo persistente.
7. Aprobar allowlist comercial y validar QR/inbound fisico sobre el mismo artifact.
8. Demostrar staging remoto, required CI, approvals, rollback y alertas.
9. Aprobar politica legal de CRM, consentimiento y retencion.

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
