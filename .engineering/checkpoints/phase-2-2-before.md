# Phase 2.2 - Checkpoint Before

## Identidad

- Fecha: `2026-07-13`.
- Branch: `master`.
- HEAD documental: `0fab03ba10c07a401f7a60531e9f878876afd452`.
- Release candidate activo: `e2bffe97d76ab1a2fe83f2e20b19baa90f0e82a4`.
- Build ID: `0.1.0-e2bffe97d76a-1783925108`.
- API digest: `sha256:049521e5468e1675ba4778b7edb2471b6598a8b6afb732373683e5350157e1cc`.
- Web digest: `sha256:61f4862778f00f864eab10ceda1716ba0c994391da1c9db92b739686e2852fe6`.

## Aislamiento confirmado

- API canary: `127.0.0.1:4400`.
- Web canary: `127.0.0.1:3401`.
- PostgreSQL canary: `127.0.0.1:55433`.
- DB: `inventory_fastfood_system_canary_test`, volumen Docker propio.
- Sin mounts de sesiones WhatsApp.
- Sin key DeepSeek.
- QR y reconnect deshabilitados.
- Envio real, Auto Reply, Auto Safe y produccion declarados `false`.
- Runtime operativo y sus puertos no fueron modificados.

## Conteos iniciales canary

| Entidad | Count |
| --- | ---: |
| Inbound WhatsApp | 0 |
| Mensajes WhatsApp | 0 |
| Outbound WhatsApp | 0 |
| Conversaciones | 0 |
| Decisiones Auto Safe | 0 |
| Audit logs | 10 |
| Ordenes | 0 |
| Ventas | 0 |
| Pagos de venta | 0 |
| Eventos de pago Sofia | 0 |
| Movimientos de caja | 0 |

## Estado efectivo inicial

- `realSendingEnabled=false`.
- `autoReplyEnabled=false`.
- `autoSafeEnabled=false`.
- `productionEnabled=false`.
- `whatsappCanMarkPaid=false`.
- QR `DISABLED`, disconnected, adapterReal false, sin QR raw.
- IA declarada `deepseek/dry_run`, proveedor externo deshabilitado.
- Production readiness `BLOCKED`.

## Hallazgos para el loop

1. `approveSend` y `retryOutbound` no consultan un gate central antes del provider.
2. La pausa global persistida no se consulta en `handleInboundMode`.
3. Kill switch y pause comparten concepto; no hay estado persistente separado.
4. Inbox reporta `receiveOnly=false` mientras Governance reporta true por configuracion canary contradictoria.
5. El estado `dry_run` se presenta como no disponible cuando el proveedor externo esta OFF.
6. La normalizacion allowlist es privada y acepta longitudes no validas como comparables.

No se ejecuto ninguna operacion sobre DB operacional, red WhatsApp o proveedor IA externo.
