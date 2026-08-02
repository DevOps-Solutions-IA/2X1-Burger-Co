# Phase 1 test evidence

## Static and unit gates

| Gate | Command/result |
| --- | --- |
| Frozen install | `pnpm install --frozen-lockfile` PASS; lockfile unchanged |
| Secret scan | `bash infra/release/secret-scan.sh` PASS |
| Monorepo lint | `pnpm lint` PASS |
| Monorepo typecheck | `pnpm typecheck` PASS |
| Monorepo build | `pnpm build` PASS; API and Web |
| SOFIA focused suite | 14 suites, `68/68` tests PASS |
| New contract/boundary subset | 5 suites, `43/43` tests PASS |

## Isolated integration

Run `run-20260801234529-fc69c46b` used new images from exact code HEAD `071a3123cf45749e5b118ba243212ba3c1241cae`, a uniquely named PostgreSQL database on a non-operational port, synthetic fixtures, and no external providers.

- Source migrations: `32`; migrate deploy/status: PASS, schema up to date.
- Contracts: `12/12` PASS.
- RBAC: `70/70` PASS.
- Core operational E2E: PASS for Caja, POS, Delivery, Inventory, audit, rollback, concurrency and idempotent recovery.
- Runtime safety: real send OFF, Auto Reply OFF, Auto Safe OFF, production OFF, PAID forbidden, send attempts `0`.
- Playwright: PASS.
- Cleanup: containers `0`, volumes `0`, networks `0`.

The generated run directory was summarized here and removed from the working tree as regenerable evidence. No production database, volume, session, provider, or customer data was mounted.

## Production observation

No deployment occurred. Existing production API, readiness, Web, Nginx, PostgreSQL and 32/32 migrations remained healthy with zero container restarts.
