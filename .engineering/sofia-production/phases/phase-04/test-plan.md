# Test plan

The local CI mirror follows `.github/workflows/ci.yml`: frozen install, dependency audit, secret scan, lint, typecheck, API/Web build, Prisma validation/migrations, focused Phase 4 semantics, architecture, Phase 0-3 regression, RBAC, critical integration, immutable artifacts, core E2E and isolated recovery.

Focused coverage includes phrase variants, adversarial input, payment/fulfillment combinations, exact totals, multiple products, modifiers, location semantics, discount governance, deterministic hashes, expiry, stale/concurrent updates and duplicate confirmation.
