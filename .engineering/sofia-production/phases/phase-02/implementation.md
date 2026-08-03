# Phase 2 implementation

## Core

`SecureCommandModule` provides immutable execution context, policy, scoped idempotency, conflict resolution, durable approval, lifecycle validation, result storage, audit coordination and a dedicated Prisma repository adapter. Orchestration has no Prisma dependency and no provider, AI, WhatsApp, payment or OrdersService dependency.

Implemented lifecycle states are `RECEIVED`, `VALIDATED`, `APPROVAL_REQUIRED`, `APPROVED`, `CLAIMED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `REJECTED` and `EXPIRED`. Legal transitions are explicit; terminal and illegal transitions fail closed. Compensation states were intentionally omitted because Phase 2 enables no external or operational handler.

## Safety

Policy runs at receive, before approval, before claim and immediately before handler execution. It revalidates the persisted actor, current roles/permissions, source allowlist, target binding, expected version, release, expiry, approval, governance pause, kill switch and runtime safety.

Only `SOFIA_INTERNAL_VALIDATE` is enabled, and it is non-operational. All operational command identifiers return `SOFIA_COMMAND_POLICY_BLOCKED`. No controller or public route was added, and no existing SOFIA mutation path was activated.

## Recovery

Same-key identical input returns persisted state/result. Conflicting bindings are rejected. Expired claims may be recovered only before handler entry and under policy. An unknown post-entry outcome is terminal and non-retryable pending manual reconciliation. Results contain only sanitized codes, bounded payloads and reference IDs.
