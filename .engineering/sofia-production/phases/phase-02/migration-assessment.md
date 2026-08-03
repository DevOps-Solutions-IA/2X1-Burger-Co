# Phase 2 migration assessment

## Decision

`MIGRATION_REQUIRED: YES`

Implementation of a reusable secure command core requires durable atomic claim, lifecycle, approval and replay state. Existing models are domain-specific and cannot safely be overloaded:

- `AuditLog` is append-only evidence and has no unique idempotency constraint.
- `WaiterOrderSyncReceipt` belongs to waiter order synchronization.
- WhatsApp and payment event tables bind provider events, not authenticated human commands.
- `SofiaOrderDraft` represents commercial draft content and has no command lifecycle or approval relation.

No migration is created in this discovery. Owner authorization is required before schema implementation.

## Proposed models

### `SofiaCommand`

Purpose: canonical command identity, policy binding, lifecycle and current terminal result reference.

Proposed fields:

- `id`, `commandType`, `status`
- `scopeKey` for tenant/location boundary using existing location convention
- `idempotencyKeyDigest`, `inputDigest`, `inputSchemaVersion`
- `actorId`, `actorRoleSnapshot`, `source`
- `targetType`, `targetId`, `expectedVersion`
- `approvalId` nullable
- `releaseSha`, `requestId`, `correlationId`
- `createdAt`, `expiresAt`, `claimedAt`, `completedAt`, `updatedAt`
- `leaseOwnerDigest`, `leaseExpiresAt`
- `failureClass`, `reasonCode`
- `version` integer for command CAS

Constraints/indexes:

- Unique `(scopeKey, commandType, idempotencyKeyDigest)`.
- Index `(status, leaseExpiresAt)` for recovery.
- Index `(targetType, targetId, createdAt)` for aggregate conflict review.
- Index `(actorId, createdAt)` and `(expiresAt, status)`.
- Foreign key to `User` with `onDelete: SetNull` if repository policy permits historical actor preservation.

### `SofiaCommandAttempt`

Purpose: immutable execution-attempt history and lease ownership.

Proposed fields: `id`, `commandId`, `attemptNumber`, `executorDigest`, `startedAt`, `leaseExpiresAt`, `finishedAt`, `outcome`, `failureClass`, `reasonCode`, `releaseSha`, `resultDigest`.

Constraints/indexes: unique `(commandId, attemptNumber)`; index `(commandId, startedAt)`; index `(outcome, startedAt)`.

### `SofiaCommandApproval`

Purpose: explicit human authorization bound to one sanitized command intent.

Proposed fields: `id`, `commandType`, `scopeKey`, `inputDigest`, `targetType`, `targetId`, `expectedVersion`, `requestedById`, `approvedById`, `status`, `requiredPermission`, `source`, `createdAt`, `expiresAt`, `decidedAt`, `reasonCode`, `version`.

Constraints/indexes: unique active approval reference; index `(status, expiresAt)`; index `(approvedById, decidedAt)`; command relation must prevent reuse across a different digest/target/source.

### `SofiaCommandResult`

Purpose: sanitized deterministic replay envelope separated from operational entities.

Proposed fields: `id`, `commandId @unique`, `schemaVersion`, `resultCode`, `resultDigest`, `sanitizedPayload`, `createdAt`, `retentionUntil`.

Constraints/indexes: unique `commandId`; index `retentionUntil`. Payload must be schema-validated and size-bounded.

## Lifecycle

Proposed states:

- `RECEIVED`: durable envelope created.
- `VALIDATED`: schema, actor, source, target and policy validated.
- `APPROVAL_REQUIRED`: risk policy requires a human decision.
- `APPROVED`: valid scoped approval attached.
- `CLAIMED`: one executor owns a bounded lease.
- `EXECUTING`: authoritative domain adapter entered.
- `SUCCEEDED`: committed mutation and replay result exist.
- `FAILED`: terminal/retryable/unknown failure classified.
- `REJECTED`: policy, authorization or conflict rejected execution.
- `EXPIRED`: command or approval exceeded expiry.
- `COMPENSATION_REQUIRED`: reserved for a later authorized external-effect phase.
- `COMPENSATED`: reserved terminal evidence after approved compensation.

The compensation states should exist only if the separately authorized implementation includes an external side effect. For the first database-only order command slice, they may be omitted to keep the schema minimal.

## Retention and privacy

- Command envelope/attempt metadata: proposed 400 days to align with operational audit review, subject to owner/legal confirmation.
- Approval evidence: proposed 400 days or longer if financial policy requires it.
- Result payload: shortest useful period, proposed 90 days, then retain digest/status only where permitted.
- PII classification: actor ID and target IDs are restricted operational identifiers; free text, full phone, address, prompt and raw model/provider payload are forbidden.
- Encryption: use existing database encryption controls; field-level encryption is required only if later schemas prove restricted PII unavoidable. Prefer not storing it.

## Rollout and rollback

- Additive nullable tables/enums only; no changes to existing 32 migrations.
- Deploy schema before runtime code uses it.
- Keep `OrderCreationService` blocked until command-core production verification and separate owner authorization.
- Rollback application by disabling the feature flag and returning to blocked adapter; retain additive tables for evidence.
- Dropping tables is not part of rollback.
- Zero-downtime assessment: feasible if migration is additive, indexes are created with reviewed lock impact, and no backfill is required.

## Authorization gate

Before implementation, owner must approve exact Prisma schema, migration SQL, retention, enum/state subset, release strategy and rollback. `migrationAuthorized` remains `false`.

## Authorized implementation result

The owner authorized one additive migration. The resulting schema uses four bounded models (`SofiaCommand`, `SofiaCommandApproval`, `SofiaCommandAttempt`, `SofiaCommandResult`) and four enums. It adds no columns or constraints to existing operational tables, performs no backfill, and leaves `AuditLog.idempotencyKey` non-unique. Fresh ephemeral deployment reached `33/33`; production remains `32/32` and was not touched.
