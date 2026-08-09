# Phase 06 migration assessment

Status: `OWNER_AUTHORIZATION_REQUIRED`.

No migration has been created. Source remains at 36 migrations.

Independent domain, notification, recovery and concurrency audits agree that migration 37 is required. Existing tables cannot safely provide atomic operational transitions, a restart-safe notification outbox and durable complaint recovery without becoming duplicate authorities.

## Proposed migration

Suggested name: `20260809xxxxxx_sofia_live_operations_recovery_core`.

Target: exactly one migration, 36 to 37. No SQL has been generated.

### New enums

- `NotificationIntentStatus`: `PENDING`, `SUPPRESSED`, `CLAIMED`, `COMMAND_PENDING`, `DISPATCHED`, `SUCCEEDED`, `FAILED`, `UNKNOWN_RESULT`, `EXPIRED`.
- `CustomerServiceCaseCategory`: `LATE_ORDER`, `WRONG_ITEM`, `MISSING_ITEM`, `COLD_FOOD`, `QUALITY`, `PAYMENT_PROBLEM`, `DELIVERY_PROBLEM`, `OTHER`.
- `CustomerServiceCaseStatus`: `OPEN`, `HUMAN_REQUIRED`, `HUMAN_TAKEN`, `RESOLVED`, `CLOSED`.

### New models

`DeliveryWorkflowEvent` is append-only evidence, not current-state authority:

- `id`, `orderTicketId`, `version`, `idempotencyKey`.
- nullable `fromStatus`, required `toStatus` using existing `DeliveryWorkflowStatus`.
- `actorId`, `reasonCode`, sanitized `metadata`, `createdAt`.
- unique `(orderTicketId, version)` and `(orderTicketId, idempotencyKey)`.
- indexes `(orderTicketId, createdAt)` and `(toStatus, createdAt)`.
- restrictive order relation; no cascade deletion of evidence.

`NotificationIntent` is a channel-independent outbox, not notification truth:

- `id`, `eventType`, `sourceEventId`, `aggregateType`, `aggregateId`, `aggregateVersion`.
- optional `customerId`, `conversationId`.
- `channel`, `purpose`, sanitized `factEnvelope`, `factHash`.
- policy outcome/reason plus nullable consent and handoff versions.
- `status`, `attempts`, nullable claim owner hash, lease expiry, next retry, expiry, completion and last sanitized error code.
- nullable unique `outboundMessageId` and `secureCommandId` bindings.
- `version`, `createdAt`, `updatedAt`.
- unique `(sourceEventId, channel, purpose)`.
- indexes `(status, nextRetryAt, leaseExpiresAt)`, `(aggregateType, aggregateId, aggregateVersion)` and `(conversationId, createdAt)`.

`CustomerServiceCase` is the canonical complaint/recovery case:

- `id`, `category`, `status`, `source`, `sourceReference`, `evidenceHash`, sanitized `summary`.
- optional bindings to customer, conversation, order checkout, order ticket, payment intent and delivery issue.
- optional assigned actor, resolution actor and resolution code.
- `version`, `createdAt`, `updatedAt`, nullable `resolvedAt` and `closedAt`.
- unique `(source, sourceReference)`.
- indexes `(status, createdAt)`, `(category, status)`, `(customerId, createdAt)`, `(orderTicketId, status)` and `(conversationId, status)`.

`CustomerServiceCaseEvent` is append-only case evidence:

- `id`, `caseId`, `version`, `idempotencyKey`, `action`, nullable `fromStatus`, required `toStatus`.
- optional actor, `reasonCode`, sanitized `metadata`, `createdAt`.
- unique `(caseId, version)` and `(caseId, idempotencyKey)`.
- restrictive case relation.

### Existing model additions

- `OrderTicket.deliveryWorkflowVersion Int @default(0)` and reverse event relation.
- `DeliveryLocationInbox.sourceEventKey String? @unique`, `payloadHash String?`, `version Int @default(0)`.
- `DeliveryIssue.idempotencyKey String?`, `version Int @default(0)`, unique `(orderTicketId, idempotencyKey)`.
- Prisma-required nullable/reverse relations only on `Customer`, `WhatsappConversation`, `OrderCheckout`, `OrderTicket`, `PaymentIntent`, `DeliveryIssue`, `WhatsappOutboundMessage`, `SofiaCommand` and `User`.

## Resilience additions proposed in the same owner gate

Phase 7 read-only pre-work found a critical restart defect: a Bold webhook row can exist before its payment transition is applied, and replay currently treats any existing row as completed. To avoid knowingly carrying this activation blocker beyond migration 37, add nullable/default-safe claim fields to existing inboxes:

- `PaymentWebhookEvent`: `processingAttempts Int @default(0)`, nullable `processingLeaseOwnerHash`, `processingLeaseExpiresAt`, `nextRetryAt`, `resultCode`, `deterministicResult`, `lastErrorCode`, plus `retryable Boolean @default(false)`. Index `(processedStatus, nextRetryAt, processingLeaseExpiresAt)`.
- `WhatsappInboundEvent`: `processingAttempts Int @default(0)`, nullable `processingLeaseOwnerHash`, `processingLeaseExpiresAt`, `nextRetryAt`, `lastErrorCode`, plus `retryable Boolean @default(false)`. Index `(processingStatus, nextRetryAt, processingLeaseExpiresAt)`.

These fields do not authorize retries of financial unknown results. They support leased processing, deterministic replay, bounded recovery and manual review.

## Provider provenance

The schema currently defaults two provider fields to `"mock"`. Production code must always provide explicit provenance. Authorization is requested for `ALTER COLUMN ... DROP DEFAULT` on those two columns, with no historical row rewrite. Existing rows remain unchanged and must be counted by preflight; ambiguous rows are not normalized or deleted automatically.

## Preflight

Before SQL creation or application, record read-only counts for:

- order tickets grouped by delivery workflow status and revision;
- duplicate candidate delivery event identities if derivable;
- location inbox rows grouped by match status and missing source identity;
- open delivery issues and duplicate same-order summaries;
- webhook rows by processed status, null event ID and unapplied payment transition;
- inbound rows stuck in `CLAIMED`/`FAILED` and rows missing deterministic result;
- rows whose provider equals `mock`, grouped by table and operational/historical status;
- customer/conversation/order/payment bindings needed by service cases.

Any ambiguous financial webhook already acknowledged without its transition is an incident gate, not migration data to repair automatically.

## DDL character

- Create three enums and four tables.
- Add nullable or default-safe columns and foreign keys.
- Create scoped unique constraints and query indexes.
- Drop two unsafe column defaults only; retain all historical values.
- No table/column drop, rename, delete, update, backfill, cascade evidence deletion or historical migration modification.

## Data impact

- Existing rows survive unchanged.
- New version fields start at zero only where a safe default is required.
- Existing location, issue, webhook and inbound rows remain readable and are treated as legacy/non-replayable until classified by runtime policy.
- No production data mutation or backfill is authorized.

## Rollout

1. Read-only preflight.
2. Prisma format/validate and manual SQL review.
3. Fresh PostgreSQL 37/37.
4. Representative legacy restore and compatibility checks.
5. Fault-injection, replay, concurrency and restart suites.
6. PR review and CI. Production migration/deployment remain separate owner gates.

## Rollback

Application rollback must tolerate the additive schema. Do not down-migrate or delete event evidence. If application validation fails before production, discard only the ephemeral database. Any future production rollback keeps migration 37 and disables workers/handlers through runtime gates.

Location and handoff hardening otherwise reuse existing persistence. `SofiaCommand`, `WhatsappOutboundMessage`, `AuditLog`, `OperationalAlert` and `CustomerInteraction` remain reusable evidence/dispatch components, but none safely replaces the proposed outbox or service-case authority.
