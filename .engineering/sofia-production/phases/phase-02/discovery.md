# SOFIA Phase 2 discovery

## Baseline

- Repository: `DevOps-Solutions-IA/2X1-Burger-Co`
- Branch: `feature/sofia-02-secure-command-core`
- Base: `cfe10b7175676ba2822369bbc19aea73417f3736`
- Production executable: `0c2c2cbc88cadba2304f32079641c77e25e499cb`
- Production migrations: `32/32`
- Scope: read-only discovery and design. Runtime implementation and migrations are not authorized.

PR #5 was verified as documentation-only and merged as `cfe10b7175676ba2822369bbc19aea73417f3736`. Production was not rebuilt or restarted. The documented source/runtime SHA difference is intentional and limited to documentation.

## Executive finding

The repository has strong domain-specific controls, but no reusable secure command execution core. Idempotency exists for WhatsApp inbound/outbound events, payment webhooks and waiter synchronization. Optimistic concurrency exists for selected order mutations. Request identity and sanitized audit context exist. Governance pause and the kill switch are persisted. These mechanisms are not a durable command claim/result protocol and cannot safely be composed by SOFIA for future operational mutations.

Phase 1 remains fail-closed. `BlockedSofiaOrderCreationAdapter.createFromSofiaDraft` in `apps/api/src/modules/sofia/contracts/sofia-contract.adapters.ts:72` validates draft identity, confirmation state, version and idempotency-key syntax, records a blocked event, and always returns `SOFIA_ORDER_CREATION_BLOCKED`. It creates no order, sale, stock movement, cash movement or outbound message.

## Verified mechanisms

| Capability | File and symbol | Verified behavior | Phase 2 limitation |
| --- | --- | --- | --- |
| HTTP request identity | `apps/api/src/modules/audit/audit-context.service.ts`, `AuditContextService.createHttpContext` | Creates sanitized request, correlation and trace IDs; carries source, actor, idempotency key and release version | In-memory request context is not a durable command record |
| Actor immutability | `AuditContextService.setActor` | Rejects actor replacement and role escalation inside one request | No actor binding across retries or approvals |
| RBAC | `apps/api/src/common/guards/roles.guard.ts`, `RolesGuard.canActivate` | Evaluates roles/permissions and audits denied access | Endpoint authorization is not durable command authorization |
| Audit persistence | `apps/api/src/modules/audit/audit.service.ts`, `AuditService.log` | Sanitizes values and can write with a supplied transaction client | `AuditLog.idempotencyKey` is indexed, not unique; no command claim/result |
| Transaction-aware audit port | `apps/api/src/modules/audit/audit-command.adapter.ts`, `AuthoritativeAuditCommandAdapter.record` | Can reuse an existing domain transaction | Caller must supply transaction; no enforcement that every command does so |
| Governance pause | `apps/api/src/modules/sofia/governance/sofia-governance.service.ts`, `pauseGlobal`/`resumeGlobal` | Persists a global pause in `Setting` and writes audit evidence | Setting update and audit are separate writes |
| Kill switch | `SofiaGovernanceService.activateKillSwitch`/`deactivateKillSwitch` | Persists emergency state and keeps other gates intact | No command lease cancellation or in-flight transition protocol |
| Runtime policy | `apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.service.ts`, `evaluate` | Blocks production actions, real send, auto reply, auto safe and WhatsApp PAID | Decision is evaluated at a point in time; not bound to a command row |
| WhatsApp inbound deduplication | `apps/api/src/modules/sofia/sofia-whatsapp.service.ts`, `processInboundWebhook` | Uses unique provider event/hash and message idempotency keys; duplicate returns are deterministic enough for inbound ingestion | Processing spans later writes and is not a generic command lifecycle |
| WhatsApp outbound deduplication | `WhatsappOutboundMessage.idempotencyKey @unique` in `prisma/schema.prisma` | Prevents duplicate outbound records | Provider side effect and DB status can still have unknown-result windows |
| Payment webhook deduplication | `apps/api/src/modules/sofia/sofia-payment-link.service.ts`, `processPaymentWebhook` | Verifies signature, reserves trusted event ID and processes known events transactionally | Limited to provider events; invalid and unknown paths have different transaction boundaries |
| Waiter sync idempotency | `apps/api/src/modules/orders/orders.service.ts:2017`, `syncWaiterOrder` | Unique `clientMutationId`, actor ownership check, transactional mutation and receipt replay | Result is an order reference only and applies solely to waiter sync |
| Order concurrency | `OrdersService.update`, `replaceItems`, `syncWaiterOrder` | Uses `updateMany` with optional `expectedRevision` and returns conflict when stale | Optional in several DTOs; `revision` is technical, not the delivery commercial version |
| Checkout transaction | `apps/api/src/modules/orders/orders.service.ts:2735`, `checkout` | Sale, stock/payment effects, order PAID, table release and audit run in one Prisma transaction | External/realtime effects occur after commit; no reusable command result record |
| Operational alerts | `OperationalAlert` in `prisma/schema.prisma`; order/SOFIA alert services | Persists and publishes operational warnings | Alert is not command ownership, timeout or compensation state |
| Release identity | release manifest plus `AuditContextService.releaseVersion` | Health/readiness validates release identity; audit stores release version | No command row binds execution to the release that claimed it |

## Critical gaps

The following were verified as absent from the current schema and runtime:

1. Persistent reusable command idempotency store.
2. Atomic command claim plus sanitized input fingerprint.
3. Persisted deterministic replay result.
4. General command lifecycle and attempt history.
5. Approval record scoped to command, actor, source, target and payload hash.
6. Durable draft-version, actor and source binding.
7. Per-command release/source SHA binding.
8. Structured failure class distinguishing retryable, terminal and unknown-result failures.
9. Compensation ownership/state.
10. Command timeout owner and lease expiry.
11. Command expiration.
12. Cross-request concurrent command conflict prevention.
13. Enforced transaction-aware audit for every state mutation.
14. Dedicated command result redaction and retention.

## Scope boundary

Phase 2 design does not authorize order creation, real WhatsApp, payment mutation, stock/cash/sale mutation, or autonomous customer responses. It does not replace domain services or create a generic workflow engine. Any schema change requires separate owner authorization.

## Implementation closure

The owner subsequently authorized one additive migration. The implementation preserves every discovery boundary: only a closed, non-operational validation handler is enabled; all eight operational command types remain blocked; and no SOFIA order, sale, payment, stock, cash or outbound path was enabled. The verified implementation baseline is `1eb939c11d2131f9ca8b42ded15476b4c1f44318` before the evidence-only commit.
