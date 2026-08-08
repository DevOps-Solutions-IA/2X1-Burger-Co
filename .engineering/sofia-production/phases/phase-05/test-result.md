# Phase 05 test result

Validated locally on runtime SHA `bb362fafa9c03e649ff8a979b531ffbd9e0e07fa` with isolated PostgreSQL 16:

- Frozen install: PASS.
- Production dependency audit: PASS, no known vulnerabilities.
- Secret scan: PASS; values were not printed.
- Prisma format/validate: PASS.
- Fresh migration deploy: PASS, 36/36.
- Representative legacy restore and migration: PASS; row counts unchanged and temporary resources removed.
- API/Web/E2E lint: PASS.
- API/Web/E2E typecheck: PASS.
- API and Web production builds: PASS.
- Phase 5 focused suite: PASS, 6 suites and 58 tests on the final runtime SHA.
- Concurrency: PASS for checkout, intent/link, ticket, and webhook idempotency.
- Signed online webhook to kitchen and ticket: PASS.
- Verified intent to `SalePayment` binding: PASS.
- Invalid signature, unknown reference, amount/currency/account mismatch, provider failure, terminal checkout payment, unknown result, and double success: PASS/fail-closed.
- Phase 0-4 regression and critical integration: PASS, 92/92 tests.
- RBAC source gate: PASS, 267 routes classified, 0 unclassified.
- Ephemeral DB guard: PASS, 9/9 tests.
- Core ephemeral E2E: PASS, run `run-20260808210544-3b3414a8`; contracts, role checks, POS, delivery, inventory, audit and operational reconciliation passed.
- Recovery drill: PASS, run `run-20260808210841-55996707`, RPO 0 seconds and RTO 12.852 seconds.
- Ephemeral cleanup: PASS; no run containers or networks remain.
- Local generated logs/evidence were preserved outside the Git worktree at `/home/wundah/inventario-audit-artifacts/sofia-phase5-20260808` and were not committed.

The initial focused rerun exposed PostgreSQL `40001` wrapped as Prisma `P2010`; bounded retry handling was corrected and the unchanged concurrency scenario then passed. No test was skipped or weakened.

One E2E invocation stopped before startup because local artifacts did not match HEAD and the CI-only build variable was absent. It created no runtime resources. The exact CI equivalent with `EPHEMERAL_BUILD_IF_MISSING=true` then passed; both attempt records were preserved.
