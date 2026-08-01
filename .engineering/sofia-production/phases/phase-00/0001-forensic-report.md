# 0001_initial Forensic Report

Date: 2026-08-01

## Scope and Safety

This analysis used read-only production catalog queries and two PostgreSQL 16
containers without persistent volumes. No production migration, migration
history edit, `migrate resolve`, seed, reset, or application change occurred.

## Result

**Classification: `FILE_ONLY_DRIFT`.**

Production at its 29-migration frontier and an isolated reconstruction of the
same 29 repository migrations produced the identical canonical schema
fingerprint:

`22d4768d7c26a20b2b92f0a200cc1379f068ecc1a410a355825f825df7258780`

The files contain 1,354 identical canonical objects. There is no structural
evidence of a partial `0001_initial` or schema drift at that frontier.

## Sanitized 0001 Metadata

| Field | Value |
| --- | --- |
| migration | `0001_initial` |
| started | `2026-03-26 04:44:53.961606+00` |
| finished | `2026-03-26 04:44:54.195259+00` |
| production checksum | `6bd1cbeb053d2ef72182258a85deedfd01e7f6a7be5add33667342db18893f87` |
| repository checksum | `243a52df85ce3db511c692443b8e1ac385acf64ea1593a92826fe3ca9efa443d` |
| logs | `EMPTY` |
| rolled back | `NO` |
| applied steps | `1` |

Production has 29 completed migration records. The other 28 applied migration
checksums match the repository. Three later migrations are genuinely pending.

## Evidence Chain

1. Git history contains one unique `0001_initial` blob; it does not match the
   production checksum.
2. Production schema was fingerprinted from catalog metadata only.
3. Repository migrations were applied to an isolated empty PostgreSQL at the
   exact production frontier of 29.
4. Production and expected-29 canonical outputs were byte-identical.
5. Applying all 32 in isolation produced the expected current fingerprint and
   only the objects/default changes described by the three pending migrations.
6. An isolated file-drift simulation proved `prisma migrate deploy` can apply
   pending migrations without changing the historical checksum.

## Decision

Owner review is required. The safe proposal preserves the production checksum
and does not rewrite `_prisma_migrations`.
