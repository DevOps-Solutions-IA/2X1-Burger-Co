# CLAUDE.md

Guia operativa para Claude Code al trabajar en este repositorio.

## Estado actual del sistema

Este repositorio contiene el sistema `inventario-fastfood-system` para 2X1 Burger Co. Es una aplicacion operacional de fast food con POS, inventario, caja, compras, gastos, domicilios, reportes y el modulo supervisado Sofia.

La fuente de verdad actual para Sofia esta en:

- `docs/sofia-current-state.md`

## Stack

- Frontend: Next.js + TypeScript.
- Backend: NestJS + TypeScript.
- DB: PostgreSQL + Prisma.
- Monorepo: pnpm workspaces.
- Infra: Docker Compose, nginx reverse proxy, health checks y scripts de backup.

## Modulos criticos protegidos

No modificar estos flujos salvo que el usuario lo pida explicitamente y haya pruebas suficientes:

- POS.
- Caja.
- Stock/inventario.
- Checkout.
- Domicilios.
- Pagos.
- Precios.
- Catalogo comercial.
- Reglas Maxy Family.

Toda venta debe actualizar stock y caja. Toda compra recibida debe actualizar stock. Los gastos afectan el cierre diario. El cierre diario debe conservar auditabilidad.

Delivery Phase A está congelada. Consultar `docs/delivery-phase-a-frozen.md` antes de modificar el flujo de cuentas de domicilio.

## Sofia

Sofia es un modulo supervisado, no un reemplazo del POS ni de Domicilios.

Estado actual:

- Opera en modo supervisado.
- WhatsApp QR Gateway usa Baileys real en receive-only.
- QR real Baileys validado.
- CONNECTED fisico validado de forma condicionada.
- DeepSeek real esta permitido solo en dry-run backend.
- SafetyGuard esta activo.
- Envio real WhatsApp bloqueado.
- Auto reply OFF.
- Auto Safe productivo OFF.
- Produccion bloqueada.
- Allowlist comercial final pendiente.
- Envio real interno diferido al final.
- UI/UX operador GO tecnico; content cleanup pendiente.
- Security cleanup 4B GO condicionado por rotacion/aceptacion owner.

## Reglas duras de Sofia

Nunca activar sin fase explicita:

- `WHATSAPP_QR_ALLOW_REAL_SEND=true`.
- `WHATSAPP_MODE=auto_safe`.
- `SOFIA_AUTO_REPLY_ENABLED=true`.
- `SOFIA_AUTO_SAFE_ENABLED=true`.
- `SOFIA_PRODUCTION_ENABLED=true`.

Nunca desde Sofia:

- Enviar WhatsApp real.
- Marcar pagos como PAID.
- Crear pagos reales.
- Crear pedidos reales.
- Mover caja, stock, checkout, POS o domicilios.
- Exponer `.env`, secretos, QR raw, session auth o numeros completos.
- Usar mocks como evidencia real.

## Diferencia de modos

| Modo | Significado | Permitido |
| --- | --- | --- |
| Sandbox | Simulacion/laboratorio. No es evidencia real. | Pruebas controladas y UI demo marcada como sandbox. |
| Dry-run | Ejecuta logica o proveedor real para sugerencias, pero no envia ni opera. | DeepSeek real backend dry-run, SafetyGuard, comparacion contra rules. |
| Receive-only | WhatsApp recibe inbound, pero no responde. | QR Baileys, inbound y conversaciones supervisadas. |
| Produccion | Operacion real con clientes. | Bloqueada hasta fase formal posterior. |

## Regla Maxy Family

La composicion autorizada es:

```text
6 burgers + 1 porcion personal de papitas + 1 Pepsi 1.5 L
```

Upsell permitido:

```text
Si quieres que todos acompanen con papitas, puedes agregar porciones adicionales.
```

No usar como copy comercial permitido:

- papas grandes.
- papas familiares.
- papas para todos.
- porcion familiar de papas.
- papitas para todos.
- combo familiar con papas familiares.

Esas frases solo pueden aparecer en blocklists, tests negativos o documentacion tecnica de prohibiciones.

## Comandos comunes

```bash
pnpm install
pnpm --filter @inventory-fastfood/api typecheck
pnpm --filter @inventory-fastfood/web typecheck
pnpm --filter @inventory-fastfood/api build
pnpm --filter @inventory-fastfood/web build
docker compose ps
curl -fsS http://localhost/api/health
```

No ejecutar migraciones destructivas ni reset de Prisma sin consentimiento explicito del usuario.

Prohibido usar:

```bash
prisma migrate reset --force
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=...
```

## Estructura relevante

```text
apps/api/          Backend NestJS.
apps/web/          Frontend Next.js.
packages/          Paquetes compartidos.
prisma/            Schema y migraciones.
infra/             Docker, nginx, backups, deployment prep.
tests/e2e/         Playwright.
docs/              Documentacion actual.
```

Rutas Sofia principales:

```text
apps/api/src/modules/sofia/
apps/web/src/app/(app)/sofia/
apps/web/src/components/sofia/
docs/sofia-current-state.md
```

## Seguridad y privacidad

- No imprimir `.env`.
- No copiar secretos a reportes.
- No guardar QR raw en markdown.
- No exponer session paths absolutos innecesarios.
- No mostrar numeros completos; usar hash parcial o ultimos 4 si es necesario.
- Los reportes deben ser sanitizados.
- Las credenciales seed son solo para desarrollo local y no deben publicarse con valores completos en esta guia.

## Credenciales seed

Existen usuarios seed para desarrollo local, pero esta guia no debe listar contrasenas/codigos completos. Consultar `prisma/seed.ts` solo en entorno local autorizado y nunca copiar valores a reportes.

## Criterios de cierre para cambios

Para cambios de codigo:

1. Mantener produccion bloqueada.
2. Mantener envio real WhatsApp bloqueado.
3. Mantener auto reply OFF.
4. Mantener Auto Safe productivo OFF.
5. No tocar POS/Caja/Stock/Checkout salvo alcance explicito.
6. Ejecutar typecheck/build pertinentes.
7. Ejecutar checks de secretos y activacion real si se toca Sofia.
8. Actualizar documentacion si cambia estado operativo.
