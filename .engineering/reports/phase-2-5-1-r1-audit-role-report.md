# Phase 2.5.1-R1 - Audit Role Remediation

## Decision

**NO-GO**. The `RBAC_DENIED.actorRole` defect is fixed and the audit contract passes its focused and core E2E gates. The complete phase gate remains blocked because the recovery regression exhausted three iterations on stale migration-count assumptions and no clean release commit or digest rollback could be produced from the mixed working tree.

## Root Cause

The request middleware created AsyncLocalStorage before authentication. Passport then populated `request.user`, but `RolesGuard` executed before `AuditContextInterceptor`; therefore RBAC denial auditing received an explicit actor ID while ALS still had no effective role. The detailed trace is in `phase-2-5-1-r1-root-cause.md`.

## Applied Design

- `RolesGuard` hydrates the central audit context from the validated Passport principal before evaluating roles.
- `AuditContextService.setActor()` is monotonic: it rejects actor replacement and role escalation inside the same request.
- Client headers cannot set actor role or audit source.
- `JwtAuthGuard` records unauthenticated denial with an explicit system-safe identity rather than inventing a user role.
- Recovery, checkout, Delivery commercial/location changes, sales conversion and inventory consumption/returns now persist their audit event in the business transaction.
- Null phone metadata remains null; existing values continue to be masked centrally.

## Gate Results

| Gate | Result | Evidence |
| --- | --- | --- |
| RBAC denied actorRole | PASS | `evidence/phase-2-5-1-r1/artifact/smoke/*/core-operational-results.json` |
| Trusted role source | PASS | Guard/context unit tests and forged-header E2E |
| ALS concurrency isolation | PASS | Concurrent-role unit tests and 3 E2E runs |
| Fresh migration 30 | PASS | Three E2E runs and `migration-drill/result.json` |
| Upgrade 29 to 30 | PASS | `migration-drill/result.json` |
| Legacy rows | PASS | Migration drill and core query API |
| Audit query API | PASS | 3 E2E runs |
| Transactional audit | PASS | Source integration and core operational E2E |
| Audit reconciliation | PASS | `audit-reconciliation.json` |
| Repeatability | PASS, 3/3 | iteration-2 plus repeatability runs 2 and 3 |
| API typecheck/build | PASS | `regression/api-*.log` |
| Web typecheck/build | PASS with existing warnings | `regression/web-*.log` |
| Delivery Phase A | PASS, 11/11 | `regression/delivery-phase-a-final.log` |
| Critical suite | PASS, 91/91 | `regression/critical-rerun.log` |
| Artifact smoke | PASS | `artifact/smoke.log` |
| Secret/activation scan | PASS, zero findings | `security/summary.txt` |
| Resource cleanup | PASS, zero resources | `security/resources.txt` |
| Recovery regression | FAIL after 3 iterations | `recovery*.log` |
| Clean artifact | FAIL | Working tree is mixed; candidate is `dirtyBuild=true` |
| Rollback by digest | NOT DEMONSTRATED | Candidate is not production-eligible and recovery gate failed |

## Recovery Iterations

| Iteration | Result | Root cause | Cleanup |
| ---: | --- | --- | --- |
| 1 | FAIL | Recovery source reconciliation required hardcoded 29 migrations. | PASS, zero resources |
| 2 | FAIL | Compose readiness still declared 29 migrations. | PASS, zero resources |
| 3 | FAIL | `restore-smoke.mjs` still asserted 29 migrations. | PASS, zero resources |

Backup, restore and logical reconciliation were already equal in iterations 2 and 3. The failure is nevertheless binding because the application-on-restore smoke did not complete. Per loop policy, no fourth remediation was attempted.

## Artifact

| Field | Value |
| --- | --- |
| Build ID | `0.1.0-66c54785f6d1-phase24-ca4d7b81adf5` |
| Source snapshot | `ca4d7b81adf5` |
| API digest | `sha256:93e198ba6ef55597e7ac4fb653933a3889a4a0bd29f7c9ea394f6a066d852589` |
| Web digest | `sha256:34617d8b7cea6681ebb1c1dad155042eb926fb2e29af393bfaa070c36400aa60` |
| Dirty build | `true` |
| Production eligible | `false` |

No local commit was created because shared Caja, Orders, Delivery and framework files contain inseparable changes from earlier phases. Committing them as R1 would create a contaminated changeset.

## Safety

- Operative database touched: **NO**.
- Production modified: **NO**.
- Real WhatsApp: **OFF**.
- Push: **NO**.
- Secret patterns: **0**.
- Real activation patterns: **0**.
- Orphan containers, volumes and networks: **0**.

## Residual Blockers

1. Replace the remaining hardcoded migration count in `infra/recovery/restore-smoke.mjs` with the runtime/source expectation and rerun recovery.
2. Separate and commit the accumulated working tree by domain.
3. Build a clean release artifact from that commit and execute rollback by digest.
4. Keep Phase 2.6 blocked until these internal gates pass.
