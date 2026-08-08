# Architecture boundaries

`SofiaAgentService` routes explicit transactional turns through `CommercialCheckoutService`. The orchestrator imports no `PrismaService`; persistence is isolated in `PrismaCommercialRepository`. Domain facts cross typed Phase 1 contracts.

Specialized Phase 3 flows (catalog questions, configured offers, customer complaints, previous-order memory and controlled AI tests) are not displaced. No operational service or provider is imported by the commercial core.
