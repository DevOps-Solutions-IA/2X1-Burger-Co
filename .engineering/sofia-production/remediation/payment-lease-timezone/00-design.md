# P4 — `processing_lease_expires_at` Timezone-Safety Design

Status: DESIGN ONLY. No behavioral implementation. P5 implements against this document.
Scope: `apps/api/src/modules/order-checkout/persistence/prisma-order-checkout.repository.ts`
(read/write/compare sites for `PaymentWebhookEvent.processingLeaseExpiresAt` only) and, if P5's
implementation needs it, the call sites in `canonical-payment-webhook.service.ts` that consume
`findClaimedWebhookEvidence`/`claimWebhookEvidence`/`claimRecoverableWebhook` results. **No
schema/migration change. No central module edited. The PaymentIntent TOCTOU transaction/locking
strategy (PK5/P1, commit `c65aa7e`) is untouched and out of scope — this design does not modify
`order_checkouts` locking, `SERIALIZABLE` isolation, or the checkout-scoped active-intent
re-check.**

## 1. Confirmed defect and empirical root cause

`processing_lease_expires_at` on `payment_webhook_events` is `TIMESTAMP(3)` — Postgres
"timestamp without time zone" — per every migration that touches it
(`prisma/migrations/20260809030000_sofia_live_operations_recovery_core/migration.sql`). It is
intended to represent an absolute instant (a 30s lease, `CanonicalPaymentWebhookService.
CLAIM_LEASE_MS = 30_000`), but a naive column has no timezone of its own — its meaning depends
entirely on the convention used by whatever code reads or writes it.

This project uses the classic Prisma query engine (Rust binary, `quaint` connector), **not**
`@prisma/adapter-pg` — confirmed by `grep` across `apps/api` and `prisma/schema.prisma`
(`generator client { provider = "prisma-client-js" }`, no `driverAdapters` preview feature, no
`@prisma/adapter-pg` dependency). Both `$queryRaw`/`$executeRaw` and the typed Prisma Client go
through this same engine and the same connection — but they serialize a JS `Date` bind
parameter **differently** when writing to a naive column:

- **Raw SQL (`$executeRaw`/`$queryRaw` template literals) binds a JS `Date` using the Postgres
  session's `TimeZone` setting.** A `Date` representing a true UTC instant gets converted to
  that session-timezone's wall-clock text before being stored in the naive column.
- **The typed Prisma Client (`.create()`, `.update()`, `.updateMany()`, `.findFirst()` filters
  like `{ gt: new Date() }`) always serializes/compares `DateTime` values using a
  UTC-normalized representation, independent of session `TimeZone`.**

`SQL CURRENT_TIMESTAMP` compounds this: it returns a `timestamptz` (the true instant), and
Postgres casts it to the naive column's type **using the session `TimeZone`** for the
comparison — so `naive_column > CURRENT_TIMESTAMP` is *also* session-timezone-dependent.

Today, every write to `processing_lease_expires_at` goes through raw `$executeRaw` with a bare
`Date` bind parameter (`claimWebhookEvidence`, `claimRecoverableWebhook`, `renewWebhookClaim`),
and almost every compare uses raw SQL `> CURRENT_TIMESTAMP` (`advanceWebhookCheckpoint`,
`completeWebhookClaim`, `assertWebhookClaimOwned`, `renewWebhookClaim`, `failWebhookClaim`) or a
raw bind-param compare (`findRecoverableWebhookIds`'s `<= ${now}`) — all internally consistent
with each other (same session-tz shift on both sides), which is exactly why this is dormant
under the docker-compose default (`UTC`, shift = 0). The **one** exception is
`findClaimedWebhookEvidence`, which reads via the typed client's `{ gt: new Date() }` filter —
a different, UTC-normalized convention. That mismatch is the reported bug.

### 1.1 Empirical reproduction

Isolated database `p4_leasetz_test`, migrated via `prisma migrate deploy` from this worktree's
`prisma/schema.prisma` (`inventory_fastfood_system[_test]` never touched), default timezone set
to `America/Bogota` (`ALTER DATABASE p4_leasetz_test SET timezone TO 'America/Bogota';`,
verified `SHOW timezone` → `America/Bogota`, `-05`). Four scripted probes against the real
`payment_webhook_events` table via `@prisma/client` v6.19.2, mirroring the exact code paths in
`prisma-order-checkout.repository.ts`:

**Probe 1 — reproduces the reported symptom exactly.** A fresh 30s lease written via raw
`$executeRaw` (mirrors `claimWebhookEvidence`'s claim UPDATE) stores
`2026-08-20 07:18:30.105` (intended instant was `12:18:30.105Z` — a **-5h** shift, matching the
reported corruption exactly). Read back via the typed client's
`{ processingLeaseExpiresAt: { gt: new Date() } }` filter (mirrors `findClaimedWebhookEvidence`)
→ **`NULL` — the fresh, valid, 30-second-old lease is invisible.** This is precisely
`processClaimedWebhook` throwing `PAYMENT_WEBHOOK_RECOVERY_EVIDENCE_INVALID` →
`failClaim` → permanently blocked, non-retryable, even for a genuinely successful payment.

**Probe 2 — full read/write matrix.** Same instant written two ways (raw `$executeRaw` bind vs.
typed `.update()`), read four ways (raw text cast, raw `$queryRaw` → `Date`, typed `select`,
typed `{ gt }` filter) plus two raw-SQL-side compares:

| Write path | raw text (ground truth) | raw→Date matches instant | typed read matches instant | typed `{gt}` finds it | raw `> CURRENT_TIMESTAMP` |
|---|---|---|---|---|---|
| raw `$executeRaw` bind | `07:21:41.316` (shifted) | **false** | **false** | **false** | true (self-consistent, both shifted) |
| typed `.update()` | `12:19:47.206` (unshifted = correct) | **true** | **true** | **true** | true |

The typed-write row is correct under **every** read/compare method tested. The raw-write row is
wrong under every method except a same-convention raw compare.

**Probe 3 — does the raw/typed mismatch also produce false negatives on genuinely expired
leases (i.e. the *opposite*, worse failure mode: leases that never expire and block recovery
forever)?** A lease deliberately set 60s in the past, written via the **typed** client (the
candidate fix), read via raw SQL `> CURRENT_TIMESTAMP`:
`still_active: true` — **wrong, it should be `false`; the lease looks perpetually active.**
The typed client's own `{ gt: new Date() }` filter on the same row correctly returns `false`
(not found).

**Probe 4 — same check with a raw bind parameter instead of `CURRENT_TIMESTAMP`** (mirrors
`findRecoverableWebhookIds`'s `processing_lease_expires_at <= ${now}`), against the same
typed-written, genuinely-expired-60s-ago row: `should_be_recoverable: false` — **wrong, it
should be `true`; the expired lease is never picked up by the recovery worker.**

**Conclusion from probes 3–4: switching only the *write* side to the typed client (a plausible
naive partial fix) is not sufficient and is actively dangerous** — it would fix the reported
symptom (`findClaimedWebhookEvidence`) but simultaneously break every other raw-SQL compare in
this file (`advanceWebhookCheckpoint`, `completeWebhookClaim`, `assertWebhookClaimOwned`,
`renewWebhookClaim`, `failWebhookClaim`, `findRecoverableWebhookIds`, and the JS-side
`existing.processingLeaseExpiresAt > now` checks inside `claimWebhookEvidence` /
`claimRecoverableWebhook` that read a raw `SELECT` result into a `Date`), producing leases that
*never* expire under a non-UTC session — a strictly worse failure mode (silent permanent lock
instead of a loud, retryable one). **Every raw SQL touch point on this column has to move
together, not piecemeal.**

**Precedent, already correct in this exact file:** `PaymentIntent.expiresAt` and
`PaymentLink.expiresAt` are the same column type (`TIMESTAMP(3)`, no tz) and the same kind of
absolute-instant semantics (payment TTL). Every read/write/compare of both
(`prisma-order-checkout.repository.ts:128,169,205,274,293,301,311,340,596,598,615,616,636,637,658`
and `payment-orchestration.service.ts`) goes exclusively through the typed Prisma Client
(`{ gt: new Date() }`, `{ lte: now }`, `input.expiresAt`, JS-side `.getTime() > Date.now()` on a
typed-read `Date`) — **zero raw SQL touches either field.** This is the exact pattern this
design brings `processing_lease_expires_at` in line with; it is not a novel approach for this
codebase, it is the existing, working convention for the sibling "absolute instant" columns.

## 2. Chosen design: eliminate raw SQL on this one column, not the whole method

**CANONICAL_TEMPORAL_AUTHORITY: the typed Prisma Client exclusively, for every write, read, and
comparison of `PaymentWebhookEvent.processingLeaseExpiresAt`.** Never a raw `$executeRaw`/
`$queryRaw` bind parameter in a `SET`, never a raw SQL `CURRENT_TIMESTAMP` or bind-param
compare in a `WHERE`. Empirically verified session-timezone-independent (§1.1, Probe 2, typed
row, every read/compare method). No migration required — see §4.

This does **not** require deleting the `pg_advisory_xact_lock` / `SELECT ... FOR UPDATE`
machinery in `claimWebhookEvidence`/`claimRecoverableWebhook` (that locking protocol is
unrelated to the timezone bug and out of scope — it stays raw SQL exactly as-is). It requires
splitting each of the 8 affected repository methods so the *lease-column write/compare*
specifically routes through the typed client, using the *same* `tx`/`prisma` handle so it
participates in the same transaction/connection as any surrounding raw-SQL lock:

### 2.1 Per-method change shape (illustrative — P5's job to implement and test)

- **`claimWebhookEvidence`** (repository.ts:761–914) — keep the raw `pg_advisory_xact_lock` and
  the raw `SELECT ... FOR UPDATE` (it reads other fields too: `deterministicResult`,
  `transitionApplied` via `EXISTS`, etc. — none of that is temporal or tz-sensitive). Change
  only the two `$executeRaw UPDATE ... SET processing_lease_expires_at = ${...}` blocks
  (lines 814–823, 890–905) to `tx.paymentWebhookEvent.update({ where: { id }, data: {
  processingAttempts, processingLeaseOwnerHash, processingLeaseExpiresAt, retryable: false,
  nextRetryAt: null, lastErrorCode: null, ... } })`, executed against the same `tx` inside the
  existing `this.prisma.$transaction(async (tx) => { ... })` callback — Prisma's typed client
  calls made against an interactive-transaction `tx` handle run on the same underlying
  connection/session as the raw statements already issued against that `tx`, so lock ordering
  is preserved. The JS-side comparisons `existing.processingLeaseExpiresAt > now` (lines 864,
  867) stay as-is and become safe once every write is typed (Probe 2: raw `$queryRaw` → `Date`
  deserialization of a *typed-written* value is correct; the corruption in Probe 1/2 originates
  at write time, not at this kind of read).
- **`claimRecoverableWebhook`** (944–1038) — identical treatment: keep the raw advisory lock
  and `FOR UPDATE` read; convert the `$executeRaw UPDATE` at 1012–1026 to
  `tx.paymentWebhookEvent.updateMany({ where: { id, processedAt: null }, data: { ... } })`,
  keep the existing `updated !== 1 → ACTIVE` guard using `.count`.
- **`advanceWebhookCheckpoint`** (1073–1088), **`completeWebhookClaim`** (1090–1113),
  **`assertWebhookClaimOwned`** (1115–1124), **`renewWebhookClaim`** (1126–1139) — each is
  already a single, static-value, guarded UPDATE (or SELECT-count, for
  `assertWebhookClaimOwned`) with no data-dependent `CASE`. Convert 1:1 to
  `prisma.paymentWebhookEvent.updateMany({ where: { id, processedStatus: { in: [...] },
  processingLeaseOwnerHash, processingLeaseExpiresAt: { gt: new Date() } }, data: {...} })` /
  `.count(...)` and keep the existing `count !== 1 → PAYMENT_WEBHOOK_CLAIM_LOST` guard. This
  preserves the exact same compare-and-swap atomicity the raw SQL had — a single UPDATE/SELECT
  statement's `WHERE` is evaluated atomically by Postgres regardless of whether Prisma's query
  builder or hand-written SQL text produced it; there is no correctness difference.
- **`failWebhookClaim`** (1141–1176) — the one method whose raw SQL `SET` uses a data-dependent
  `CASE` (branches on the row's *current* `processing_attempts` vs. `input.maxAttempts`,
  computed atomically in the same statement). This cannot be expressed as a static typed-client
  `data:` value. Recommended shape: inside a short interactive transaction, (a) a guarded typed
  `findFirst`/`updateMany` using the *same* ownership+expiry+status `WHERE` guard the raw SQL
  used, to read `processingAttempts` — if this guarded read finds nothing, throw
  `PAYMENT_WEBHOOK_CLAIM_LOST` exactly as today's `updated !== 1` does; (b) compute the
  retryable/`nextRetryAt`/`resultCode` branches in TypeScript (mirroring the existing `CASE`
  logic verbatim); (c) a second guarded `updateMany` with the *same* ownership+expiry+status
  `WHERE` (so if the row changed between (a) and (b) — which requires a second writer holding
  the *same* `leaseOwnerHash`, which should not happen — the count-check still catches it,
  identical safety property to today's single-statement guard). This is a two-round-trip
  change, not a data-race weakening: the correctness-critical guard is enforced at the final
  write, same as now.
- **`findRecoverableWebhookIds`** (916–942) — pure `SELECT`, no lock, no write. Its only
  obstacle to a full typed-client rewrite is the `ORDER BY COALESCE(next_retry_at,
  processing_lease_expires_at, received_at), received_at`, which Prisma's typed `orderBy`
  cannot express (no `COALESCE`). Recommended: fetch the bounded candidate set via a typed
  `findMany` with the same `OR`-structured `where` (Prisma supports arbitrary nested
  `AND`/`OR`), then compute the `COALESCE(...)` sort key and truncate to `boundedLimit` in
  TypeScript — trivial at this row count (`boundedLimit` is capped at 100). This fully
  eliminates raw SQL from this method, not just the temporal bind parameter, and needs no
  SQL-side `COALESCE` workaround at all. **Care point for P5:** the existing filter checks
  `deterministic_result IS NULL` on a nullable `Json` column — Prisma's typed filter for "this
  Json column is NULL" needs `{ equals: Prisma.DbNull }` (not a bare `null`, which Prisma
  historically treats as "field not present" for `Json?` in some versions) — verify against
  `@prisma/client` 6.19.2's actual behavior with a real query before relying on it; this is a
  known Prisma `Json` nullability gotcha, not something this design can assert without P5
  re-testing it against the pinned version.

### 2.2 What stays exactly as-is

- `pg_advisory_xact_lock`, `SELECT ... FOR UPDATE` (identity resolution, row locking) in
  `claimWebhookEvidence` / `claimRecoverableWebhook`.
- The `EXISTS (SELECT 1 FROM payment_transitions ...)` subquery for `transitionApplied`.
- All non-temporal raw SQL elsewhere in this file (checkout/payment-intent locking, unrelated
  to this defect and to the PK5/P1 TOCTOU fix, both explicitly out of scope).
- `CLAIM_LEASE_MS = 30_000` and every call site that constructs `new Date(Date.now() + ...)` for
  `leaseExpiresAt` (`canonical-payment-webhook.service.ts:134,426`) — these already produce a
  correct `Date` object; the bug is purely in how that `Date` gets persisted/compared, not in
  how it's computed.

## 3. Rejected/deferred alternative: migrate the column to `timestamptz`

Evaluated and empirically tested (§3.1) — **not recommended, not required.**

### 3.1 Empirical characterization

`ALTER TABLE payment_webhook_events ALTER COLUMN processing_lease_expires_at TYPE timestamptz
USING processing_lease_expires_at AT TIME ZONE 'UTC';` applied to the isolated
`p4_leasetz_test` database (schema-only experiment, no migration file created, no shared
database touched), then Probe 2 re-run unmodified (Prisma schema left declaring `DateTime?`,
i.e. Prisma is unaware of the underlying type change — this is intentionally the "what if we
just changed the DB type" scenario). Result: **every** write/read/compare combination (raw
write + raw read, raw write + typed read, typed write + raw `CURRENT_TIMESTAMP` compare, etc.)
now returns the correct, session-timezone-independent instant. `timestamptz` is a legitimate,
fully general fix — it removes the ambiguity at the storage layer instead of requiring
call-site discipline.

### 3.2 Why not recommended here

Per the task's stated preference, the migration path is only warranted if a migration-free
approach cannot be shown to achieve full correctness. §1.1/§2 show it can: the typed-Prisma-
Client-only discipline is 100% correct in every tested combination, has an existing working
precedent in the same file (`PaymentIntent.expiresAt`/`PaymentLink.expiresAt`, §1.1), and
touches only application code already inside this remediation's authorized scope — no schema
change, no migration review/rollback process, no owner authorization gate for a migration.
`timestamptz` is strictly better *defense-in-depth* (it survives a future developer
accidentally reintroducing raw SQL on this column) but is not *required* to close this HIGH
finding, and CLAUDE.md §19/§21 requires a separate, explicit migration authorization this task
does not have.

### 3.3 If ever authorized separately (not part of this remediation)

- **Table**: `payment_webhook_events`. **Column**: `processing_lease_expires_at`. **Current
  type**: `TIMESTAMP(3)` (`timestamp(3) without time zone`). **Desired type**: `TIMESTAMPTZ(3)`
  (`timestamp(3) with time zone`).
- **Conversion semantics**: `ALTER COLUMN processing_lease_expires_at TYPE timestamptz(3) USING
  processing_lease_expires_at AT TIME ZONE 'UTC'` — this is the correct direction *only if*,
  at migration time, every existing non-NULL value in the column was written under a session
  whose effective `TimeZone` was `UTC` (true today, docker-compose default). If any row was
  ever written under a different session timezone (e.g. by a prior deploy, a manual `psql`
  session, or after this bug was independently triggered some other way), this `USING` clause
  would silently mis-convert that specific row — the migration would need a pre-flight audit
  step (e.g. confirming `processing_attempts = 0` / all rows recent / cross-checking against
  `received_at`) that is out of this design's scope to specify without owner sign-off on the
  acceptable-risk window. The sibling nullable-lease column
  `WhatsappInboundEvent.processingLeaseExpiresAt` and every other `TIMESTAMP(3)` "absolute
  instant" column found across the schema during this investigation (`PaymentIntent.expiresAt`,
  `PaymentLink.expiresAt`, SecureCommand's `lease_expires_at`/`expires_at` columns — the latter
  in a module this task is explicitly prohibited from touching) share the identical latent
  pattern; a real migration proposal should almost certainly be scoped as one coordinated
  schema change across all of them rather than one column at a time, which is itself a reason
  to defer it to a dedicated, owner-authorized phase rather than bundle it into this HIGH fix.
- **Rollback**: `ALTER COLUMN processing_lease_expires_at TYPE timestamp(3) USING
  processing_lease_expires_at AT TIME ZONE 'UTC'` (the exact inverse) — safe only as long as
  the session performing the rollback also has `TimeZone = UTC`, for the same reason as above.
- **This design does not create this migration.** If the owner wants defense-in-depth beyond
  §2's migration-free fix, it should be proposed as its own follow-up phase covering all
  affected columns together, per CLAUDE.md §19/§21.

## 4. Migration requirement assessment

**MIGRATION_REQUIRED = false.** §2's application-only fix (typed Prisma Client exclusively for
every write/read/compare of `processing_lease_expires_at`) is empirically proven correct under
a non-UTC session timezone (Probe 2, typed-write row, every read/compare method tested) and
mirrors an already-correct, already-shipped pattern in the same file for the same column type
and the same "absolute instant" semantics (`PaymentIntent.expiresAt`, `PaymentLink.expiresAt`).
No new column, index, or constraint is required.

## 5. Sibling risk flagged, explicitly out of scope this round

- `PaymentWebhookEvent.nextRetryAt` (same table, same `TIMESTAMP(3)` type) is written via raw
  `CURRENT_TIMESTAMP` in `failWebhookClaim` and compared via a raw bind parameter in
  `findRecoverableWebhookIds` and via JS-side `existing.nextRetryAt > now` after a raw `SELECT`
  in `claimWebhookEvidence`/`claimRecoverableWebhook` — the identical root-cause pattern as
  `processing_lease_expires_at`, on the same table, currently dormant for the same reason (UTC
  default). Not fixed in this design; P5 should apply the same typed-client-only discipline to
  `nextRetryAt` while touching these same methods, since the two fields are written together in
  every affected `UPDATE` — fixing one without the other in the same statement would be
  incoherent.
- `WhatsappInboundEvent.processingLeaseExpiresAt` (separate table, same pattern) and
  SecureCommand's lease/expiry columns were noted during schema review but are **not**
  evaluated further here: SecureCommand (`apps/api/src/modules/secure-command/**`) is CERTIFIED
  and CLOSED this round and explicitly prohibited from being touched or re-tested by this task.
  Flagged for a future, separately-scoped round only.

## 6. Test-database hygiene note (for P5)

Validated against isolated database `p4_leasetz_test`, created via `CREATE DATABASE
p4_leasetz_test;` on the shared `inventario-postgres-1` container and migrated with `prisma
migrate deploy` from this worktree's `prisma/schema.prisma`. Session/database-default timezone
was set with `ALTER DATABASE p4_leasetz_test SET timezone TO 'America/Bogota';` to reproduce
the reported corruption deterministically (rather than relying on the *host's* timezone, which
this design deliberately does not assume or depend on either way — see §7).
`inventory_fastfood_system` and `inventory_fastfood_system_test` were never touched, and the
`timestamptz` experiment in §3.1 was applied only to this same isolated, disposable database. P5
must create its own equally-isolated `<team>_test` database before running any DB-backed test
for the implementation, per the same convention used by P0/P2 in this remediation track, and
should keep (or re-derive) a `SET TIME ZONE`-to-non-UTC regression test as a permanent guard —
the bug is invisible under the project's current UTC-default `docker-compose` Postgres, so
without such a test it can regress silently.

## 7. Architectural note

Per the task's framing: correctness here must not depend on Postgres session timezone, host
timezone, container timezone, Node timezone, or operator `TZ` configuration. §2's fix satisfies
this by construction — the typed Prisma Client's serialization of `DateTime` values was
empirically shown (Probe 2) to be identical regardless of the Postgres session's `TimeZone`
setting; it was never re-tested against a non-UTC *host*/Node `TZ` because Prisma's raw-SQL
misbehavior in §1.1 was already isolated to the **Postgres session** setting, not the Node
process's own `TZ` — the JS `Date` objects on both sides of every comparison in this file are
already timezone-agnostic instants (`Date.getTime()`/`.toISOString()` are always UTC-based
regardless of Node's local `TZ`; only their *serialization into SQL* is where session `TimeZone`
can leak in, and only via the raw-SQL path this design eliminates for this column).
