# Phase 1 architecture boundary

## Automated gate

`domain-contracts.architecture.spec.ts` fails if agent/controller orchestration imports `PrismaService`, creates operational order/delivery/cash/stock/sale records, removes the blocked order result, or weakens Phase 0 mock-provider rejection.

## Static result

- Direct Prisma runtime files before: `20`
- Direct Prisma runtime files after: `19`
- `SofiaAgentService` Prisma references: `0`
- `SofiaController` Prisma references: `0`
- Direct `WhatsappDeliveryOrder.create` in SOFIA orchestration: `0`
- Direct `OrderTicket.create` in SOFIA orchestration: `0`
- Unresolved orchestration violations: `0`
- Circular dependencies introduced: `0`

The 19 remaining files are explicitly classified in `direct-prisma-audit.md`. They are bounded persistence, provider, maintenance, governance, safety, or read-model adapters. This count is not represented as zero because direct Prisma remains valid inside those infrastructure boundaries.

## Mutation boundary

Draft create/update/confirm remains non-operational. Optimistic version checks use the persisted `updatedAt` identity. Caller totals and prices are not contract inputs; `SofiaService.buildItemsSnapshot` resolves persisted catalog values. The order command has no implementation that can return success in Phase 1.
