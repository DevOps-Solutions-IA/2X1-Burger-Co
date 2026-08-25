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
}
