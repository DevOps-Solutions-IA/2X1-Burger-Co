# PK5 PaymentIntent TOCTOU — P0 Transaction/Locking Design

Status: DESIGN ONLY. No behavioral implementation. P1 implements against this document.
Scope: `apps/api/src/modules/order-checkout/payment-orchestration.service.ts`,
`apps/api/src/modules/order-checkout/persistence/prisma-order-checkout.repository.ts`.
No schema/migration change. No central module edited.

## 1. Confirmed defect (empirically re-validated, raw Postgres, isolated `_test` DB)

`createOnlinePaymentLink` reads the checkout with no lock, then calls `assertRelinkAllowed`
against that stale pre-transaction read. `createPaymentIntent` opens its own
`SERIALIZABLE` + `FOR UPDATE` transaction on `order_checkouts`, but its *only* existence
check is the exact-match unique key `(provider, idempotencyKey)`. It never asks "does an
active `PaymentIntent` already exist for this `checkoutId`, under any key".

Two concurrent calls, same `checkoutId`, different `idempotencyKey` (A, B):

1. T1 (`key=A`) takes the `FOR UPDATE` lock on `order_checkouts`, creates `PaymentIntent`
   attempt 1, updates checkout to `PAYMENT_PENDING` (`version` 1→2), commits.
2. T2 (`key=B`) was blocked on the same `FOR UPDATE` while T1 held it. On unblock, because
   the row changed since T2's snapshot began, Postgres raises `40001 could not serialize
   access due to concurrent update` **on the `FOR UPDATE` statement itself** — T2 never
   even reaches its own read of `payment_intents`.
3. `transaction-retry.ts#isRetryableTransactionError` classifies `40001` as retryable.
   `withBoundedTransactionRetry` retries by calling `operation()` again — a **brand-new**
   `prisma.$transaction`, fresh snapshot, no contention this time.
4. The retried transaction's lookup `WHERE provider='BOLD' AND idempotencyKey='B'` finds
   nothing (key B was never persisted), so it proceeds to **create a second, independent,
   fully payable `PaymentIntent`** for the same checkout.

### Empirical reproduction (raw SQL, isolated `p0_toctou_design_test` DB, no app code)

Two real concurrent Postgres sessions against the actual `order_checkouts` /
`payment_intents` tables (migrated via `prisma migrate deploy` from this worktree's
`prisma/schema.prisma`, DB never touched: `inventory_fastfood_system[_test]`):

- Session A: `BEGIN; SET ... SERIALIZABLE; SELECT ... FOR UPDATE; pg_sleep(3); INSERT
  payment_intents(attempt 1, key=idem-A); UPDATE order_checkouts SET status=PAYMENT_PENDING,
  version=version+1 WHERE version=1; COMMIT;`
- Session B (starts 1s later, so it blocks on A's `FOR UPDATE`): `BEGIN; SET ...
  SERIALIZABLE; SELECT ... FOR UPDATE; INSERT payment_intents(attempt 2, key=idem-B); UPDATE
  ...; COMMIT;`

Result: A commits cleanly. B's `FOR UPDATE` throws
`ERROR: could not serialize access due to concurrent update` (SQLSTATE `40001`) —
confirming the exact code path `isRetryableTransactionError` treats as retryable.
Simulating the retry attempt exactly as today's code performs it (fresh transaction,
`FOR UPDATE` lock, existence check by `(provider, idempotencyKey='idem-B')` only) produced:

```
  id     | attempt_number | idempotency_key | status
 pi_A       |              1 | idem-A          | CREATED
 pi_B_retry |              2 | idem-B          | CREATED
```

Two independent, fully active `PaymentIntent`s for one checkout — the exact defect.
Re-running the identical race but with the retry attempt additionally re-checking
`SELECT count(*) FROM payment_intents WHERE checkout_id=... AND status IN (active/blocked
set)` **under the same `FOR UPDATE` lock, before insert**, correctly aborted the second
attempt (`PAYMENT_ATTEMPT_ACTIVE`) and left exactly one `PaymentIntent` — confirming the
mitigation below closes the race with existing columns/indexes only
(`payment_intents(checkout_id, status)` index already exists, no migration).

## 2. Required invariant

ONE checkout → AT MOST ONE active `PaymentIntent`, regardless of `idempotencyKey`. The
idempotency key governs *replay of one request*; it must never substitute for this
business-uniqueness rule, which is keyed on `checkoutId` alone.

## 3. Design

### 3.1 Lock strategy

- **Lock scope**: the single authoritative `order_checkouts` row for the checkout,
  `SELECT id FROM "order_checkouts" WHERE id = $checkoutId FOR UPDATE` — this is the
  existing lock already taken at the top of `createPaymentIntent`
  (`prisma-order-checkout.repository.ts:239`). It is not widened, duplicated, or moved to a
  different row. All writers that mutate a checkout's payment state already take this same
  lock (see the repository's other `FOR UPDATE` sites), so it is the correct, already-proven
  serialization point for "one checkout, one payment decision at a time" — no new lock
  primitive is introduced.
- **Isolation level**: unchanged, `Prisma.TransactionIsolationLevel.Serializable`. This is
  what turns the concurrent-write conflict into a `40001` at the `FOR UPDATE` statement
  (see §1) instead of silently interleaving — it is load-bearing and must not be weakened to
  `ReadCommitted`/`RepeatableRead`.
- **What is re-read under the lock (this is the fix)**: immediately after the `FOR UPDATE`
  succeeds, in addition to the existing `tx.orderCheckout.findUnique`, the transaction must
  also re-read **all** `PaymentIntent` rows for `checkoutId` (`tx.paymentIntent.findMany({
  where: { checkoutId }, orderBy: { attemptNumber: 'desc' } })`) — not just probe the single
  `(provider, idempotencyKey)` key. This fresh, locked read is what `assertRelinkAllowed`
  must evaluate (§3.2), and it is what closes the gap: the checkout row lock guarantees that
  by the time *any* transaction — first attempt or retry — gets past the `FOR UPDATE`, every
  `PaymentIntent` committed by a prior transaction for that checkout is already visible to
  this fresh read (no other transaction can be mid-write on that checkout concurrently; the
  lock excludes it).

### 3.2 Business-uniqueness mechanism

No schema change. The mechanism is **process, not a new constraint**: reuse the already
row-locked, already-`SERIALIZABLE` transaction as the single point where "does an active
intent already exist for this checkout" is authoritatively decided, using the existing
`@@index([checkoutId, status])` on `PaymentIntent` (already in `prisma/schema.prisma`,
unmodified) for the lookup.

Concretely, relocate `assertRelinkAllowed` (currently called pre-transaction in
`payment-orchestration.service.ts:38`, against `checkout.paymentIntents` read *before* any
lock) to execute **inside** `PrismaOrderCheckoutRepository.createPaymentIntent`'s
transaction, immediately after the `FOR UPDATE` + fresh re-read described in §3.1, and
**before** the existing `(provider, idempotencyKey)` replay lookup. `assertRelinkAllowed`'s
own internal logic is unchanged (it already implements exactly the right state machine —
same-key replay passes through, active/blocked latest-attempt states throw
`PAYMENT_ATTEMPT_ACTIVE` / `PAYMENT_RELINK_BLOCKED`); the defect was never its logic, only
*when* and *against what data* it ran. Running it against the freshly locked read makes the
existing reject-with-conflict-code behavior (`checkoutConflict(...)`, a `ConflictException`)
the canonical outcome for "an active intent already exists under a different key" — no new
error code, no behavior change to the external contract, just correct data.

Sequence inside one transaction, every attempt:

```
BEGIN SERIALIZABLE
  SELECT id FROM order_checkouts WHERE id = $checkoutId FOR UPDATE        -- existing
  checkout      = tx.orderCheckout.findUnique(...)                        -- existing
  paymentIntents = tx.paymentIntent.findMany({ checkoutId }, desc)        -- NEW, under lock
  assertRelinkAllowed(checkout, paymentIntents, idempotencyKey)           -- NEW call site,
                                                                           -- same-key -> pass
                                                                           -- else active/blocked -> throw ConflictException (rolls back tx)
  existing = tx.paymentIntent.findUnique({ provider_idempotencyKey })     -- existing replay path
  if existing: return existing
  create PaymentIntent attempt N+1                                       -- existing
  updateMany checkout status/version WHERE version = checkout.version    -- existing
COMMIT
```

### 3.3 Retry interaction (`transaction-retry.ts`)

No change to `transaction-retry.ts` itself — its retry classification (`40001`/`40P01` →
retryable) is correct and must stay: the `40001` in §1 is a legitimate transient
serialization conflict on the lock, not a business error, and blind non-retry would just
turn every honest race into a hard failure for the losing request.

The property that must hold, and does hold with this design: `withBoundedTransactionRetry`'s
retried unit of work is the **entire** `repository.createPaymentIntent(...)` call — a
function that opens its own `prisma.$transaction` on each invocation. Because §3.1/§3.2 put
the lock, the fresh re-read, and `assertRelinkAllowed` **inside that same `$transaction`
callback**, every retry attempt — not just the first — re-executes the full
check-then-create sequence atomically against a brand-new snapshot and a freshly acquired
lock. There is no code path where a retry resumes past the check and re-runs only the
`create`; `operation()` in `withBoundedTransactionRetry<T>(operation: () => Promise<T>)` has
no partial-progress state to resume — each call is a fresh, complete transaction. This is
precisely what the empirical §1 reproduction demonstrates going from vulnerable to fixed:
adding the checkoutId-scoped re-check to *that same retried transaction* is sufficient; no
change to the retry wrapper, its bounds, or its backoff is needed.

`assertRelinkAllowed` throws `ConflictException`/`NotFoundException` (via
`checkoutConflict`/`checkoutNotFound` in `order-checkout.errors.ts`), never a
`Prisma.PrismaClientKnownRequestError`. `isRetryableTransactionError` returns `false` for
these (they fail the `instanceof PrismaClientKnownRequestError` check), so a legitimate
business rejection is never misclassified as retryable and never silently retried into a
false success — it propagates on the first attempt that observes it, fail-closed.

### 3.4 `assertRelinkAllowed` execution context

Today: called once, in the service, before any transaction, against
`checkout.paymentIntents` from `repository.requiredCheckout` — a plain, unlocked
`findUnique` executed at the very start of the request, arbitrarily stale by the time the
transaction runs.

Design: `assertRelinkAllowed`'s pure logic stays where it is (private method on
`PaymentOrchestrationService` — it is policy, not persistence, and
`order-checkout.architecture.spec.ts` already asserts `payment-orchestration.service.ts`
contains no `PrismaService|this\.prisma|\$transaction`; moving the transaction boundary
into it would violate that boundary). What moves is *when* it runs: the service passes it
into the repository as a callback, invoked by the repository only after the `FOR UPDATE`
lock and the fresh re-read (§3.1):

```ts
// repository (illustrative signature change only — behavior is P1's to implement):
async createPaymentIntent(input: {
  checkoutId: string;
  idempotencyKey: string;
  provider: PaymentIntentProvider;
  expiresAt: Date;
  assertRelinkAllowed: (
    checkout: { status: OrderCheckoutStatus; expiresAt: Date | null },
    paymentIntents: readonly { idempotencyKey: string; status: PaymentIntentStatus; expiresAt: Date | null }[],
  ) => void;
}) { /* P1: wire per §3.2 sequence */ }

// service call site (illustrative only):
this.repository.createPaymentIntent({
  checkoutId: checkout.id,
  idempotencyKey: input.idempotencyKey,
  provider: PaymentIntentProvider.BOLD,
  expiresAt,
  assertRelinkAllowed: (freshCheckout, freshPaymentIntents) =>
    this.assertRelinkAllowed(freshCheckout, freshPaymentIntents, input.idempotencyKey),
});
```

The pre-transaction `this.assertRelinkAllowed(checkout, checkout.paymentIntents,
input.idempotencyKey)` call at `payment-orchestration.service.ts:38` must be **removed**,
not merely supplemented — keeping it as a "fast-path" pre-check would reintroduce the same
stale-read hazard as an easy-to-reintroduce footgun (someone "optimizing" the fast path
later could accidentally start trusting it) for zero correctness benefit, since the
in-transaction check must run unconditionally anyway. `requiredCheckout` is still called
pre-transaction, but only for the two checks that do not participate in this race and are
immutable for the lifetime of a checkout (`assertPaymentCombination`,
`paymentPreference !== ONLINE`) plus the 404 fast-path; `checkout.status` /
`checkout.expiresAt` must never be read from that pre-transaction object for the
relink decision — only from the fresh, locked `checkout` read inside the transaction.

### 3.5 Non-goals / explicitly out of scope for P0

- `startBoldPayment`, webhook handling, `beginProviderPayment`,
  `bindProviderPaymentResult`, `markProviderPaymentUnknown` are untouched — they already
  operate per-`PaymentIntent` under their own `FOR UPDATE` on `payment_intents` and are not
  implicated by this defect.
- `CanonicalPaymentWebhookService`'s `successfulPaymentCount`/`markFinancialReview`
  backstop is untouched and remains the last-resort net for paths that bypass this service
  entirely (per the existing docstring at `payment-orchestration.service.ts:162-169`).
- No new Prisma migration, no new unique/partial index. See §4.

## 4. Migration requirement assessment

**MIGRATION_REQUIRED = false.**

The row lock on `order_checkouts` already fully serializes all `createPaymentIntent` calls
for a given `checkoutId` (proven in §1's reproduction — two concurrent attempts for the same
checkout can never both be inside the locked section at once, by construction of `FOR
UPDATE`). Making the checkoutId-scoped active-intent re-check happen *inside* that already-
serialized section, on every attempt including retries, is sufficient on its own; the
existing `@@index([checkoutId, status])` on `PaymentIntent` covers the re-check's query
pattern. No new column, unique constraint, or partial index is required to close this race.

**Fallback design (same as primary — no migration path was needed to choose between):** the
mitigation above *is* the migration-free design; there is no degraded fallback to fall back
to.

**Optional future hardening (explicitly not required, not part of this remediation, flagged
only for completeness):** a DB-level partial unique index such as
`CREATE UNIQUE INDEX ... ON payment_intents(checkout_id) WHERE status IN (...)` would add
defense-in-depth against a hypothetical future write path that creates a `PaymentIntent`
without going through this repository method's lock (e.g. a script, a different service).
That is a schema change and, per the operating rules for this task, is explicitly **not**
created here. If a future phase wants it, it must go through the normal owner-authorized
migration procedure (CLAUDE.md §19/§21), independent of this remediation.

## 5. Test-database hygiene note (for P1)

This design was validated against an isolated database (`p0_toctou_design_test`), created
via `CREATE DATABASE p0_toctou_design_test;` on the shared `inventario-postgres-1`
container and migrated with `prisma migrate deploy` from this worktree's
`prisma/schema.prisma`. `inventory_fastfood_system` and `inventory_fastfood_system_test`
were never touched. P1 must create its own equally-isolated `<team>_test` database before
running any DB-backed test for the implementation, per the same convention.
