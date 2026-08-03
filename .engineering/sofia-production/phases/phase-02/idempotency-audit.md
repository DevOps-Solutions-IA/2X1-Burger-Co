# Phase 2 idempotency audit

## Existing controls

| Mechanism | Durable key | Claim atomicity | Deterministic replay | Actor binding | Payload binding | Expiry | Scope |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WhatsApp inbound event | Provider event ID or provider+event hash | Database unique insert | Duplicate status/existing message | No human actor | Event hash | No | Inbound integration only |
| WhatsApp message | `WhatsappMessage.idempotencyKey` | Database unique insert | Existing message lookup | No | Derived inbound hash | No | Message only |
| WhatsApp outbound | `WhatsappOutboundMessage.idempotencyKey` | Database unique insert | Existing queue record | Approval fields exist but are not key-bound | Response/body hash contributes to key | Retry timestamp, no command expiry | Outbound message only |
| Payment webhook | `PaymentWebhookEvent.eventId` | Trusted valid event insert in transaction | Duplicate ignored | Provider, not human | Signature plus parsed provider event | No | Payment webhook only |
| Waiter sync | `WaiterOrderSyncReceipt.clientMutationId` | Receipt inserted in order transaction | Returns stored order relation | `userId` checked | No input hash | No | Waiter order sync only |
| Delivery receipt send | Audit-derived semantic key described in `docs/delivery-phase-a-frozen.md` | Audit lookup plus send flow | `alreadySent` behavior | Actor in audit | Order/revision in key | No | Frozen delivery receipt flow |
| Audit context | Header idempotency key | Not a claim | None | Actor context exists | No | Request lifetime | Observability only |
| SOFIA blocked order command | Caller key syntax | None | Always recomputes and blocks | Actor included in audit | No canonical input hash | No | Phase 1 blocked adapter |

## Verified gaps

- There is no `SofiaCommand` or equivalent generic command table.
- No unique constraint combines command type, tenant/location scope and idempotency key.
- No atomic state transition claims a command for one executor.
- No persisted canonical input hash rejects key reuse with a different payload.
- No persisted sanitized result supports byte-stable or schema-stable replay.
- No attempt/lease record identifies timeout ownership or permits safe recovery after a worker crash.
- No command expiration policy exists.
- No generic actor/source/approval/release binding exists.
- No common classification separates terminal failure, retryable failure and unknown external result.
- `AuditLog.idempotencyKey` is indexed but not unique and therefore cannot enforce execution semantics.

## Required semantics

1. Canonicalize a versioned command envelope and hash only sanitized, schema-approved input.
2. Claim with a unique scoped key in the same transaction that creates the initial command record.
3. If the key exists with the same fingerprint, return current or terminal persisted state.
4. If the key exists with a different fingerprint, return `SOFIA_COMMAND_IDEMPOTENCY_CONFLICT`.
5. Bind actor, source, target aggregate, expected version, approval reference and release identity.
6. Use a bounded lease for `CLAIMED`/`EXECUTING`; lease recovery must create a new attempt, never overwrite history.
7. Persist a sanitized result envelope and hash before reporting success.
8. Never blindly retry an external side effect after an unknown result; move to manual reconciliation or compensation-required state.
9. Re-evaluate governance pause, kill switch and authorization at claim and immediately before the authoritative mutation.
10. Keep domain-specific unique constraints as defense in depth.

## Proposed conflict outcomes

| Condition | Outcome |
| --- | --- |
| Same key, same fingerprint, terminal success | Replay stored sanitized result |
| Same key, same fingerprint, active valid lease | Return in-progress command identity; do not execute |
| Same key, same fingerprint, expired lease with no external side effect | Claim a new attempt under policy |
| Same key, different fingerprint | Permanent idempotency conflict |
| Expected aggregate version differs | Stale-version conflict before mutation |
| Approval scope/hash differs | Reject approval; require new approval |
| Result of external side effect unknown | No automatic replay; manual reconciliation |
| Kill switch/pause becomes active | Reject before side effect or record controlled interruption |

## Implemented result

- Scoped uniqueness is enforced by `(scope, commandType, idempotencyKey)`; the stored key is a digest, not the caller value.
- Identical retries return the persisted command/result and never re-enter the handler.
- Actor, source, target and payload mismatches return dedicated sanitized conflict codes.
- Claims use optimistic command versioning plus unique `(commandId, attemptNumber)` attempts and bounded leases.
- An expired pre-execution lease may be recovered once under policy. An expired `EXECUTING` lease is classified `UNKNOWN_RESULT`, terminal and non-retryable.
- Concurrent integration testing proved a single claimant and deterministic replay.
