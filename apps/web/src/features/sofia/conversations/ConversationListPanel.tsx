'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/sofia/workspace';
import { cn } from '@/lib/utils';
import type { SofiaConversationsInbox, SofiaInboxConversation } from '@/features/sofia/contracts';
import { SCOPE_LABEL, SCOPE_TONE, maskedPhoneOrLabel, toneFromFreeStatus } from './conversation-status';

type FilterKey = 'all' | 'humanRequired' | 'paymentSensitive' | 'unknownProduct' | 'blocked' | 'aiSuggestions';

const FILTERS: Array<{ key: FilterKey; label: (inbox: SofiaConversationsInbox) => string }> = [
  { key: 'all', label: (inbox) => `Todas (${inbox.filters.allOperational})` },
  { key: 'humanRequired', label: (inbox) => `Requiere humano (${inbox.filters.humanRequired})` },
  { key: 'paymentSensitive', label: (inbox) => `Pago sensible (${inbox.filters.paymentSensitive})` },
  { key: 'unknownProduct', label: (inbox) => `Producto no reconocido (${inbox.filters.unknownProduct})` },
  { key: 'aiSuggestions', label: (inbox) => `Sugerencia IA (${inbox.filters.aiSuggestions})` },
  { key: 'blocked', label: (inbox) => `Bloqueadas (${inbox.filters.blocked})` },
];

function matchesFilter(conversation: SofiaInboxConversation, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'humanRequired') return conversation.signals.humanRequired;
  if (filter === 'paymentSensitive') return conversation.signals.paymentSensitive;
  if (filter === 'unknownProduct') return conversation.signals.unknownProduct;
  if (filter === 'blocked') return conversation.signals.blocked;
  if (filter === 'aiSuggestions') return conversation.signals.aiSuggestion;
  return true;
}

function ConversationRow({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: SofiaInboxConversation;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-[1.1rem] border p-3 text-left transition-all',
        isSelected ? 'border-sofia-300 bg-sofia-50 shadow-sm ring-1 ring-sofia-100' : 'border-stone-200 bg-white hover:border-sofia-200',
      )}
      data-testid={`sofia-conversation-row-${conversation.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">{maskedPhoneOrLabel(conversation.phoneMasked, conversation.customerLabel)}</p>
          <p className="truncate text-[11px] font-medium text-stone-500">{conversation.lastMessagePreview ?? 'Sin mensajes'}</p>
        </div>
        <StatusBadge tone={SCOPE_TONE[conversation.scope]} label={SCOPE_LABEL[conversation.scope]} withDot={false} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusBadge tone={toneFromFreeStatus(conversation.humanStatus)} label={conversation.humanStatus} />
        {conversation.unreadCount > 0 && <StatusBadge tone="pending" label={`${conversation.unreadCount} sin leer`} withDot={false} />}
      </div>
    </button>
  );
}

export function ConversationListPanel({
  inbox,
  selectedId,
  onSelect,
  'data-testid': testId,
}: {
  inbox: SofiaConversationsInbox;
  selectedId: string | null;
  onSelect: (id: string) => void;
  'data-testid'?: string;
}) {
  const [filter, setFilter] = useState<FilterKey>('all');

  const operationalConversations = useMemo(
    () => [...inbox.real.conversations, ...inbox.internalValidation.conversations].filter((c) => matchesFilter(c, filter)),
    [inbox.real.conversations, inbox.internalValidation.conversations, filter],
  );

  const hasLaboratoryData = inbox.sandbox.total > 0 || inbox.historical.total > 0;

  return (
    <Card className="space-y-3 p-4" data-testid={testId}>
      <div>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-400">Bandeja</p>
        <h2 className="text-[15px] font-semibold text-ink">Conversaciones</h2>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="sofia-conversation-filters">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
              filter === key ? 'border-sofia-600 bg-sofia-600 text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-sofia-200',
            )}
          >
            {label(inbox)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {operationalConversations.length > 0 ? (
          operationalConversations.map((conversation) => (
            <ConversationRow key={conversation.id} conversation={conversation} isSelected={conversation.id === selectedId} onSelect={() => onSelect(conversation.id)} />
          ))
        ) : (
          <EmptyState title="Sin conversaciones para este filtro" description="No hay conversaciones reales o de validación interna que coincidan." />
        )}
      </div>

      {hasLaboratoryData && (
        <details className="rounded-[1.1rem] border border-dashed border-stone-200 bg-stone-50/70 p-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-stone-600">
            Laboratorio ({inbox.sandbox.total + inbox.historical.total}) — no es operación real
          </summary>
          <div className="mt-2 space-y-2">
            {[...inbox.sandbox.conversations, ...inbox.historical.conversations].map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} isSelected={conversation.id === selectedId} onSelect={() => onSelect(conversation.id)} />
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
