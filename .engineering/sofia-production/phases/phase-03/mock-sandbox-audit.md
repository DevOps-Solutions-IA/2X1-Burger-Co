# Phase 3 mock and sandbox audit

| Path | Classification | Production reachability |
| --- | --- | --- |
| Deterministic provider fakes in specs | TEST_ONLY | No |
| Mock WhatsApp provider | TEST_ONLY / DEV_ONLY | Rejected by production startup validation |
| Sofia sandbox routes | DEV_ONLY with Phase 0 guards | Unavailable in production |
| QR gateway test-send route | TEST_ONLY guarded route | Operational provider also blocks send |
| Hermes provider | Explicit alternate integration only | No fallback from QR gateway |
| Baileys QR adapter | RECEIVE_ONLY candidate | Direct Sofia sending prohibited |

`PRODUCTION_REACHABLE_MOCKS = 0`. Provider selection is explicit and invalid/missing production combinations fail closed; provider errors cannot activate a fake.

