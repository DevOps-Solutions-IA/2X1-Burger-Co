# Migration Inventory - Reconciliation

- Source directories: 32.
- Historical clean canary manifest: 30.
- Latest source migration: `20260727133000_sofia_payment_webhook_fail_closed`.
- Source checksums captured outside the repository at `/tmp/production-closure-2026-07-29/migration-checksums.txt`.
- Historical migrations will not be edited, removed or renumbered.

## Verified Results

| Chain | Count | Result |
| --- | ---: | --- |
| Fresh source run 1 | 32 | PASS |
| Fresh source run 2 | 32 | PASS |
| Fresh source run 3 | 32 | PASS |
| Reconstructed baseline | 30 | PASS |
| Upgrade baseline to source | 30 to 32 | PASS |
| Prisma status after each run | 32, no pending migration | PASS |
| Cleanup | four ephemeral databases removed | PASS |

The two source additions are forward-only and valid on both fresh and upgrade paths:

- `20260727130000_sofia_crm_bounded_context`: bounded CRM schema and nullable domain links.
- `20260727133000_sofia_payment_webhook_fail_closed`: safe OFF/NONE payment defaults plus remediation of prior enabled rows.

Readiness no longer trusts a mutable migration count. The release manifest embeds the ordered migration names and Prisma-compatible SHA-256 checksums, and runtime compares that exact inventory against `_prisma_migrations`.

Artifact and canary 32/32 remain pending until a clean candidate commit can be formed. Drill evidence is under `/tmp/production-closure-2026-07-29/migration-drill-185243/`.
