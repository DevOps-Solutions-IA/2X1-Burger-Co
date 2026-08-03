# Phase 2 transaction and concurrency audit

## Domain transaction map

| Workflow | Transaction boundary | Concurrency control | Audit atomicity | Side effects after commit | Finding |
| --- | --- | --- | --- | --- | --- |
| Order create | `OrdersService.create` Prisma transaction | Retries order-number unique conflicts | Audit inside transaction | Alerts and realtime | Strong domain transaction; no generic command receipt |
| Order update | `OrdersService.update` Prisma transaction | Optional `expectedRevision` CAS | Audit inside transaction | Alerts/realtime | Safe when expected revision supplied; command contract must require it |
| Replace order items | `OrdersService.replaceItems` Prisma transaction | Optional `expectedRevision` CAS | Audit inside transaction | Receipt/realtime flow follows domain rules | Delivery commercial version differs from technical revision |
| Waiter sync | `OrdersService.syncWaiterOrder` Prisma transaction | Unique client mutation ID plus optional revision | Audit occurs after transaction | Alerts/realtime | Durable dedup is good; audit failure cannot roll back order |
| Checkout | `OrdersService.checkout` Prisma transaction | Closed-order and open-cash checks; no generic command key | Audit inside transaction | Alerts/realtime | DB effects atomic; retry after unknown response lacks command replay |
| Payment webhook | `SofiaPaymentLinkService.processPaymentWebhook` transaction for valid recognized event | Unique trusted event ID | Payment events in transaction; audit behavior varies by branch | No PAID mutation allowed | Strong webhook-specific protection, not reusable command execution |
| WhatsApp inbound | Event/message unique writes and later processing | Provider/hash unique constraints | Multiple audit writes | Agent processing/outbound queue | Partial processing and retry semantics are integration-specific |
| Governance setting | Setting upsert, then audit | Last write wins | Not atomic | None | Audit failure can leave changed governance state without event |
| Blocked SOFIA order command | Draft read then audit then throw | Timestamp comparison only | Blocked audit persists | None | Correctly fail-closed, but no command transaction |

## Optimistic concurrency findings

- `OrderTicket.revision` is incremented by several operational changes. The frozen delivery contract explicitly states it is technical and not the commercial receipt version.
- `SofiaOrderDraft` has no explicit integer version. Phase 1 exposes `updatedAt.toISOString()` as its version and performs a read-before-action comparison.
- Waiter sync can atomically combine `expectedRevision` with a unique mutation receipt.
- SOFIA command execution needs an explicit expected aggregate version field but must use each domain's authoritative version semantics rather than assuming every aggregate uses `revision`.

## Audit findings

- `AuditService.log` supports a transaction client and redacts secret, credential, card, session and phone-shaped fields.
- `AuthoritativeAuditCommandAdapter.record` preserves actor, source, request and correlation identity and can receive an opaque transaction context.
- Several important domain paths already audit in their transaction, but this is convention rather than an enforced command invariant.
- Governance writes and waiter-sync audit demonstrate non-atomic audit paths.
- Command result payloads need a stricter allow-listed schema before persistence; generic `before`/`after` JSON is not a result store.

## External side-effect boundary

No future secure command may hold a database transaction open across WhatsApp/provider network calls. The safe pattern is:

1. Validate and claim command transactionally.
2. Execute database-only authoritative command transactionally with audit.
3. Persist an outbox intent in that same transaction when an external effect is authorized.
4. Dispatch separately with its own unique provider key and attempt record.
5. Persist provider result or classify as unknown; never infer success from timeout.

Phase 2 must not activate an outbox or external send. This is a design boundary for later separately authorized capabilities.
