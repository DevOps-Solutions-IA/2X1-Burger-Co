import type { SofiaStatusTone } from '@/components/sofia';
import type { SofiaConversationsInbox, SofiaInboxConversation } from '@/features/sofia/contracts';

export type ConversationScopeKey = keyof Pick<SofiaConversationsInbox, 'real' | 'internalValidation' | 'sandbox' | 'historical'>;

export const CONVERSATION_SCOPE_GROUPS: { key: ConversationScopeKey; label: string }[] = [
  { key: 'real', label: 'Real' },
  { key: 'internalValidation', label: 'Validación interna' },
  { key: 'sandbox', label: 'Sandbox' },
  { key: 'historical', label: 'Histórico' },
];

export type ConversationSignalKey = keyof SofiaInboxConversation['signals'];

export const CONVERSATION_SIGNAL_LABEL: Record<ConversationSignalKey, string> = {
  humanRequired: 'Requiere humano',
  paymentSensitive: 'Sensible a pago',
  unknownProduct: 'Producto desconocido',
  aiSuggestion: 'Sugerencia IA',
  blocked: 'Bloqueada',
  allowlistPending: 'Allowlist pendiente',
  pendingReview: 'Pendiente de revisión',
};

export function toneFromSignal(key: ConversationSignalKey): SofiaStatusTone {
  switch (key) {
    case 'humanRequired':
      return 'human_required';
    case 'blocked':
      return 'blocked';
    case 'paymentSensitive':
    case 'pendingReview':
      return 'warning';
    case 'unknownProduct':
      return 'unknown';
    case 'aiSuggestion':
    case 'allowlistPending':
      return 'pending';
    default:
      return 'read_only';
  }
}

export function toneFromMessageDirection(direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM'): SofiaStatusTone {
  if (direction === 'INBOUND') return 'success';
  if (direction === 'OUTBOUND') return 'pending';
  return 'read_only';
}

export const MESSAGE_DIRECTION_LABEL: Record<'INBOUND' | 'OUTBOUND' | 'SYSTEM', string> = {
  INBOUND: 'Entrante',
  OUTBOUND: 'Saliente',
  SYSTEM: 'Sistema',
};

/** Señales activas (true) de una conversación, en orden de prioridad de atención. */
export function activeSignals(conversation: SofiaInboxConversation): ConversationSignalKey[] {
  const priority: ConversationSignalKey[] = [
    'humanRequired',
    'blocked',
    'paymentSensitive',
    'unknownProduct',
    'pendingReview',
    'allowlistPending',
    'aiSuggestion',
  ];
  return priority.filter((key) => conversation.signals[key]);
}

export function findConversationById(inbox: SofiaConversationsInbox, id: string | null): SofiaInboxConversation | undefined {
  if (!id) return undefined;
  for (const group of CONVERSATION_SCOPE_GROUPS) {
    const found = inbox[group.key].conversations.find((conversation) => conversation.id === id);
    if (found) return found;
  }
  return undefined;
}

export function firstConversationId(inbox: SofiaConversationsInbox): string | null {
  for (const group of CONVERSATION_SCOPE_GROUPS) {
    const first = inbox[group.key].conversations[0];
    if (first) return first.id;
  }
  return null;
}
