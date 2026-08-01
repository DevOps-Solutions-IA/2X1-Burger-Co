# 2X1 Burger Co — Plataforma Operativa

Sistema privado de gestión integral para la operación de **2X1 Burger Co.** Centraliza inventario, recetas, compras, ventas, caja, comandas, domicilios, reportes, atención por WhatsApp y las capacidades supervisadas de **SOFIA AI**.

> **Estado actual:** aplicación productiva, arquitectura monorepo, base PostgreSQL administrada con Prisma, controles de seguridad fail-closed y despliegue mediante Docker Compose. SOFIA permanece bajo gobierno operativo; el envío real, las respuestas automáticas y las mutaciones sensibles solo pueden activarse mediante fases expresamente autorizadas.

## Alcance del sistema

La plataforma cubre los siguientes dominios operativos:

- **Catálogo y productos:** categorías, productos vendibles, marcas, precios y disponibilidad.
- **Inventario:** ingredientes, existencias, movimientos, conteos físicos, desperdicios y reposición.
- **Recetas:** composición, rendimientos, consumo de insumos y validación de disponibilidad.
- **Compras y proveedores:** órdenes de compra, recepción y seguimiento de abastecimiento.
- **Ventas y POS:** ventas directas, comprobantes, control de stock y flujo de caja.
- **Mesas y comandas:** órdenes abiertas, atención por mesero, checkout y sincronización operativa.
- **Caja:** apertura, cierre, reapertura controlada, movimientos y conciliación diaria.
- **Gastos y reportes:** cierres históricos, márgenes, rotación, comparativos y documentos PDF.
- **Domicilios:** clientes, ubicación, tarifa, asignación y trazabilidad de entrega.
- **SOFIA AI:** conversaciones, memoria, CRM, borradores de pedido, WhatsApp, pagos supervisados, auditoría, seguridad y gobierno.

## SOFIA AI

SOFIA es el asistente comercial y operativo del sistema. Su objetivo productivo es atender clientes por WhatsApp, construir pedidos estructurados, consultar catálogo e inventario, calcular domicilios, solicitar confirmación y crear una comanda real dentro del flujo central del restaurante.

### Capacidades existentes

- Recepción y persistencia de conversaciones de WhatsApp.
- Control humano: pausa, reanudación, toma y liberación de conversaciones.
- Interpretación comercial de productos, cantidades, dirección, pago y confirmación.
- Consulta de productos activos, precios, recetas e inventario.
- Creación y actualización de borradores de pedido.
- CRM, consentimiento, memoria de cliente y seguimiento.
- Integraciones de pago con validación de webhooks.
- Auditoría, privacidad, retención, métricas, alertas, backups y kill switch.

### Estado de seguridad de Fase 0

- Migraciones de producción: **32/32**.
- Rutas sandbox y mutaciones de desarrollo: bloqueadas fuera de pruebas.
- Proveedores mock de WhatsApp y pagos: bloqueados en producción.
- Tarifas ficticias y conversiones simuladas: bloqueadas antes de persistencia.
- Autenticación, RBAC, idempotencia, auditoría y firma de webhooks: preservadas.
- Backup cifrado y restauración aislada: validados.
- Readiness con attestación restringida para el drift histórico de `0001_initial`.
- Healthcheck interno Web → API validado dentro de la red Docker.

La Fase 0 no habilita por sí sola respuestas automáticas, envíos reales, pagos automáticos ni creación autónoma de comandas.

## Arquitectura

```text
apps/
├── api/                 NestJS + Prisma
└── web/                 Next.js + React

prisma/
├── schema.prisma
└── migrations/

infra/
├── docker/
├── nginx/
├── release/
├── recovery/
├── scripts/
└── testing/

tests/
└── e2e/
```

### Flujo principal

```text
Cliente / Operador
        ↓
Next.js / WhatsApp
        ↓
NestJS API
        ↓
Servicios de dominio
        ↓
Prisma
        ↓
PostgreSQL
```

### Stack tecnológico

| Capa | Tecnología |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, TanStack Query |
| Backend | NestJS 11, TypeScript, Prisma 6 |
| Base de datos | PostgreSQL |
| Autenticación | JWT access/refresh, rotación de tokens y RBAC |
| Testing | Jest/Node tests, Playwright E2E y pruebas de recuperación |
| Infraestructura | Docker, Docker Compose, Nginx y scripts de release |
| Gestión de paquetes | pnpm 10 workspace |

## Principios de operación

1. **El backend es la fuente de verdad.** SOFIA no mantiene precios, inventario ni tarifas dentro del prompt.
2. **Las mutaciones sensibles fallan cerradas.** Un proveedor, configuración o capacidad no reconocida se bloquea.
3. **No se trabaja directamente en `main`.** Cada cambio debe pasar por rama, revisión, CI y pull request.
4. **Producción, GitHub y el checkout principal deben compartir el mismo SHA.**
5. **No se ejecutan `migrate reset`, `db push` ni seeds sobre producción.**
6. **Los backups de producción se cifran y se validan en una base temporal aislada.**
7. **Los secretos nunca se almacenan en Git.**

## Requisitos locales

- Node.js compatible con el workspace.
- pnpm `10.16.0`.
- Docker y Docker Compose.
- PostgreSQL, preferiblemente mediante el servicio definido en Compose.

## Inicio local

```bash
pnpm install
cp .env.example .env

docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Servicios por defecto:

- API: `http://localhost:3000`
- Web: `http://localhost:3001`

Los accesos iniciales deben definirse mediante variables de entorno seguras. Este repositorio no publica contraseñas operativas ni credenciales de producción.

## Comandos principales

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm e2e
pnpm test:e2e:ephemeral
pnpm test:recovery:ephemeral
pnpm validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## Seguridad de datos

- `TEST_DATABASE_URL` debe apuntar a una base exclusiva de pruebas.
- Los seeds están bloqueados sobre bases vivas salvo autorización explícita.
- Los restores destructivos requieren controles y autorización.
- Los proveedores mock solo están permitidos en `NODE_ENV=test`.
- Los archivos `.env`, claves GPG, dumps y backups no deben entrar al repositorio.
- Los webhooks deben validar firma e idempotencia antes de producir efectos.

## Docker y producción

Construcción local del stack:

```bash
./infra/scripts/render-nginx-conf.sh
docker compose up --build
```

Despliegue controlado:

```bash
./infra/scripts/deploy.sh
```

Verificación operativa:

```bash
./infra/scripts/smoke.sh
```

Backup cifrado y validación aislada:

```bash
./infra/scripts/backup.sh
./infra/scripts/restore.sh backups/backup-<db>-<timestamp>.dump.gpg --validate-only
```

Nunca se debe restaurar directamente sobre producción sin autorización de incidente y backup previo verificado.

## Calidad y validación

Los cambios deben superar, según su alcance:

- secret scan;
- lint;
- typecheck;
- build;
- pruebas unitarias y de integración;
- E2E efímero;
- validación de migraciones;
- simulacro de recuperación;
- health/readiness;
- evidencia `PASS`, decisión `GO` y rollback disponible.

## Flujo de ramas

```text
main
  └── feature/<fase-o-capacidad>
        └── Pull Request
              └── CI PASS
                    └── merge controlado
                          └── build y despliegue desde main
```

Al cerrar una fase debe cumplirse:

```text
LOCAL_MAIN_SHA = ORIGIN_MAIN_SHA = PRODUCTION_SOURCE_SHA
```

## Documentación técnica

- Arquitectura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Contribución: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Seguridad: [`SECURITY.md`](SECURITY.md)
- Evidencia de SOFIA: [`.engineering/sofia-production/`](.engineering/sofia-production/)

## Propiedad y uso

Repositorio privado de **2X1 Burger Co.** La información, los flujos operativos, la configuración y el código están destinados exclusivamente al equipo autorizado del proyecto.
