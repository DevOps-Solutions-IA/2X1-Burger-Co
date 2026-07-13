# Phase 1 - Checkpoint Before

## Snapshot

- Fecha/hora: 2026-07-12T13:39:38-05:00.
- Branch: `master`.
- HEAD: `900449425e11e3d9305cb9677192c69a12ee8456`.
- Remotes: ninguno observado.
- Tags: ninguno observado.
- Working tree: dirty, con cambios mezclados Delivery, Sofia, config/testing, componentes y reportes.

## Runtime inicial

| Servicio | Estado | Imagen/puerto |
| --- | --- | --- |
| API | healthy | `inventario-api`, host 4300 |
| Web | healthy | `inventario-web`, host 3301 |
| Nginx | healthy | `nginx:1.27-alpine`, 80/443 |
| PostgreSQL | healthy | `postgres:16-alpine`, localhost 5432 |

API health: `ok`, database `ok`, environment `development`. Web `/login`: HTTP 200, cache HIT.

## Bases usadas

- Runtime operativo: base Docker `inventory_fastfood_system` segun Compose.
- Tests Phase 1: URL guardada cuyo nombre termina en `_test` mediante `load-env.sh` y `assert_test_database_url`.
- No se imprimieron credenciales ni URLs completas.

## Configuracion no sensible

- WhatsApp mode: `receive_only`.
- Provider: `qr_gateway`.
- QR enabled: true.
- Real send raw: false.
- Auto reply raw: false.
- Auto Safe raw: false.
- DeepSeek: enabled, provider deepseek, mode dry_run.

## Drift inicial

- Dashboard efectivo: Auto Safe true.
- QR: DISCONNECTED, adapterReal false.
- Produccion: false/bloqueada.
- API y web construidos en momentos distintos, sin commit label demostrado.

## Procesos y puertos

Docker expone 80, 443, 3301 y 4300; PostgreSQL solo localhost 5432. Se observaron multiples procesos cloudflared y puertos adicionales sin ownership documentado. Evidencia en `evidence/phase-1/listening-ports.txt`.

## Artefactos historicos consultables

- system-total-audit-final
- delivery-phase-a-final
- delivery-test-handle-fix
- delivery-real-receipt-validation
- sofia-fable5-command-center
- sofia-extreme-live-dashboard
- engineering-framework-foundation

Se trataron como evidencia historica, no como verdad automatica.

## Evidencia detallada

Ver `.engineering/evidence/phase-1/`.
