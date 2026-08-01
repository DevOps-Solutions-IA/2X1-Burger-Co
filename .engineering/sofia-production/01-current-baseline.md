# Current production baseline

- Repository: `DevOps-Solutions-IA/2X1-Burger-Co`
- Branch: `feature/sofia-00-governance`
- Origin/main and rollback base: `9aa3c5a90699673eb8dfc2ccac84489c5c0030c5`
- Rollback tag: `sofia-phase-0-baseline-20260801-052534`
- Recorded: 2026-08-01 (America/Bogota)
- Production migrations: 32/32
- API, web, nginx, PostgreSQL: healthy
- Principal runtime: unchanged by application deployment

The production database migration deploy was owner-authorized and completed using only `prisma migrate deploy`. No migration file or `_prisma_migrations` row was manually edited. The running application image predates the Phase 0 isolation controls.

