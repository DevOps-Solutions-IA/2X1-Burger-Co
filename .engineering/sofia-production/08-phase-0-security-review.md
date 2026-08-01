# Phase 0 security review

| Attack path | Control in candidate | Test | Result |
| --- | --- | --- | --- |
| Attacker calls mock payment webhook | test-only controller guard plus provider mutation rejection | route metadata and fake webhook test | PASS candidate |
| Attacker calls mock WhatsApp endpoint | test-only controller guard | guard wiring test | PASS candidate |
| Attacker replays inbound message | existing idempotency/audit retained | regression inspection | RETAINED |
| Attacker selects mock provider | factories reject mock outside test | provider tests | PASS candidate |
| Operator misconfigures production env | fail-closed sanitized startup validation | env tests | PASS candidate |
| Fake fee reaches an order | delivery conversion rejects outside test before Prisma | no-persistence test | PASS candidate |
| Sandbox conversation appears operational | sandbox processing and conversion blocked | isolation test | PASS candidate |
| Simulated outbound reaches a customer | mock provider unavailable outside test; real-send guards retained | provider/runtime tests | PASS candidate |

No authentication, permission, signature, idempotency, audit, allowlist, or kill-switch control was removed. Final production verification is blocked because the principal image has not been redeployed with this candidate.

