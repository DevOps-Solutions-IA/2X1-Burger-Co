# Migration checksum attestation

## Scope

This control accepts one immutable, owner-authorized `FILE_ONLY_DRIFT` identity while preserving fail-closed validation for every other migration-history discrepancy.

## Bound identity

- Migration: `0001_initial`
- Repository checksum: `243a52df85ce3db511c692443b8e1ac385acf64ea1593a92826fe3ca9efa443d`
- Production-recorded checksum: `6bd1cbeb053d2ef72182258a85deedfd01e7f6a7be5add33667342db18893f87`
- Classification: `FILE_ONLY_DRIFT`
- Forensic evidence commit: `aec3c0df6c7d963f54afa3e08b52d35761600199`
- Verified frontier: 29 migrations
- Structural differences at that frontier: 0
- Owner authorization reference: `SOFIA_PHASE_0_FILE_ONLY_DRIFT_ACCEPTANCE_2026-08-01`

The immutable manifest is maintained in `infra/release/migration-attestations.json`, embedded in the release manifest, and validated through a strict literal schema. Missing, malformed, generalized, renamed, or checksum-altered attestations fail closed.

## Runtime evidence

Production readiness on candidate `b8269f5f51fed784533bb535e4ffd6c38c0c5ae6` reported:

- Applied/expected migrations: `32/32`
- `migrationIdentityVerified`: `true`
- `migrationIdentityExact`: `false`
- `migrationIdentityStatus`: `MIGRATION_FILE_ONLY_DRIFT_ATTESTED`
- Attestation count: `1`
- Sanitized evidence reference: `aec3c0df6c7d963f54afa3e08b52d35761600199`

No migration file, production migration record, or production schema was modified by this remediation.
