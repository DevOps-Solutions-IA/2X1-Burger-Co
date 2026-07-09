# Sofia - checklist preproduccion

## Listo

- QR real Baileys implementado.
- Storage QR corregido y persistente.
- UI QR truthful: no exito falso sin adapter/QR real.
- WhatsApp real send bloqueado.
- DeepSeek real validado solo en dry-run.
- SafetyGuard activo sobre respuestas candidatas.
- `SENT=0` validado en dry-run previo.
- `/sofia/conversations` separa mock/sandbox de vista real.
- Build/typecheck web y API en PASS.

## Pendiente final

- Allowlist comercial definitiva con numero final.
- Inbound allowlist aceptado end-to-end con evidencia.
- Piloto de envio real solo a numero interno, en fase explicita.
- Kill-switch probado con operador.
- Rate limiting operativo para endpoints Sofia.
- Rollback documentado y ensayado.
- Confirmar limpieza/rotacion externa tras hallazgo de artefactos sensibles locales.

## Bloqueadores de produccion

- No activar produccion.
- No activar auto reply.
- No activar Auto Safe productivo.
- No activar envio real a clientes.
- No usar clientes externos hasta cerrar allowlist final y piloto controlado.

