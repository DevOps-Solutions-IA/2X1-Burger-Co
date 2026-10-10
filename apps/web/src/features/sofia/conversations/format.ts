import type { SofiaStatusTone } from '@/components/sofia';
import type { SofiaConversationsInbox, SofiaInboxConversation } from '@/features/sofia/contracts';

export type ConversationScopeKey = keyof Pick<SofiaConversationsInbox, 'real' | 'internalValidation' | 'sandbox' | 'historical'>;

export const CONVERSATION_SCOPE_GROUPS: { key: ConversationScopeKey; label: string; hint: string }[] = [
  { key: 'real', label: 'Real', hint: 'Canal WhatsApp receive-only en producción supervisada' },
  { key: 'internalValidation', label: 'Validación interna', hint: 'Pruebas controladas del equipo' },
  { key: 'sandbox', label: 'Sandbox', hint: 'Simulación — no es evidencia real' },
  { key: 'historical', label: 'Histórico', hint: 'Conversaciones archivadas' },
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

/** Iniciales para el avatar circular de la lista de conversaciones. */
export function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const second = parts[1];
  if (!second) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + second.charAt(0)).toUpperCase();
}

/** Color de avatar determinístico según el id, solo variación visual — sin significado semántico. */
const AVATAR_PALETTE = [
  'bg-brand-100 text-brand-800',
  'bg-sky-100 text-sky-800',
  'bg-emerald-100 text-emerald-800',
  'bg-stone-200 text-stone-700',
  'bg-amber-100 text-amber-800',
];

export function avatarClassFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length] ?? 'bg-stone-200 text-stone-700';
}
