import type { CommercialConversationState } from './commercial.types';

export const COMMERCIAL_REPOSITORY = Symbol('CommercialRepository');

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
}
