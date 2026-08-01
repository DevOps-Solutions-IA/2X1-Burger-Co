# Production Schema Fingerprint

Production was queried in a read-only transaction. No row values were
captured. Canonical records include public tables, columns, types, nullability,
defaults, primary/foreign/unique constraints, indexes, enums, sequences,
non-internal triggers, and extensions, sorted with the C locale.

| Metric | Value |
| --- | --- |
| SHA-256 | `22d4768d7c26a20b2b92f0a200cc1379f068ecc1a410a355825f825df7258780` |
| canonical records | 1,354 |
| extensions | 1 |
| enum labels | 136 |
| tables | 60 |
| columns | 763 |
| constraints | 154 |
| indexes | 240 |
| sequences | 0 |
| non-internal triggers | 0 |
| migration frontier | 29 |

The fingerprint equals the isolated expected-29 fingerprint exactly.
