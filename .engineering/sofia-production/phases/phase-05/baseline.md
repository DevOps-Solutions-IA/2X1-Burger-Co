# Phase 05 baseline

- Branch: `feature/sofia-05-order-payment-kitchen`.
- Worktree: `/home/wundah/inventario-sofia-phase5`.
- Base and audit SHA: `c079a0666297336609c0ef0486436371a8d8ec47`.
- Divergence from `origin/main` at creation: `0 0`; tracked worktree clean.
- Starting schema frontier: 35 migrations; Phase 5 owner authorization permits exactly one additive migration to 36.
- Phase 3 merge: `ac4b9e47c1c036cc1234d4ac35ef505cbce4e897`.
- Phase 4 merge: `c079a0666297336609c0ef0486436371a8d8ec47`.

Production actions remain closed. `SofiaRuntimeSafetyService` returns all effective sending/automation/production flags as false and rejects productive actions. Secure-command handlers for order, payment, stock, cash and sale remain blocked. Phase 5 adds separate test-only runtime gates that always reject production. No production deployment is authorized.
