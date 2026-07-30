# Runtime Baseline

| Runtime | Identity | Schema | Health/readiness | Decision |
| --- | --- | --- | --- | --- |
| Operational | API image `sha256:72c801...`, web image `sha256:6cdd18...` | Not proven | Legacy health reports `development`; modern identity absent | NOT READY; untouched |
| Existing canary | Commit `c8a8299`, build `0.1.0-c8a82998ef52-1784102456` | 30 migrations | `/version` and readiness available | Historical relative to dirty source |
| Source | HEAD plus uncommitted work | 32 migrations | Modern endpoints implemented in source | Requires classification and clean candidate |

## Source Runtime Validation

An isolated source runtime on a synthetic 32-migration database returned:

- `/version`: sanitized release manifest v1, schema version and migration count 32.
- `/health/live`: `ALIVE` without a database dependency.
- `/health/ready`: `READY`, database `READY`, exact migration identity verified.

Failure injection returned 503 for an isolated 31/32 database and for `SOFIA_AUTO_SAFE_ENABLED=true`. A production-mode process without a manifest terminated during startup. These are source-runtime results, not clean-artifact provenance.

One manual diagnostic start inherited the repository environment before `DATABASE_URL` was explicitly exported. It issued only public read requests (`/version`, `/health/ready`) and was stopped immediately; no mutating endpoint was called. Because operational isolation was not proven for that process, the final gate cannot claim `OPERATIVE DB TOUCHED: NO` without qualification.

No operational volume, session or database will be mounted into closure canaries.
