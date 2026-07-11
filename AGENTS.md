# AGENTS.md

Guia obligatoria para agentes que trabajen en `inventario-fastfood-system`.

## Mision

Mantener una aplicacion operacional confiable para fast food: POS, ventas, inventario, caja, compras, gastos, domicilios, reportes y el modulo supervisado Sofia.

Prioridad absoluta:

1. No romper la operacion diaria.
2. No alterar stock/caja/pagos sin alcance explicito.
3. Mantener auditabilidad.
4. Mantener Sofia segura, supervisada y sin envio real.
5. Mantener documentacion actual y no contradictoria.

## Fuente de verdad actual

Antes de trabajar en Sofia, leer:

```text
docs/sofia-current-state.md
```

No usar reportes historicos como fuente actual de verdad si estan marcados `HISTORICO / OBSOLETO`.

Delivery Phase A está congelada. Consultar `docs/delivery-phase-a-frozen.md` antes de modificar el flujo de cuentas de domicilio.

## Reglas duras

Prohibido activar:

- Envio real WhatsApp.
- Auto reply.
- Auto Safe productivo.
- Produccion.
- `WHATSAPP_QR_ALLOW_REAL_SEND=true`.
- `WHATSAPP_MODE=auto_safe`.
- `SOFIA_AUTO_REPLY_ENABLED=true`.
- `SOFIA_AUTO_SAFE_ENABLED=true`.
- `SOFIA_PRODUCTION_ENABLED=true`.

Prohibido desde Sofia:

- Marcar pagos como PAID.
- Crear pagos reales.
- Crear pedidos reales.
- Tocar Caja.
- Tocar Stock.
- Tocar Checkout.
- Cambiar POS.
- Cambiar Domicilios.
- Cambiar precios.
- Cambiar catalogo.
- Cambiar regla Maxy Family.
- Exponer `.env`, secretos, tokens, QR raw, session auth o numeros completos.
- Presentar mocks/sandbox como datos reales.
- Ejecutar Prisma reset o migraciones destructivas.
- Bypassear Prisma Guard.

## Que pueden tocar los agentes

Permitido con alcance razonable:

- UI/UX de Sofia.
- Copy operativo de Sofia.
- Componentes visuales reutilizables.
- Documentacion y reportes sanitizados.
- Tests no destructivos.
- Typecheck/build.
- Seguridad de logs y redaccion.
- Separacion de sandbox/dry-run/real.
- Endpoints admin protegidos si no se reduce seguridad.

Permitido con cautela:

- Backend Sofia.
- QR Gateway receive-only.
- DeepSeek dry-run backend.
- SafetyGuard.
- Learning/metrics/alerts.

Debe requerir instruccion explicita:

- Cambios en POS.
- Cambios en Caja.
- Cambios en Stock.
- Cambios en Checkout.
- Cambios en Pagos.
- Cambios en Domicilios.
- Cambios en pricing/catalogo.
- Migraciones Prisma.

## Modos operativos

| Modo | Definicion | Evidencia valida | Riesgo |
| --- | --- | --- | --- |
| Sandbox | Simulacion marcada como laboratorio. | UI `/sofia/sandbox`, tests, fixtures. | No cuenta como real. |
| Dry-run | Proveedor/logica real sin efectos operativos. | DeepSeek real backend con `SOFIA_AI_MODE=dry_run`, `sent=false`. | No debe enviar ni operar. |
| Receive-only | WhatsApp recibe inbound, no responde. | QR Baileys, `WHATSAPP_MODE=receive_only`, send bloqueado. | No habilita clientes reales. |
| Produccion | Operacion real con clientes. | Solo fase formal futura. | Actualmente bloqueada. |

## Estado Sofia actual

- Modo: supervisado.
- WhatsApp QR: Baileys real receive-only.
- QR real: validado.
- CONNECTED fisico: validado condicionado.
- DeepSeek real: dry-run GO.
- SafetyGuard: GO.
- Envio real: bloqueado.
- Auto reply: OFF.
- Auto Safe productivo: OFF.
- Produccion: bloqueada.
- Allowlist comercial final: pendiente.
- Envio real interno: diferido al final.
- UI/UX: GO tecnico; content cleanup pendiente.
- Security cleanup 4B: GO condicionado.

## Orden correcto de fases Sofia

1. Verificar seguridad/flags.
2. Confirmar estado QR real y receive-only.
3. Validar allowlist sin exponer numero completo.
4. Validar inbound real solo si el operador lo ejecuta fisicamente.
5. Validar DeepSeek solo en dry-run.
6. Validar SafetyGuard antes de aceptar sugerencias.
7. Confirmar `SENT=0`.
8. Confirmar PAID bloqueado.
9. Confirmar produccion bloqueada.
10. Generar evidencias y reporte.

No avanzar a produccion por inferencia. Solo por fase explicita.

## Regla Maxy Family

Composicion autorizada:

```text
6 burgers + 1 porcion personal de papitas + 1 Pepsi 1.5 L
```

Upsell permitido:

```text
Si quieres que todos acompanen con papitas, puedes agregar porciones adicionales.
```

Frases prohibidas como copy comercial:

- papas grandes.
- papas familiares.
- papas para todos.
- porcion familiar de papas.
- papitas para todos.
- combo familiar con papas familiares.

Permitidas solo en blocklists, tests negativos o documentacion tecnica.

## Checks recomendados

Para cambios Sofia:

```bash
pnpm --filter @inventory-fastfood/web typecheck
pnpm --filter @inventory-fastfood/web build
pnpm --filter @inventory-fastfood/api typecheck
pnpm --filter @inventory-fastfood/api build
```

Checks de seguridad:

```bash
grep -RIn "WHATSAPP_QR_ALLOW_REAL_SEND=true\\|SOFIA_AUTO_REPLY_ENABLED=true\\|SOFIA_AUTO_SAFE_ENABLED=true\\|WHATSAPP_MODE=auto_safe\\|SOFIA_PRODUCTION_ENABLED=true" .env.example apps/api/src apps/web/src packages 2>/dev/null || true
```

Interpretacion:

- Nombres de variables no son secreto por si solos.
- Valores reales, tokens, QR raw, session auth o numeros completos si son bloqueo.
- Para buscar secretos, usar patrones de valores reales en un log local sanitizado; no copiar esos patrones ni resultados sensibles a reportes.

## Prisma y base de datos

No ejecutar:

```bash
prisma migrate reset --force
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=...
```

Si un test intenta reset/migrate destructivo y Prisma Guard lo bloquea, documentar `BLOCKED_BY_PRISMA_AI_GUARD_SAFE`. No forzar.

## Documentacion

Cuando cambie el estado de Sofia:

- Actualizar `docs/sofia-current-state.md`.
- Si un reporte queda viejo, marcarlo `HISTORICO / OBSOLETO`.
- No borrar evidencia historica sin dejar trazabilidad.
- No copiar secretos ni credenciales completas a markdown.

## Criterio de GO para agentes

Un cierre puede ser GO solo si:

- No hay activacion real no autorizada.
- No hay secretos expuestos.
- No se tocaron POS/Caja/Stock/Checkout fuera de alcance.
- Build/typecheck pertinentes pasan o el bloqueo esta documentado.
- Sofia sigue supervisada, receive-only/dry-run segun corresponda.
- Reporte/documentacion final no contradice la fuente de verdad actual.
