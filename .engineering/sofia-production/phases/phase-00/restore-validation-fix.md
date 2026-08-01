# Phase 0 Restore Validation Hardening

Date: 2026-08-01
Status: PASS
Decision: READY_FOR_OWNER_MIGRATION_AUTHORIZATION

## Scope

The repository backup/restore workflow was hardened and an encrypted production
backup was restored only into an isolated temporary database. No production
migration, restore, seed, schema edit, or migration-history write occurred.

## Implementation

- Backup creation records a checksum-bound metadata sidecar containing the
  migration count and digest observed both before and after `pg_dump`.
- Restore validation requires checksums for both encrypted data and metadata.
- Decryption uses a unique protected directory and refuses a pre-existing
  output path.
- Validation databases use a unique protected namespace and remain within the
  PostgreSQL 63-byte identifier limit.
- Production database identity is explicitly rejected as a validation target.
- `EXIT`, `INT`, `TERM`, and `HUP` cleanup removes the validation database,
  container copy, and local plaintext.
- Restored migration identity is compared with backup-time metadata. It is not
  compared with the repository's later 32-migration frontier.
- Database names are validated and database existence checks compare against a
  read-only catalog listing.

## Backup Evidence

| Field | Sanitized result |
| --- | --- |
| file | `backup-inventory_fastfood_system-20260801-014912.dump.gpg` |
| encrypted | PASS |
| size | 1,468,218 bytes |
| created UTC | `2026-08-01T06:49:15Z` |
| SHA-256 | `1dd882d85e9de356b993072751e031f83ad75fbfcc3fa00ce290b2f004220e65` |
| metadata checksum | PASS |
| backup migration count | 29 |
| backup migration digest | `f2a8b679d8cd59bcc7172e1d94e2266f587c5750361e0598a7d03386659e6f38` |
| database identifier | redacted SHA-256 identifier recorded |

The previous encrypted backup was preserved.

## Restore Evidence

| Gate | Result |
| --- | --- |
| checksum attestation recorded | PASS |
| restore script hardened | PASS |
| GPG decryption | PASS |
| temporary database created | PASS |
| backup restore | PASS |
| backup migration identity 29 | PASS |
| temporary database cleanup | PASS, zero remaining |
| plaintext cleanup | PASS, zero remaining |
| production untouched | PASS, still 29 applied migrations |
| API health | PASS, HTTP 200 |
| web health | PASS, HTTP 200 |
| nginx health | PASS, HTTP 200 |
| database health | PASS |

The first live validation attempt exposed an unsupported `psql -c` variable
substitution before database creation. Cleanup completed with zero residual
resources. The corrected implementation uses a read-only catalog listing. A
subsequent validation succeeded. A PostgreSQL identifier truncation warning was
then removed by bounding generated names; the final validation completed
without warnings and cleaned all resources.

## Tests

`node --test infra/release/restore-validation.test.mjs infra/release/release-safety.test.mjs`

- 10 passed
- 0 failed
- 0 skipped

Coverage includes metadata tampering, production-name rejection, successful
cleanup, failed-restore cleanup, interrupted cleanup, pre-existing plaintext
refusal, identifier length, portable checksums, and runtime identity.

`bash infra/release/secret-scan.sh`: PASS. No secret values were printed or
recorded.

## Remaining Boundary

Production remains at 29 of 32 migrations. `prisma migrate deploy` was not run.
The next safe step is a separate owner authorization for the reviewed pending
migration deployment. Phase 1 remains unauthorized.
