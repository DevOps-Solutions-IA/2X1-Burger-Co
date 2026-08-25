import type { CommercialConversationState, CommercialFulfillment, CommercialItem, CommercialPaymentPreference } from './commercial.types';

export const COMMERCIAL_REPOSITORY = Symbol('CommercialRepository');

/**
 * SOFIA Round 5 / A44 CLOSURE (A43 blind red-team finding, HIGH) — the subset of the authoritative
 * `SofiaOrderDraft` row's own columns needed to reconstruct a CORRECT, self-consistent conversational
 * narration for an already-CONFIRMED draft, without ever trusting a caller-supplied in-memory
 * `CommercialConversationState` that might have been computed before a concurrent winner committed.
 * Deliberately narrower than the full `CommercialConversationState` shape: fields with no equivalent
 * column on `SofiaOrderDraft` (destination-state snapshot, live GPS point, conversational bookkeeping
 * like `handoffState`/`consentState`/`confidence`/`intent`) are NOT financially binding and are never
 * reconstructed from this record — see `CommercialCheckoutService.stateFromConfirmedDraftRecord()`.
 */
export type CommercialConfirmedDraftRecord = {
  id: string;
  conversationId: string | null;
  version: number;
  status: string;
  draftHash: string | null;
  customerId: string | null;
  fulfillment: CommercialFulfillment;
  paymentPreference: CommercialPaymentPreference;
  items: CommercialItem[];
  address: string | null;
  addressConfirmed: boolean;
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryQuoteAuditId: string | null;
  deliveryQuoteVersion: number | null;
  deliveryQuoteExpiresAt: string | null;
  availabilitySnapshot: Array<{ productId: string; quantity: number; checkedAt: string; reasonCode: string }>;
  expiresAt: string | null;
};

/**
 * SOFIA Round 5 / A26 CLOSURE (root cause #2, HIGH) — thrown by `saveDraft()` when its
 * optimistic-concurrency CAS fails specifically because the caller's TRACKED `draftId` is already
 * `CONFIRMED` in Postgres (a real, financially-binding commercial record) AND the caller did NOT
 * explicitly assert `allowNewDraftAfterConfirm: true`. Previously this exact condition silently fell
 * through to a fallback `create()` that spun off a brand-new, independently-confirmable draft
 * (`prisma-commercial.repository.ts::saveDraft`) — the correct behavior ONLY when the caller's own,
 * non-stale view of the conversation already knew the draft was confirmed (a genuine "start a new
 * order after a prior confirmed one" intent). When the caller did NOT know (e.g. because it read a
 * stale, pre-confirmation conversation-memory snapshot — see the A25 finding), throwing this instead
 * of silently creating a shadow draft lets `CommercialCheckoutService` recover correctly: reload the
 * authoritative state and tell the customer their order is already confirmed, rather than confirming
 * a second, phantom draft for the same conversation later.
 */
export class DraftAlreadyConfirmedError extends Error {
  constructor(public readonly draftId: string) {
    super(`SOFIA_DRAFT_ALREADY_CONFIRMED: draft ${draftId} is already CONFIRMED; refusing to silently spin off a shadow draft without explicit authorization.`);
    this.name = 'DraftAlreadyConfirmedError';
  }
}

/**
 * SOFIA Round 5 / A50 CLOSURE (A49 blind red-team finding, LOW, defense-in-depth) —
 * `reconcileConfirmedState()` (below) has an IMPLICIT precondition: it must only ever be asked to
 * resolve a `draftId` that the caller already knows is genuinely `CONFIRMED`. Every current
 * production caller upholds this today (verified by full call-graph trace — see the A49 spec's
 * reachability caveat), but nothing in the method ITSELF used to enforce it: a
 * `computeReconciledState` callback could return a `resolved.confirmationState === 'CONFIRMED'`
 * that neither the locked `sofiaConversationMemory` row nor this SAME transaction's own locked read
 * of the authoritative `SofiaOrderDraft` row actually corroborates, and that fabricated result would
 * flow straight back to the caller — and, in `respondDraftAlreadyConfirmed()`'s case, straight into
 * a customer-facing "your order is confirmed" narration — with nothing having verified it.
 *
 * `reconcileConfirmedState()` now independently re-derives, from its OWN locked observations only
 * (never trusting the callback's internal logic), whether a `CONFIRMED` result is legitimately
 * backed by evidence. When it is not, it throws THIS error instead of ever returning the fabricated
 * result — so the precondition is enforced by the mechanism itself, not by caller discipline alone,
 * and a future caller/refactor that removes an existing upstream guard cannot silently reopen the
 * gap. Callers that reach this branch should treat it exactly like any other failure of the atomic
 * reconcile: fail closed, persist nothing, and never build a "confirmed" customer message from it.
 */
export class SofiaReconcileConfirmationUnverifiableError extends Error {
  constructor(public readonly conversationId: string, public readonly draftId: string) {
    super(`SOFIA_RECONCILE_CONFIRMATION_UNVERIFIABLE: reconcileConfirmedState() for conversation ${conversationId} / draft ${draftId} was asked to resolve a CONFIRMED result that neither the locked conversation-memory row nor this transaction's own locked SofiaOrderDraft read corroborates; refusing to return an unverified CONFIRMED result.`);
    this.name = 'SofiaReconcileConfirmationUnverifiableError';
  }
}

export interface CommercialRepository {
  loadState(conversationId: string): Promise<CommercialConversationState | null>;
  saveState(state: CommercialConversationState): Promise<void>;
  saveDraft(input: Record<string, unknown> & { conversationId: string; version?: number; draftId?: string; allowNewDraftAfterConfirm?: boolean }): Promise<{ id: string; version: number; draftHash: string; expiresAt: Date }>;
  confirmDraft(input: { draftId: string; expectedVersion: number; expectedHash: string; confirmationHash: string }): Promise<{ id: string; version: number; status: string }>;
  /**
   * SOFIA Round 5 / A36 CLOSURE (A35 blind red-team finding, MEDIUM) — reads the CURRENT
   * authoritative `SofiaOrderDraft` row's `version`/`status` directly, bypassing the
   * `sofiaConversationMemory` narration snapshot entirely. Used ONLY by `CommercialCheckoutService`'s
   * CAS-conflict recovery paths (`STALE_DRAFT_VERSION` from `saveDraft()`, `SOFIA_STALE_CONFIRMATION`
   * from `confirmDraft()`) to determine ground truth immediately after a lost optimistic-concurrency
   * race, without depending on whether the WINNING concurrent turn has finished writing its own
   * conversation-memory snapshot yet (a second, independent race that `loadState()` alone cannot
   * resolve reliably). Returns `null` only if the draft row itself does not exist.
   */
  loadDraftVersion(draftId: string): Promise<{ version: number; status: string } | null>;
  /**
   * SOFIA Round 5 / A44 CLOSURE (A43 blind red-team finding, HIGH) — reads the full authoritative
   * `SofiaOrderDraft` row directly (same direct, unlocked `findUnique` discipline `loadDraftVersion()`
   * already uses), so `respondDraftAlreadyConfirmed()` can reconstruct a correct durable narration for
   * an already-CONFIRMED draft straight from financial truth instead of a caller's possibly-stale
   * in-memory `state`, when its own bounded `loadState()` retry never observes the winning turn's
   * conversation-memory write. Returns `null` only if the draft row itself does not exist.
   */
  loadConfirmedDraftRecord(draftId: string): Promise<CommercialConfirmedDraftRecord | null>;
  /**
   * SOFIA Round 5 / A46 CLOSURE (A45 blind red-team finding, HIGH) — a LOCKED re-read of
   * `sofiaConversationMemory`, using the exact same `SELECT ... FOR UPDATE` row-lock discipline
   * `saveState()`/`saveLegacyConversationContext()` already use to serialize concurrent writers
   * (`prisma-commercial.repository.ts`, A26/A30 CLOSURE). Unlike `loadState()` (a bare, unlocked
   * `SELECT` that can race a concurrent writer and simply miss a commit that has, in fact, already
   * landed or is still in-flight), a `SELECT ... FOR UPDATE` genuinely BLOCKS until any concurrent
   * transaction holding a conflicting lock on the SAME row commits or rolls back, and then reads the
   * true post-commit state — real serialization against a concurrent committer, not a polling guess.
   *
   * `respondDraftAlreadyConfirmed()` uses this as the FINAL authoritative check, after its bounded
   * unlocked-poll retry budget is exhausted, before ever concluding that the rich narration genuinely
   * never existed and falling back to `stateFromConfirmedDraftRecord()`'s neutral-default
   * reconstruction. Returns `null` if no row exists, or if the row exists but does not carry a
   * canonical (`schemaVersion === 4`) record — same shape/contract as `loadState()`.
   */
  loadStateForUpdate(conversationId: string): Promise<CommercialConversationState | null>;
  /**
   * SOFIA Round 5 / A48 CLOSURE (A47 blind red-team finding, HIGH) — closes the check-then-act gap
   * `loadStateForUpdate()` (above) left open: that method's row lock is acquired and released
   * INSIDE ITS OWN, separate, read-only transaction, so it commits (releasing the lock) the instant
   * the `SELECT` resolves. `respondDraftAlreadyConfirmed()` then, in a SEPARATE subsequent step
   * (outside any lock), decided what to persist and called `saveState()` — a classic check-then-act
   * race: a genuinely late (not crashed, merely slow) winning turn's OWN `saveState()` call could
   * land its real, rich CONFIRMED narration in exactly that gap and be silently clobbered a moment
   * later by the losing turn's own reconstruction-fallback write, because BOTH writes carry
   * `confirmationState: 'CONFIRMED'` for the same `draftId` — outside the scope of the
   * never-regress-CONFIRMED guard, which only blocks CONFIRMED -> non-CONFIRMED regressions.
   *
   * This method makes the ENTIRE sequence — acquire the row lock, read the current
   * `sofiaConversationMemory` row, ALSO read the authoritative `SofiaOrderDraft` record for
   * `draftId` (both inside the SAME transaction, so neither can be stale relative to the other),
   * hand both to the caller-supplied `computeReconciledState` callback to decide what (if anything)
   * needs to be persisted, and — if it decides a write is needed — perform that write BEFORE the
   * transaction commits — happen as ONE indivisible unit, with the row lock held CONTINUOUSLY from
   * the first `SELECT ... FOR UPDATE` through the final `upsert`. Because Postgres row locks force
   * real serialization against ANY concurrent transaction trying to write the SAME row (not just
   * "not yet visible to a polling SELECT"), no concurrent committer can land unobserved in a gap:
   * either it commits before this transaction's lock is acquired (and `current` already reflects
   * it), or it is forced to wait until this transaction commits or rolls back (and therefore can
   * never be silently overwritten by this transaction's own decision, and always gets the final say
   * once it does proceed).
   *
   * `computeReconciledState` is a SYNCHRONOUS, pure decision function — it must not perform its own
   * I/O — so the transaction it runs inside stays short. It receives the locked, mutually-consistent
   * `{ current, confirmedDraft }` pair and returns `{ resolved, persist }`:
   *   - `persist: false` — nothing needs to change; `resolved` is what the caller should respond
   *     with (typically `current` itself, when it already reflects the correct CONFIRMED state, or a
   *     caller-constructed fail-closed fallback when neither `current` nor `confirmedDraft` verifies
   *     — in which case NOTHING is written, exactly matching A44's original fail-closed discipline).
   *   - `persist: true` — `resolved` should be persisted as the new durable narration before this
   *     transaction commits.
   * As defense-in-depth, this method independently re-applies the SAME never-regress-CONFIRMED guard
   * `saveState()` itself enforces before actually writing a `persist: true` result, even though a
   * correctly-implemented `computeReconciledState` should never legitimately propose a regression
   * from this call site (it is only ever reached once the caller already knows `draftId` is
   * CONFIRMED).
   *
   * SOFIA Round 5 / A50 CLOSURE (A49 blind red-team finding, LOW, defense-in-depth) — two further
   * hardenings, both aimed at making this method enforce its own "caller already knows `draftId` is
   * CONFIRMED" precondition instead of relying entirely on caller discipline:
   *   1. The authoritative `SofiaOrderDraft` read is now itself taken under `SELECT ... FOR UPDATE`
   *      (the same row-lock discipline already used for `sofiaConversationMemory`), so a genuinely
   *      concurrent writer to that row cannot land in the gap between this read and this
   *      transaction's commit.
   *   2. Independently of that lock, if `computeReconciledState` ever returns a `resolved` whose
   *      `confirmationState` is `'CONFIRMED'` without EITHER the locked `current` memory row or this
   *      transaction's own locked `confirmedDraft` read corroborating it, this method throws
   *      `SofiaReconcileConfirmationUnverifiableError` rather than returning the fabricated result —
   *      so this method itself can never be the source of a customer being told "confirmed" from
   *      unverified data, regardless of what any present or future callback does.
   */
  reconcileConfirmedState(
    conversationId: string,
    draftId: string,
    computeReconciledState: (locked: {
      current: CommercialConversationState | null;
      confirmedDraft: CommercialConfirmedDraftRecord | null;
    }) => { resolved: CommercialConversationState; persist: boolean },
  ): Promise<CommercialConversationState>;
}
