# Phase 00 implementation map

| Area | Files | Result |
| --- | --- | --- |
| Restore safety | `infra/scripts/backup.sh`, `restore.sh`, `common.sh`, metadata helper | unique paths/DB, traps, production rejection, migration identity |
| Runtime configuration | `apps/api/src/config/env.ts` | sanitized production fail-closed validation |
| Provider selection | payment and WhatsApp factories/providers | mocks restricted to tests |
| Route isolation | Sofia, payment webhook, QR controllers and test-only guard | sandbox/dev handlers unavailable outside tests |
| Mutation isolation | Sofia agent/service | fake fee and sandbox order conversion blocked |
| Frontend surfaces | Sofia sandbox, mock payment, QR controls | production-facing test surfaces removed |
| Verification | Jest and Node test files | direct production-isolation and restore tests |

