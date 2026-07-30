# Phase 2.5.1-R2 - Recovery harness, clean changesets and rollback

## 1. Executive summary

Phase 2.5.1-R2 closes the three internal blockers from R1. Migration expectations are dynamic, recovery passes three times against the clean candidate, source changes are separated into local commits, and canary rollback uses immutable image digests. The decision is **GO CONDICIONADO** because remote release governance and production custody remain owner gates.

## 2. Initial state and protection

- Initial HEAD: `66c54785f6d1383e40f28e66dd825a4db11d6a44`.
- Final candidate HEAD: `c8a82998ef5265f70dc1a1039cab2e9327f8f66d`.
- Non-destructive patch/status backups: `/tmp/phase-2-5-1-r2/`.
- Owner files `.agents/tasks/prd-sofia-ultra-premium.json` and `.claude/scheduled_tasks.lock` were never staged.
- Operative DB, operative containers, production, WhatsApp sessions and real providers were not modified.

## 3. Migration expectation

`infra/schema/migration-expectation.mjs` is the single executable resolver for count, latest migration and SHA-256 fingerprint. Recovery, ephemeral E2E and release manifest use it. Runtime readiness receives the expectation from the artifact/harness and fails closed on mismatch.

| Scenario | Result | Evidence |
| --- | --- | --- |
| 29 migrations fixture | PASS | `migration-expectation-tests.log` |
| 30 migrations fixture | PASS | `migration-expectation-tests.log` |
| Future migration 31 fixture | PASS | `migration-expectation-tests.log` |
| Missing migration SQL | BLOCKED as expected | `migration-expectation-tests.log` |
| Missing/failed/extra applied migration | INCOMPATIBLE as expected | `migration-expectation-tests.log` |
| Current repository | 30; latest audit v2 | `current-schema-expectation.json` |

Functional migration-count constants remaining: **0**. Numeric 29/30 values remain only as explicit test/history data.

## 4. Recovery harness remediation

The restore smoke no longer asserts 29 or assumes a dirty artifact. It validates the expected count and dirty state supplied by the artifact contract. Both recovery and release builders now reserve stdout for the artifact-record path; build logs are persisted separately.

Failure injection covers corrupt/checksum-invalid backup, storage failure, unavailable/slow DB, migration mismatch, runtime restart, SIGTERM and protected-route failure. The schema resolver separately covers missing, failed and extra migrations. Every drill preserves the valid encrypted backup until validation ends and removes run-scoped cryptographic material during teardown.

## 5. Working tree classification

Detailed classification: `phase-2-5-1-r2-working-tree-classification.md`.

| Category | Action | State |
| --- | --- | --- |
| AUDIT_V2 | Dedicated commit | CLEAN |
| RBAC_ROLE_FIX | Dedicated commit | CLEAN |
| CORE_TRANSACTIONAL_AUDIT | Dedicated commit | CLEAN |
| TEST_PLATFORM | Dedicated commit | CLEAN |
| RECOVERY_HARNESS | Dedicated commit | CLEAN |
| RELEASE_INFRA | Dedicated commits | CLEAN |
| ENGINEERING_DOCS | Dedicated commits | CLEAN |
| OWNER_UNRELATED | Left unstaged | PRESERVED |
| GENERATED/HISTORICAL | Left unstaged | PRESERVED |

## 6. Local changesets

| Changeset | Commit | Files | Validation | State |
| --- | --- | ---: | --- | --- |
| Audit contract v2 | `b76f2bc` | 20 | 16 focused tests | PASS |
| Trusted RBAC actor role | `ec1f286` | 3 | 6 guard tests | PASS |
| Core transactional audit | `4be2ff5` | 13 | API typecheck; 11 safety tests | PASS |
| Ephemeral platform | `f52f6eb` | 17 | DB guard 9/9; 254 routes classified | PASS |
| Dynamic recovery schema | `cdce557` | 8 | schema tests 7/7; recovery control | PASS |
| Engineering governance | `6b78b2f` | 65 | content classification | PASS |
| Markdown hygiene | `5aa8c26` | 22 | diff check | PASS |
| Artifact schema identity | `4463392` | 7 | release contract 3/3 | PASS |
| Machine-readable builder | `c8a8299` | 1 | single-line artifact path | PASS |

No push was performed.

## 7. Migration and legacy drill

An isolated PostgreSQL instance applied the first 29 migrations, persisted a legacy audit row, then applied migration 30. The legacy row remained readable as eventVersion 1 with unavailable context represented as null.

| Gate | Result | Evidence |
| --- | --- | --- |
| Fresh schema | 30/30 PASS | Core runs and recovery source migrations |
| Upgrade | 29→30 PASS | `migration-upgrade/result.json` |
| Legacy | readable v1 | `migration-upgrade/result.json` |
| Operative DB | untouched | DB guard and isolated container |

## 8. Regression

Three complete ephemeral runs used distinct databases, ports, networks and evidence directories. Each run executed contracts, RBAC, operational core, runtime safety, Playwright and API regression.

| Run | Contracts | RBAC runtime | API Jest | Core/audit | Cleanup | State |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | 12 | 70 | 156/156 | PASS | 0 resources | PASS |
| 2 | 12 | 70 | 156/156 | PASS | 0 resources | PASS |
| 3 | 12 | 70 | 156/156 | PASS | 0 resources | PASS |

The API regression includes critical, Delivery Phase A and backend RBAC. No `forceExit`, `process.exit`, new skips or operational DB were used. API/web typecheck and build pass. Web build still reports the pre-existing typed-frontend warnings tracked for Phase 2.6.

## 9. Backup, restore and reconciliation

| Recovery run | Backup | Restore/app | Reconciliation | RPO | RTO | Cleanup |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | PASS | PASS | PASS | 0 s controlled | 12.150 s | 0 resources |
| 2 | PASS | PASS | PASS | 0 s controlled | 12.145 s | 0 resources |
| 3 | PASS | PASS | PASS | 0 s controlled | 11.992 s | 0 resources |

Reconciliation compares schema, counts, financial sums, stock totals and logical checksums. The application starts on the restored database and passes readiness, login, protected observability, Caja/POS/Delivery/Inventory read-only and Sofía status.

## 10. Clean artifact

| Artifact | Commit | BuildId | Digest | State |
| --- | --- | --- | --- | --- |
| API | `c8a82998ef52...` | `0.1.0-c8a82998ef52-1784102456` | `sha256:09a557f416d2...` | PASS |
| Web | `c8a82998ef52...` | `0.1.0-c8a82998ef52-1784102456` | `sha256:c156e0bddf18...` | PASS |

- `dirtyBuild=false`.
- OCI revision labels match the commit.
- Both images run as non-root `node`.
- SBOM: CycloneDX, 1074 components.
- Schema identity: 30 migrations plus fingerprint.
- Secret scan: PASS; values were not printed.

## 11. Canary identity and safety

| Runtime | Commit | BuildId | Artifact | Coincides |
| --- | --- | --- | --- | --- |
| API canary | `c8a82998ef52...` | candidate buildId | API digest | YES |
| Web canary | `c8a82998ef52...` | candidate buildId | Web digest | YES |

Readiness reports applied=30, expected=30 and compatible=true. Real send, Auto Reply, Auto Safe, Production and WhatsApp PAID remain false. QR is disabled/disconnected, no real sessions are mounted, and DeepSeek is dry-run with external provider disabled.

## 12. Rollback by digest

| Step | From | To | Duration | State |
| --- | --- | --- | ---: | --- |
| Baseline smoke | baseline digest | baseline | 24 s | PASS |
| Candidate deploy | baseline | candidate digest | 23 s | PASS |
| Rollback | candidate | baseline digest | 24 s | PASS |
| Candidate restore | baseline | candidate digest | 24 s | PASS |

No rebuild and no destructive DB downgrade occurred. Final canary identity is the candidate.

## 13. Security and resources

- Source secret scan PASS.
- No secrets in OCI labels, manifest or SBOM were detected.
- Artifact endpoint exposes only sanitized provenance.
- Final R2 resource scan: containers=0, volumes=0, networks=0 for ephemeral core/recovery projects.
- Operative runtime at its original ports was not restarted or replaced.

## 14. Owner gates and residual risks

| Owner gate | Required | Available | Blocks production |
| --- | --- | --- | --- |
| Remote and protected branch | Yes | No | Yes |
| Remote registry | Yes | No | Yes |
| Required CI | Yes | No | Yes |
| Remote staging and approvals | Yes | No | Yes |
| KMS/secret store/offsite | Yes | No | Yes |
| Buildx signing/attestation | Yes | No | Yes |
| Physical QR/allowlist/provider gates | Later explicit phase | No | Yes |

Additional debt: frontend typing/lint warnings, CSP/dependency hardening, remote observability/alert channel and representative load/soak testing.

## 15. Module score update

| Module | Before | After | Semaforo |
| --- | ---: | ---: | --- |
| API | 96 | 97 | AMARILLO |
| Database | 93 | 96 | AMARILLO |
| Security | 79 | 84 | AMARILLO |
| Testing | 94 | 97 | AMARILLO |
| Deployment | 72 | 82 | AMARILLO |
| Caja | 90 | 92 | AMARILLO |
| POS | 90 | 92 | AMARILLO |
| Delivery | 95 | 96 | AMARILLO |
| Inventory | 88 | 91 | AMARILLO |

## 16. Decision

**ENGINEERING PHASE 2.5.1-R2: GO CONDICIONADO**.

All internal gates requested by R2 pass. Production remains blocked exclusively by documented owner/external gates. Phase 2.6 is the next permitted block; it was not executed.
