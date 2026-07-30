# Claude Handoff Gate

## Status

**BLOCKED**.

No stable base commit was created. The current HEAD does not contain the validated 32-migration source, and the working tree includes owner changes that R1 explicitly forbids committing or discarding.

## Candidate Base

- Base commit: NONE.
- Recommended branch: claude/admin-frontend-purge.
- Separate worktree permitted now: NO.

## Production Closure Files

Release-only paths and partial-hunk candidates are enumerated in commit-plan.md. No path was staged.

## Files Claude Must Not Modify

- prisma/schema.prisma and both uncommitted migrations.
- apps/api/src/modules/sofia/**.
- apps/web/src/app/(app)/sofia/**.
- apps/web/src/features/sofia/**.
- apps/api/src/modules/whatsapp/**.
- shared package manifests and pnpm-lock.yaml.
- current release, recovery and production-closure evidence.

## Unblock Condition

Create an owner-approved, independently tested Sofia/CRM changeset that includes its schema, migrations and implementation, then reclassify shared files. Only after the repository has an exact clean commit may Claude start from that SHA in a separate worktree.
