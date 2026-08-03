# Phase 2 schema review

## Change summary

| Item | Result |
| --- | --- |
| Models added | `SofiaCommand`, `SofiaCommandApproval`, `SofiaCommandAttempt`, `SofiaCommandResult` |
| Enums added | command status, approval status, attempt outcome, failure class |
| Existing models altered | None |
| Historical migrations altered | None |
| Data backfill | None |
| Destructive SQL | None |
| Production data mutation | None |

The command unique key is scoped by `(scope, commandType, idempotencyKey)`. Attempts are unique by `(commandId, attemptNumber)`, approvals have an immutable unique audit identity, and each command has at most one replay result. Lifecycle, target, actor, correlation, expiry, lease and retention indexes support bounded operational queries.

Actor identifiers and domain references are restricted operational identifiers. Caller payloads, prompts, secrets, credentials, provider payloads and full customer PII are not stored. Payload and policy bindings are SHA-256 digests; result JSON passes recursive redaction before persistence.

## Zero-downtime and rollback

The migration creates only new enums, tables, indexes and foreign keys. It has no backfill or table rewrite on existing data. Expected locks are catalog locks for new-object creation only. Application rollback leaves the unused additive tables in place; dropping tables is not part of rollback.
