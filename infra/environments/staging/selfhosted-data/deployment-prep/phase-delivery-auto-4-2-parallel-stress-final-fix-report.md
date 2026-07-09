# PHASE-DELIVERY-AUTO-4.2 parallel stress final fix report

## Resumen ejecutivo

Se cerró el NO-GO restante de PHASE-4.1. El stress target y el stress full con `workers=2` pasaron. El bloqueo de POS `PENDING` no volvió a reproducirse después de estabilizar el harness, y el bloqueo de `main` tras reload quedó corregido con storageState por worker persistente y selector estable `app-main`.

## Estado recibido

- Provider live geo: GO.
- Buildx/build reproducible: PASS.
- Nginx rate-limit/rutas secundarias: PASS.
- API/Web gates previos: PASS.
- Bloqueo recibido: stress paralelo por POS `PENDING` y shell `main` no visible.

## Bloqueador POS PENDING

Síntoma: bajo stress, el caso de recálculo podía quedarse en `PENDING`.

Causa raíz validada: el fallo se acoplaba al harness paralelo y al estado de sesión/worker. El POS aislado pasaba; al estabilizar auth por worker y persistir cookies rotadas, POS dejó de quedar en `PENDING` bajo `workers=2`.

Fix aplicado:

- Producto E2E dinámico con stock directo suficiente.
- Espera por estado real con recálculo controlado si el botón aparece habilitado.
- Sin timeouts ciegos, sin `test.skip`, sin serializar suite.

## Bloqueador main reload

Síntoma: el harness recargaba ruta protegida y no encontraba `main`, o redirigía a login.

Causa raíz:

- Workers paralelos compartían usuario admin y refresh rotation invalidaba cookies entre contextos.
- El archivo `workerAuthFile` no se actualizaba después de que el navegador rotaba refresh token.
- El harness hacía re-login UI como fallback, generando login storms y contaminación.

Fix aplicado:

- `tests/e2e/fixtures/worker-auth.ts` crea usuarios admin E2E por worker.
- Storage por worker se guarda como `e2e-worker-N.json`.
- El fixture reutiliza storage validándolo con `/api/auth/refresh`.
- El fixture persiste `context.storageState()` al finalizar cada test.
- `phase-delivery-auto-4-harness-stability.spec.ts` usa contexto explícito con `storageState: workerAuthFile`.
- `AppShell` expone `data-testid="app-main"` sin cambiar diseño visual.

## Target parallel stress result

PASS:

```bash
BASE_URL=http://localhost npx playwright test tests/e2e/phase-delivery-auto-2-pos-display.spec.ts tests/e2e/phase-delivery-auto-4-harness-stability.spec.ts --config=tests/e2e/playwright.noserver.config.ts --project=chromium --workers=2
```

Resultado: 4 passed.

## Full parallel stress result

PASS:

```bash
BASE_URL=http://localhost npx playwright test tests/e2e/phase-delivery-auto-2-pos-display.spec.ts tests/e2e/phase-delivery-auto-3-checkout-cash-audit.spec.ts tests/e2e/phase-delivery-auto-4-harness-stability.spec.ts --config=tests/e2e/playwright.noserver.config.ts --project=chromium --workers=2
```

Resultado: 5 passed.

## API/Web gates

- API typecheck: PASS.
- API build: PASS.
- API test: PASS, 12 suites / 201 tests.
- Web typecheck: PASS.
- Web build: PASS, warnings P3 `no-explicit-any` existentes.

## E2E regression

- Delivery POS isolated: PASS.
- Checkout/cash audit: PASS.
- SYS-1 auth refresh concurrency: PASS.
- Secondary routes: PASS.
- Cash/WhatsApp degraded: PASS.

## Health

PASS: `/api/health` devuelve `status=ok`, API y database OK.

## Bundle

PASS: `localhost:4300` tiene 0 ocurrencias en `.next`.

## Docker build reproducible

PASS: `docker compose build api web`.

## Screenshots

Generados en `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/phase-delivery-auto-4-2/`:

- `01-pos-recalculation-no-pending.png`.
- `02-main-visible-after-reload.png`.
- `03-parallel-target-pass.png`.
- `04-parallel-full-pass.png`.
- `05-final-health.png`.
- `06-final-summary.png`.

## P0 abiertos

Ninguno.

## P1 abiertos

Ninguno.

## P2 abiertos

Ninguno operacional. Quedan warnings P3 de typing frontend.

## P3 abiertos

- Warnings `no-explicit-any` en frontend.
- Warning de plugin Next.js en ESLint.

## Decisión final

PHASE-DELIVERY-AUTO-4.2 PARALLEL STRESS FINAL FIX: GO

PRODUCTION/V2 READINESS: READY
