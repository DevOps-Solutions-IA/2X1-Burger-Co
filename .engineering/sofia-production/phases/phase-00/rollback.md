# Phase 00 rollback

1. Stop further Phase 0 promotion on any failed critical gate.
2. Preserve logs and the encrypted backup checksum without exposing secrets.
3. Use tag `sofia-phase-0-baseline-20260801-052534` to identify the application baseline.
4. Validate the retained encrypted backup in an isolated database before any production restore.
5. A production database restore requires separate incident authorization and maintenance planning.
6. Do not use `migrate reset`, `db push`, `migrate resolve`, or manual `_prisma_migrations` edits.

The three deployed migrations are additive; this phase does not assert an automatic SQL down migration.

## Deployment drill result

- Previous API image available: `sha256:72c801dccb1b25fdec9a1fd31dec095721b785c7257034a56f90892ead1f2803`.
- Previous web image available: `sha256:6cdd1844221f84ac4bcffc629a332f45374db71a27ea01206af7428ab5d12fe5`.
- Candidate API health failed before promotion completed.
- Compose rollback restored both previous images without changing PostgreSQL or migration state.
- API/web/nginx/database health after rollback: PASS.
- Candidate redeploy was not attempted because both root causes remain unresolved; this is a required NO-GO condition.
