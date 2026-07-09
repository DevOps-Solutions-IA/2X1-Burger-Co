# PHASE-DELIVERY-AUTO-4.1 NO-GO remediation report

## Resumen ejecutivo

Se cerraron dos bloqueos: buildx/build reproducible y Nginx rate-limit en rutas secundarias. El stress paralelo sigue fallando en `phase-delivery-auto-2-pos-display.spec.ts` y `phase-delivery-auto-4-harness-stability.spec.ts`, por lo que PHASE-4.1 permanece NO-GO y Production/V2 sigue NOT READY.

## NO-GO recibido

1. Build reproducible fallaba por buildx antiguo.
2. Rutas secundarias fallaban por Nginx `zone=auth` rate-limit 503.
3. Stress paralelo fallaba por harness/infra bajo concurrencia.

## Buildx diagnóstico

- Buildx efectivo verificado: `v0.30.1`.
- `docker compose build api`: PASS.
- `docker compose build web`: PASS.
- Runbook: `buildx-remediation-runbook.md`.

## Nginx rate-limit causa

`/api/` usaba `zone=auth`, aplicando el rate-limit auth a endpoints operativos normales durante navegación. Esto podía devolver 503/limit bajo carga de rutas secundarias.

## Nginx rate-limit corrección

Archivos ajustados:

- `infra/nginx/templates/http.conf.template`.
- `infra/nginx/templates/https.conf.template`.
- `infra/nginx/generated/default.conf`.

Cambios:

- Se agregó zona `api` para endpoints operativos: `1200r/m`, burst `240`.
- Login mantiene zona estricta `login`.
- `/api/auth/` mantiene zona `auth`.
- `/api/` usa zona `api`.
- `limit_req_status 429` evita reportar rate-limit como 503.

Validación:

- `nginx -t`: PASS.
- Health: PASS.
- Secondary routes: PASS.

## Parallel harness causa

Se encontraron tres fuentes:

- Storage/auth por worker existía, pero algunos specs seguían introduciendo login adicional o restauración de cookies stale.
- Specs de delivery dependían de SKU fijo `CC-ORG-400`, agotado por ejecuciones previas.
- El spec POS todavía queda en `PENDING` bajo stress en el caso de recálculo, aunque pasa aislado.

## Parallel harness corrección aplicada

- Nuevo fixture: `tests/e2e/fixtures/worker-auth.ts`.
- `auth.setup.ts` usa login API con backoff y storage por run.
- Specs delivery usan producto directo disponible dinámicamente, no SKU agotable fijo.
- Specs POS/checkout usan recálculo determinístico cuando el botón está disponible.
- Se removió restauración manual de cookies stale dentro del spec POS.

## Secondary routes result

PASS: `phase-delivery-auto-4-secondary-routes.spec.ts`.

## Parallel stress result

NO-GO: stress paralelo sigue fallando.

Fallas actuales:

- `phase-delivery-auto-2-pos-display.spec.ts`: estado `PENDING` no alcanza `GRATIS` en el caso de recálculo bajo workers=2.
- `phase-delivery-auto-4-harness-stability.spec.ts`: una recarga no encuentra `main` bajo stress.

## Regression completa

- API typecheck: PASS.
- API build: PASS.
- API test: PASS, 12 suites / 201 tests.
- Web typecheck: PASS.
- Web build: PASS con warnings P3.
- E2E delivery POS aislado: PASS.
- E2E checkout/cash aislado: PASS.
- E2E SYS-1: PASS.
- E2E cash/WhatsApp degraded: PASS.
- E2E secondary routes: PASS.
- Stress paralelo: FAIL.
- Health: PASS.
- Bundle `localhost:4300`: 0 ocurrencias.

## P0 abiertos

Ninguno reproducido.

## P1 abiertos

- Stress paralelo falla bajo concurrencia en POS/harness. Responsable: Codex.

## P2 abiertos

- Generación de screenshots PHASE-4.1 incompleta por NO-GO del stress.

## P3 abiertos

- Warnings `no-explicit-any` en frontend.

## Production/V2 readiness

NOT READY hasta que stress paralelo pase sin falsos redirects, sin `PENDING` indefinido y sin pérdida de shell `main` tras reload.

## Decisión final

PHASE-DELIVERY-AUTO-4.1 NO-GO REMEDIATION: NO-GO

PRODUCTION/V2 READINESS: NOT READY
