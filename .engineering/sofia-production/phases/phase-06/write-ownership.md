# Phase 06 write ownership

Discovery agents are read-only. Runtime edits have not started.

| Owner | Exclusive scope |
| --- | --- |
| P6-DOMAIN | Isolated order and delivery lifecycle policies and focused tests |
| P6-LOCATION | Isolated logistical location policies and focused tests |
| P6-NOTIFY | Isolated notification intent/policy modules and focused tests |
| P6-HANDOFF | Isolated consent/handoff policies and focused tests |
| P6-RECOVERY | Isolated complaint classification/recovery policies and focused tests |
| P6-CONCURRENCY | Isolated idempotency/concurrency policies and focused tests |
| LEAD | Prisma schema/migrations, module wiring, central contracts, controllers, `OrdersService`, `SofiaAgentService`, shared repositories and cross-domain integration |

Phase 7 agents remain read-only until Phase 6 is merged. No two agents may edit the same authoritative file concurrently.
