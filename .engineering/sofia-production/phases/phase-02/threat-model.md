# Phase 2 secure command threat model

Threat count: **17**.

| ID | Threat | Precondition | Impact | Current control | Gap | Phase 2 control | Test strategy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | Duplicate command delivery | Client/provider retries same request | Duplicate order or financial effect | Domain-specific unique keys | No generic command key | Atomic scoped command claim | Concurrent duplicate integration test |
| T02 | Replay after success | Valid key is resent | Repeated side effect or divergent response | Waiter/webhook paths replay locally | SOFIA has no stored result | Persist sanitized terminal result and replay it | Replay same command after success |
| T03 | Concurrent execution | Two workers claim same command | Double mutation | Unique constraints in selected domains | No command lease/claim | Unique claim plus compare-and-set lifecycle | Barrier-based two-worker test |
| T04 | Stale draft | Draft changes after approval | Wrong items/customer/total | Phase 1 compares `updatedAt` | Read-before-action is not atomic | Bind expected draft version and revalidate in mutation transaction | Mutate draft between approve/claim |
| T05 | Stolen approval reference | Approval ID is disclosed/reused | Unauthorized mutation | No reusable approval object | No scope, hash, expiry or actor binding | Approval bound to command, payload, approver, permission and expiry | Cross-command and cross-actor reuse tests |
| T06 | Actor mismatch | Same key submitted by another user | Privilege confusion | Waiter sync checks receipt owner; audit context prevents in-request replacement | No generic durable actor binding | Store actor ID/roles snapshot; reauthorize current actor | Replay by different actor |
| T07 | Source mismatch | Command moves from sandbox/internal to production source | Sandbox action becomes operational | Runtime source and mock isolation gates | Source not bound to durable command | Immutable source/scope in command fingerprint | Same key with changed source |
| T08 | Tampered payload | Payload changes under same idempotency key | Different action accepted as replay | Some provider signatures/hashes | No command canonical input hash | Versioned canonicalization and sanitized SHA-256 | Key reuse with one-field mutation |
| T09 | Partial transaction failure | DB error after some writes | Inconsistent state/audit | Core order/checkout paths use transactions | Not universal; governance and some audits separate | Domain mutation plus command state/audit in coordinated transaction | Inject failure at each write boundary |
| T10 | Audit failure | Audit insert unavailable | Untraceable mutation | Audit can share transaction when supplied | Not enforced everywhere | Mutating command fails/rolls back if mandatory audit fails | Force audit insert failure |
| T11 | Database timeout | Claim or mutation times out | Unknown ownership/result | Prisma transaction rollback where connection survives | No command unknown-result classification | Attempt lease and explicit retryable/unknown failure states | Timeout before/after commit simulation |
| T12 | Outbound side effect before commit | Provider call occurs before durable state | Customer receives action that DB denies | Real send currently blocked | No generic outbox contract | Prohibit provider call in DB transaction; future transactional outbox | Architecture test plus provider spy |
| T13 | Retry after unknown result | Network/worker failure hides provider response | Duplicate external action | Provider idempotency keys on selected adapters | Reconciliation policy not generic | `UNKNOWN_EXTERNAL_RESULT` classification under FAILED/compensation policy; no blind retry | Provider accepts then times out |
| T14 | Kill switch during execution | Switch activates after validation | Action executes despite emergency stop | Runtime safety evaluates on demand | No second mandatory check/lease invalidation | Recheck before authoritative mutation/external intent | Activate switch between claim/execute |
| T15 | Expired command | Delayed worker executes old intent | Stale or unwanted mutation | Payment links/memory have local expiry | Commands have no expiry | Persist `expiresAt`; reject before claim and execution | Clock-controlled expiration tests |
| T16 | Privilege escalation | Prompt or caller requests higher-risk tool | Unauthorized operational action | JWT, RolesGuard, Phase 1 allow-listed contracts | No durable policy/approval decision per command | CommandPolicyService derives permission from server registry, never prompt | Adversarial prompt and direct API tests |
| T17 | Secret or PII leakage | Input/result/audit contains sensitive fields | Privacy/security breach | Audit redaction and sanitized DTOs | Command/result storage not defined | Allow-listed envelopes, hash sensitive input, result redaction and retention | Secret corpus and phone/address redaction tests |

## Security invariants

- Prompt content never selects permissions or bypasses policy.
- Existing domain services remain authoritative.
- A model-facing layer never receives Prisma clients, provider secrets or raw provider payloads.
- Mutation success is derived only from committed backend state.
- Audit and command records contain hashes or sanitized fields, not raw credentials or unrestricted PII.
- Phase 0 pause, kill switch, mock isolation, webhook verification and payment fail-closed controls remain mandatory.
