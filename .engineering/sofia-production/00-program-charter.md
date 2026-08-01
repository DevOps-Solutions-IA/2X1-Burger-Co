# SOFIA production program charter

- Phase: PHASE-00
- Owner: 2X1 Burger Co.
- Review date: 2026-08-01
- Code relationship: `apps/api/src/modules/sofia`, `apps/web/src/features/sofia`, and `infra/scripts`
- Status: implemented candidate, production deployment pending

## Purpose

Establish a recoverable production baseline and make sandbox or mock mechanisms impossible to select outside the test runtime. Phase 0 does not authorize real outbound WhatsApp, automatic replies, production SOFIA, payments, orders, or Phase 1.

## Gates

The candidate must pass backup recovery, migration identity, lint, typecheck, build, secret scan, focused isolation tests, and runtime health. Final GO additionally requires deploying and verifying the controls in the principal runtime; branch-level evidence alone is insufficient.

