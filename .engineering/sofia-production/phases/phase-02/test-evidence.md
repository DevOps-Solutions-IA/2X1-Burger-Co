# Phase 2 test evidence

All commands used isolated synthetic configuration. Production was not migrated, seeded or deployed.

| Gate | Result |
| --- | --- |
| Frozen install | PASS |
| Secret scan | PASS |
| Workspace lint | PASS |
| Workspace typecheck | PASS |
| Workspace build | PASS |
| Prisma validate | PASS |
| Fresh migration deploy/status | PASS, `33/33` |
| Command unit/architecture/migration tests | PASS, `47/47` |
| Secure-command integration | PASS, `10/10` |
| Phase 0/1 regression | PASS, `36/36` |
| Critical API integration | PASS, exit `0`, 92 declared cases |
| Core E2E contracts | PASS, `12/12` |
| Core E2E RBAC | PASS, `70/70` |
| Core E2E Playwright | PASS, `3/3` |
| Core E2E migration identity | PASS, `33/33` |
| Core E2E teardown | PASS, 0 containers, volumes and networks |

An initial invocation of `test:e2e:ephemeral` used its default business-smoke fixture while the configured UI suite expected the core-operational fixture; it produced `2/3` Playwright and cleaned all resources. The repository's intended `test:e2e:core` command was then run and passed all gates. No application change was made to conceal this fixture-selection mismatch.

Integration side-effect assertions showed zero changes to `OrderTicket`, `WhatsappDeliveryOrder`, `Sale`, `InventoryMovement`, `CashMovement`, `SofiaPaymentEvent` and `WhatsappOutboundMessage` for secure-command execution.
