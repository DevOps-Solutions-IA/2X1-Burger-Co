# Phase 2.2 - Safety Matrix

Fecha: 2026-07-13. Artifact evaluado: `0.1.0-66c54785f6d1-1783929742`.

| Control | Config declarado | Estado API | Estado UI | Comportamiento probado | Auditoria | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| realSendingEnabled | false | false | Envio bloqueado | approve, retry y adapter test-send bloqueados antes del transporte | counter `send_blocked_total` | PASS |
| autoReplyEnabled | false | false | OFF | inbound aceptado produce sugerencia, nunca envio | counter sin envio | PASS |
| autoSafeEnabled | false | false | OFF | decision evaluada con `shouldSend=false` | decision/audit | PASS |
| productionEnabled | false | false | Produccion bloqueada | accion productiva denegada | runtime safety audit | PASS |
| whatsappCanMarkPaid | false | false | PAID bloqueado | pago sensible no crea pago ni cambia orden | decision/audit | PASS |
| pause global | false/restaurado | visible | visible | al activarse bloquea automatizacion y conserva lectura | cambio persistido y auditado | PASS |
| kill switch | false/restaurado | visible | visible | prevalece y bloquea envio/reintento | cambio persistido y auditado | PASS |
| allowlist | sintetica exacta | fail-closed | estado sanitizado | permitido avanza al gate final; no permitido se rechaza | denied counter + audit | PASS |
| receive-only | receive_only | true | Receive-only | ningun flujo alcanza red externa | runtime safety | PASS |
| sandbox isolation | separado | real/internal/sandbox | tabs separadas | reconciliacion DB: cero ventas, pagos, caja y PAID | counts antes/despues | PASS |
| human escalation | habilitado | human_required | visible | solicitud humana y pago escalan | decision/audit | PASS |
| payment-sensitive | bloqueado | payment_sensitive | Requiere revision | no crea pago ni confirma pago | counter + decision | PASS |
| unknown product | bloqueado | unknown_product | Producto no reconocido | no inventa producto, precio ni pedido | decision/audit | PASS |
| inbound dedup | persistente | duplicate=true | sin duplicado visible | mismo id produce una sola decision/draft | duplicate counter | PASS |
| outbound dedup | key persistente | send sigue bloqueado | sent=false | misma revision no produce transporte | audit/counter | PASS |
| QR truthful | disabled | DISABLED | Deshabilitado | sin bootstrap, QR ni adapter real | status sanitizado | PASS |
| adapter truthful | sin sesion | adapterReal=false | No disponible | no aparece CONNECTED ni QR_READY | status sanitizado | PASS |
| DeepSeek dry-run | dry_run, externo OFF | dry_run | Dry-run, proveedor externo OFF | fallback interno sin red externa | AI status | PASS |
| redaction/masking | habilitado | sanitizado | masked | scan: cero secretos, telefonos completos o QR raw | secret/DB scan | PASS |
| session protection | sin mount | unavailable | no expuesta | canary no monta auth ni inicia Baileys | container inspect | PASS |

## Resultado

Los controles internos son `PASS` en canary aislado. La fase queda `GO CONDICIONADO` porque QR fisico, allowlist comercial, staging remoto, security owner y approvals requieren owner gate y no se simularon como operacion real.
