# Phase 7 test result

Runtime source SHA under final artifact validation:
`60af56e0eb9635152c99437e301a38a76b4f1007`.

| Gate | Result |
| --- | --- |
| Frozen dependency install | PASS |
| Production dependency audit | PASS, 0 known vulnerabilities |
| Secret/prohibited-activation scan | PASS |
| API/Web/E2E lint and typecheck | PASS |
| API/Web build | PASS |
| Prisma format and validate | PASS |
| Fresh PostgreSQL | PASS, 37/37 |
| Representative legacy migration | PASS, 13 authorities preserved, 0 provider rewrites |
| Phase 6 focused regression | PASS, 219/219 |
| Phase 7 focused run 1 | PASS, 253/253 |
| Phase 7 focused run 2 | PASS, 253/253 |
| PostgreSQL concurrency/fault/load | PASS, 41/41 |
| Phase 5 checkout/payment regression | PASS, 15/15 |
| Critical business and RBAC regression | PASS, 92/92 |
| Architecture and production reachability | PASS |
| Exact retained artifact E2E | PASS, `run-20260809131057-1b667d8b`, 19/19 Playwright, cleanup 0 |
| Encrypted backup/restore drill | PASS, `run-20260809132631-4cecf476`, RPO 0s/RTO 13.335s, cleanup 0 |
| Remote GitHub CI | PASS, run `31316328069`, exact head `b16a08aefd447ce680fdbdacd5614ea06763163d` |

## Executed command groups

- Quality gates follow `.github/workflows/ci.yml`: frozen install, production
  audit, secret scan, lint/typecheck/build, Prisma validation and the exact Jest
  selections for Phases 0-7, architecture, RBAC, concurrency and critical flows.
- Fresh migration used `prisma migrate deploy` on a newly created `_test`
  database; no reset or shared database was used.
- Legacy migration used `infra/testing/phase6-legacy-migration.sh` and preserved
  13 authorities with zero provider rewrites.
- E2E used `infra/testing/run-ephemeral-e2e.sh` with the retained API/Web images
  from build `0.1.0-60af56e0eb96-1786280275`.
- Recovery used `infra/recovery/run-ephemeral-recovery-drill.sh` with the same
  artifact record and actual ephemeral GPG encryption/decryption.

The machine-readable command/result summary is `local-ci-summary.json`. No
command targeted production. Production deployment, real Bold, real WhatsApp
send and automatic reply remained false.
