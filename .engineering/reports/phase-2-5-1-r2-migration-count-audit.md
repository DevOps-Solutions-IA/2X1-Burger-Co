# Phase 2.5.1-R2 - Audit of migration expectations

## Scope

The audit covers executable recovery, ephemeral testing, readiness, release metadata, CI-facing scripts, and tests. Historical evidence remains immutable and is not treated as executable configuration.

| File | Previous value/source | Correct source | Risk | Action |
| --- | --- | --- | --- | --- |
| `infra/recovery/restore-smoke.mjs` | Literal `29` | Runtime expectation derived from Prisma migration sources | Restore could be valid but reported failed after any new migration | Replaced with validated `EPHEMERAL_EXPECTED_MIGRATION_COUNT` |
| `infra/recovery/run-ephemeral-recovery-drill.sh` | Independent `find` count | Shared schema expectation resolver | Logic could drift from release/test tooling | Uses `infra/schema/migration-expectation.mjs` |
| `infra/testing/run-ephemeral-e2e.sh` | Independent `find` count | Shared schema expectation resolver | E2E and recovery could disagree | Uses the shared resolver |
| `infra/release/generate-release-manifest.mjs` | Independent directory listing | Shared schema expectation resolver | Artifact compatibility metadata could diverge | Uses shared latest migration |
| `infra/recovery/build-test-artifacts.sh` | Literal schema compatibility migration | Shared schema expectation resolver | Test artifact could claim an obsolete schema | Compatibility version is derived dynamically |
| `apps/api/src/modules/health/health.service.ts` | Environment-provided count | Release/harness-provided dynamic expectation | Safe when producer is authoritative | Kept; readiness remains fail-closed on mismatch |
| `apps/api/src/modules/health/health.service.spec.ts` | Values `29` and `30` | Explicit test fixtures | None; values test compatible/incompatible states | Kept as non-functional fixtures |

## Single source

`infra/schema/migration-expectation.mjs` validates every migration directory, requires `migration.sql`, derives count/latest/fingerprint, and can compare expected migrations with applied rows. It accepts the repository's legacy `0001_initial` convention and current timestamp-based names.

## Validation gate

- Dynamic fixtures with 29, 30, and 31 migrations.
- Missing migration SQL fails closed.
- Missing, failed, and unexpected applied migrations are incompatible.
- Exact applied set is compatible.
- Current repository resolves 30 migrations and the latest v2 audit migration.

Functional constants for migration totals after remediation: **zero**.
