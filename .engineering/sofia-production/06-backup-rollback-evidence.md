# Backup and rollback evidence

## Pre-deployment backup

- File: `backup-inventory_fastfood_system-20260801-022026.dump.gpg`
- Size: 1,468,214 bytes
- SHA-256: `76c2767edeec0bf9a0c2cd8b9c46557876727455bca4fc50bbc8e0b618eb8312`
- Created: `2026-08-01T07:20:29Z`
- Format: encrypted GPG payload
- Database identifier: `[REDACTED_PRODUCTION_DATABASE]`
- Migration identity at backup time: 29

Restore validation decrypted and restored this backup into a unique temporary database. It verified the expected 29-migration identity, removed the temporary database, removed plaintext output, and left production untouched.

## Rollback readiness

- Git rollback tag: `sofia-phase-0-baseline-20260801-052534`
- Tag target: `9aa3c5a90699673eb8dfc2ccac84489c5c0030c5`
- Encrypted pre-deploy backup retained.
- Restore procedure requires an isolated database first; production restoration requires a separate incident authorization.
- No automatic down migration is asserted for the three additive migrations.

