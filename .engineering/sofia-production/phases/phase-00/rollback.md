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
- The earlier failed candidate was rolled back without changing PostgreSQL or migration state.
- API/web/nginx/database health after that rollback: PASS.
- Both blocker remediations were subsequently tested in an isolated canary and promoted as candidate `b8269f5f51fed784533bb535e4ffd6c38c0c5ae6`.
- The retained previous image tags resolve to the recorded digests and the rollback Compose override validates successfully.
- Production remains schema-compatible with both images at 32 migrations; no database rollback is required or authorized.
- Any failed critical gate uses the retained images with `docker compose up -d --no-build api web nginx`, followed by API/web/Nginx/database health verification.

Rollback readiness: PASS. No rollback was required for the remediated candidate.
