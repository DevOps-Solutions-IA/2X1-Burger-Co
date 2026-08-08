import type { CommercialConversationState } from './commercial.types';

export const COMMERCIAL_REPOSITORY = Symbol('CommercialRepository');

export interface CommercialRepository {
  loadState(conversationId: string): Promise<CommercialConversationState | null>;
  saveState(state: CommercialConversationState): Promise<void>;
  saveDraft(input: Record<string, unknown> & { conversationId: string; version?: number; draftId?: string }): Promise<{ id: string; version: number; draftHash: string; expiresAt: Date }>;
  confirmDraft(input: { draftId: string; expectedVersion: number; expectedHash: string; confirmationHash: string }): Promise<{ id: string; version: number; status: string }>;
}
