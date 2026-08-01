# Phase 1 implementation

## Identity

- Base: `6119b7a6d1c84948840a2603d8650126f2933f5d`
- Discovery: `71520096c9117f59c1675561fbabd1174c5419c7`
- Implementation code HEAD: `071a3123cf45749e5b118ba243212ba3c1241cae`
- Production deployment: not executed
- New migrations: `0`

## Delivered boundaries

Nine neutral application contracts define explicit, sanitized DTOs and token-based injection. No contract exports Prisma models, Decimal values, provider payloads, credentials, or unvalidated metadata. Domain adapters delegate to existing authoritative services.

`SofiaAgentService` now consumes catalog, product availability, recipe availability, draft, and blocked order-creation contracts. Product prices are persisted backend values. Direct conversation/message/draft persistence used by the agent moved to `SofiaAgentRepository`.

The existing `createDeliveryOrderFromDraft` compatibility method no longer creates `WhatsappDeliveryOrder`. It fails immediately in production with the Phase 0 reason code and otherwise records a blocked policy decision. The neutral `OrderCreationService` validates draft/version/idempotency inputs and always returns `SOFIA_ORDER_CREATION_BLOCKED` or a stricter validation error. No `OrderTicket`, sale, stock, cash, payment, or outbound-message effect is possible.

## Dependency graph

Before: `OrdersModule -> SofiaModule`; SOFIA orchestration queried Prisma directly. Adding `SofiaModule -> OrdersModule` would have created a cycle.

After: `SofiaModule -> DomainContractsModule -> owning domain modules`. SOFIA-specific contract adapters remain inside `SofiaModule`. `SofiaModule` does not import `OrdersModule`; no `forwardRef` was added. The existing one-way dependency remains until a later explicitly authorized extraction.

## Scope controls

- Real WhatsApp: OFF
- Auto reply / Auto Safe production: OFF
- Payment mutation: not added
- Operational order creation: blocked
- Production data/runtime: untouched
- Phase 2: unauthorized
