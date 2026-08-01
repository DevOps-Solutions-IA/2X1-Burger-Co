# Expected Schema Fingerprints

Both schemas were reconstructed from an empty PostgreSQL 16 container without
persistent volumes. The container was removed after capture.

| Frontier | Migrations | Canonical records | SHA-256 |
| --- | ---: | ---: | --- |
| production-equivalent | 29 | 1,354 | `22d4768d7c26a20b2b92f0a200cc1379f068ecc1a410a355825f825df7258780` |
| current repository | 32 | 1,552 | `8067afd72d408416dd93411a2d701cb1178386725cb19de4efe540259e03fe80` |

The 198 net new objects at frontier 32 are attributable to the audit v2 and CRM
migrations. Three existing payment-setting column records change only because
their defaults become fail-closed.
