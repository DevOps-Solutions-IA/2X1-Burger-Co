# Phase 2 implementation plan

## Objective

Implement a narrow secure command execution core that can later guard one allow-listed operational command. This plan does not authorize that command, migrations, real WhatsApp, payment mutation or autonomous operation.

## Components

### `CommandExecutionContext`

Immutable value object containing command ID, actor/roles, source, scope, request/correlation IDs, target aggregate, expected version, approval reference, release SHA, idempotency digest, input digest and expiration. Constructed only from authenticated backend context and validated DTOs.

### `SecureCommandService`

Coordinates receive, validation, approval decision, claim, authoritative adapter execution and terminal result persistence. It owns no business rules and receives no Prisma client. It returns persisted backend truth, never model-authored success.

### `CommandPolicyService`

Maps allow-listed command types to permission, risk, approval, expiry and safety requirements. Re-evaluates RBAC, governance pause and kill switch at validation, claim and immediately before mutation.

### `CommandIdempotencyService`

Canonicalizes the envelope, computes digests, atomically claims a scoped key, resolves same-payload replay, rejects changed-payload reuse and manages bounded leases.

### `CommandApprovalService`

Creates and resolves explicit human approvals. It verifies approver permission and binds approval to command type, digest, target, expected version, source and expiry. Approval references are one-purpose and non-transferable.

### `CommandAuditService`

Writes mandatory sanitized lifecycle evidence through `AuditCommandService`. Mutation audit must share the authoritative transaction where supported. It never stores raw prompt/provider payload or secrets.

### `CommandResultStore`

Persists schema-versioned sanitized terminal results and hashes. It supports deterministic replay without querying mutable operational state as a substitute for the original result.

### `CommandConflictResolver`

Maps unique-key, stale aggregate, active lease, expired approval, policy and unknown-result failures to stable reason codes. It does not retry automatically.

## Dependency rules

```text
SOFIA orchestration
  -> SecureCommandService
     -> CommandPolicyService
     -> CommandIdempotencyService (command repository port)
     -> CommandApprovalService (approval repository port)
     -> allow-listed Phase 1 domain contract
     -> CommandAuditService
     -> CommandResultStore

Domain adapters
  -> authoritative domain services
  -> domain-owned transaction
```

Forbidden dependencies:

- LLM/orchestration to `PrismaService`.
- Secure command core to provider SDKs.
- Command persistence adapters to business calculation logic.
- Generic metadata or arbitrary tool names selected by prompts.
- Network side effects inside DB transactions.

## Proposed implementation sequence

1. **Schema review gate**: finalize minimal models, enum states, SQL lock analysis, retention and rollback. No code until separately authorized.
2. **Persistence slice**: additive migration, repository ports/adapters, atomic claim and replay tests against ephemeral PostgreSQL.
3. **Policy/context slice**: immutable execution context, command registry, RBAC/source/release/expiry validation and governance checks.
4. **Approval slice**: scoped approval creation/decision/expiry with actor separation where policy requires.
5. **Execution slice**: execute a deterministic test-only fake domain command to verify state transitions, failures and concurrency. Fake provider must be test-only and impossible to select in production.
6. **Audit/result slice**: transaction-aware lifecycle evidence, strict result schemas, redaction and retention hooks.
7. **Blocked order integration**: route `OrderCreationService` through the core but retain final production policy block. No `OrderTicket` creation in this phase unless separately authorized later.
8. **Failure injection**: duplicate requests, two workers, stale draft, DB timeout, crash after claim, audit failure, kill switch race and unknown result.
9. **Release gates**: architecture tests, Phase 0/1 regressions, migration 0-to-current and 32-to-current, recovery/rollback, clean artifact and canary.

## Acceptance criteria

- Same key/same fingerprint returns one persisted result.
- Same key/different fingerprint is blocked.
- Only one concurrent executor receives a valid lease.
- Actor, source, target, version, approval and release are immutable and validated.
- Expired/stolen approvals are rejected.
- Audit failure prevents a database mutation from committing where audit is mandatory.
- Kill switch/pause prevents unstarted effects and is rechecked before mutation.
- No secrets, prompt text, raw provider payload or unrestricted PII are persisted.
- No production order, sale, stock, cash, payment or outbound mutation is enabled.
- Phase 0 and Phase 1 security/architecture gates remain green.

## Explicitly excluded

- Generic workflow engine.
- Arbitrary tool execution.
- Real WhatsApp send or automatic reply.
- Payment mutation/refund.
- Autonomous order creation.
- Direct stock/cash/sale changes.
- Migration implementation before owner approval.

## Execution status

Steps 1-6 and the fail-closed architecture gates were implemented under the explicit owner authorization. Step 7 remains blocked rather than integrating order creation. Steps involving operational handlers, external sends, production migration or deployment remain excluded and require later authorization.
