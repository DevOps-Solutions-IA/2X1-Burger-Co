# Owner Review Proposal - FILE_ONLY_DRIFT

## Required Reconciliation

Do not alter `_prisma_migrations` and do not run `migrate resolve`. Preserve the
historical production checksum and accept the following immutable baseline
attestation:

- production checksum identifies an unrecovered historical file;
- repository checksum identifies the only Git version;
- both histories produce the identical 29-frontier schema fingerprint;
- all later applied migration checksums match;
- the three pending migrations were proven deployable in isolation even with
  file-only drift present.

## Proposed Command Sequence - Do Not Execute Without Owner Approval

1. Revalidate branch, tag, runtime health, the two 29-frontier fingerprints,
   pending SQL checksums, and zero active migration processes.
2. Create a fresh encrypted backup with `infra/scripts/backup.sh`; verify its
   SHA-256 and archive structure.
3. Validate that backup in a unique isolated database using the hardened
   validation-only restore path; expect 29 migrations at backup time.
4. Capture pre-deploy row counts for products, orders, customers, sales and
   audit logs without recording row contents.
5. Print the sanitized three-migration execution plan and lock budget.
6. Execute only `prisma migrate deploy --schema prisma/schema.prisma` using the
   authorized production environment.
7. Verify 32/32, schema fingerprint, runtime health, data counts, fail-closed
   payment settings and logs.
8. On failure, stop application promotion; use the encrypted backup and
   rollback runbook under explicit owner authorization.

## Preconditions

Owner must explicitly accept the file-only checksum attestation and authorize
the production deploy. Restore validation hardening must be implemented and
tested before the backup/deploy sequence. No command in this document was
executed against production.
