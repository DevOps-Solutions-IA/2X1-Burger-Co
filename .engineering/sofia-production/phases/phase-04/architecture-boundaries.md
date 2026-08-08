# Architecture boundaries

`SofiaAgentService` routes explicit transactional turns through `CommercialCheckoutService`. The orchestrator imports no `PrismaService`; persistence is isolated in `PrismaCommercialRepository`. Domain facts cross typed Phase 1 contracts.

Customer wording now crosses a presentation-only boundary: immutable typed facts are composed through the existing Sofia AI provider abstraction and validated before use. The composer cannot parse intent, call tools, execute commands or mutate state. Deterministic safe templates remain the mandatory fallback.

Specialized Phase 3 flows (catalog questions, configured offers, customer complaints, previous-order memory and controlled AI tests) are not displaced. No operational service or provider is imported by the commercial core.
