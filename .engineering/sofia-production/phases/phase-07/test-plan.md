# Phase 7 test plan

Status: EXECUTED_LOCALLY_REMOTE_CI_PENDING

## Required validation

1. Verify clean candidate identity, final SHA, changed-file scope and migration directory count.
2. Run frozen install/dependency audit, lint, API/Web typecheck and API/Web build using the CI workflow versions.
3. Run Prisma format/validate and apply all 37 migrations to a fresh ephemeral PostgreSQL database. Do not reset or alter any shared/production database.
4. Run focused unit/contract suites for environment validation, safe remote asset fetch, auth refresh concurrency, SecureCommand separation, operational backlog/alerts, observability guards, QR ownership/reconnect, distributed WhatsApp rate limit, notification lease renewal, provider health and outbound safety.
5. Run payment reachability tests proving retired legacy routes return the expected terminal response and produce no checkout, intent, link, transition, sale, cash or stock mutation.
6. Run architecture checks proving one payment authority, one Baileys socket authority, no direct provider send from legacy/worker paths, and no production mock provider registration.
7. Run PostgreSQL concurrency and fault-injection tests for refresh rotation, QR fencing, inbound rate limiting and notification claim loss/recovery.
8. Run critical integration and isolated E2E suites with production/real-send/automatic flags false.
9. Run secret scan and the prohibited-activation flag scan with sanitized output.
10. Build immutable artifacts and SBOMs from the final SHA; record digests only after successful execution.
11. Execute encrypted backup validation and an isolated restore drill; record RPO/RTO only after successful execution.
12. Run remote CI on the exact final SHA and link the PR/check evidence.

## Acceptance

All required checks must be successful with zero unresolved critical/high findings
and no production side effects. Exact commands, counts and artifact evidence are
recorded in `test-result.md`; remote CI remains the final merge gate.
