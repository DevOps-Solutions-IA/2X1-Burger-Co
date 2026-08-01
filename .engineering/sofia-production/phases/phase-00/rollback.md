# Phase 00 rollback

1. Stop further Phase 0 promotion on any failed critical gate.
2. Preserve logs and the encrypted backup checksum without exposing secrets.
3. Use tag `sofia-phase-0-baseline-20260801-052534` to identify the application baseline.
4. Validate the retained encrypted backup in an isolated database before any production restore.
5. A production database restore requires separate incident authorization and maintenance planning.
6. Do not use `migrate reset`, `db push`, `migrate resolve`, or manual `_prisma_migrations` edits.

The three deployed migrations are additive; this phase does not assert an automatic SQL down migration.

