'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Inbox as InboxIcon, MessagesSquare } from 'lucide-react';
import { CONSOLE_CARD_CLASS, EmptyStrip, StatCard, StatusBadge } from '@/components/sofia';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SofiaConversationsInbox, SofiaInboxConversation } from '@/features/sofia/contracts';
import { ConversationDetailPanel } from './ConversationDetailPanel';
import {
  CONVERSATION_SCOPE_GROUPS,
  CONVERSATION_SIGNAL_LABEL,
  type ConversationSignalKey,
  activeSignals,
  avatarClassFromId,
  findConversationById,
  firstConversationId,
  initialsFromLabel,
  toneFromSignal,
} from './format';

type FilterKey = 'all' | ConversationSignalKey;

const FILTER_CHIPS: { key: FilterKey; label: string; getCount: (filters: SofiaConversationsInbox['filters'], summary: SofiaConversationsInbox['summary']) => number }[] = [
  { key: 'all', label: 'Todas', getCount: (_filters, summary) => summary.totalConversations },
  { key: 'humanRequired', label: CONVERSATION_SIGNAL_LABEL.humanRequired, getCount: (filters) => filters.humanRequired },
  { key: 'paymentSensitive', label: CONVERSATION_SIGNAL_LABEL.paymentSensitive, getCount: (filters) => filters.paymentSensitive },
  { key: 'unknownProduct', label: CONVERSATION_SIGNAL_LABEL.unknownProduct, getCount: (filters) => filters.unknownProduct },
  { key: 'blocked', label: CONVERSATION_SIGNAL_LABEL.blocked, getCount: (filters) => filters.blocked },
  { key: 'aiSuggestion', label: CONVERSATION_SIGNAL_LABEL.aiSuggestion, getCount: (filters) => filters.aiSuggestions },
];

function matchesFilter(conversation: SofiaInboxConversation, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  return conversation.signals[filter];
}

function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: SofiaInboxConversation;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const signals = activeSignals(conversation).slice(0, 2);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={cn(
          'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow]',
          isSelected ? 'border-brand-400/40 bg-brand-400/10 shadow-soft' : 'border-white/10 bg-white/[0.03] hover:border-brand-400/30 hover:bg-white/[0.06]',
        )}
        data-testid={`sofia-conversations-item-${conversation.id}`}
      >
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            avatarClassFromId(conversation.id, 'console'),
          )}
          aria-hidden="true"
        >
          {initialsFromLabel(conversation.customerLabel)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[12.5px] font-bold text-white">{conversation.customerLabel}</p>
            {conversation.unreadCount > 0 ? (
              <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-ink">
                {conversation.unreadCount}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-white/70">{conversation.phoneMasked ?? 'Sin identidad registrada'}</p>
          <p className="mt-1 truncate text-[12px] text-white/85">{conversation.lastMessagePreview ?? 'Sin mensajes todavía'}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {signals.map((key) => (
              <StatusBadge key={key} tone={toneFromSignal(key)} label={CONVERSATION_SIGNAL_LABEL[key]} withDot={false} variant="console" />
            ))}
            {conversation.lastMessageAt ? (
              <span className="ml-auto shrink-0 text-[10.5px] text-white/70">{formatDateTime(conversation.lastMessageAt)}</span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  );
}

function ConversationGroupSection({
  groupKey,
  label,
  hint,
  total,
  hiddenByDefault,
  conversations,
  selectedId,
  onSelect,
}: {
  groupKey: string;
  label: string;
  hint: string;
  total: number;
  hiddenByDefault: boolean | undefined;
  conversations: SofiaInboxConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(!hiddenByDefault);

  return (
    <div data-testid={`sofia-conversations-group-${groupKey}`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left"
        aria-expanded={expanded}
        data-testid={`sofia-conversations-group-${groupKey}-toggle`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/55" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/55" />}
          <span className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-white/70">{label}</span>
          {hiddenByDefault ? <StatusBadge tone="read_only" label="Oculto por defecto" className="hidden sm:inline-flex" variant="console" /> : null}
        </span>
        <span className="numeric-tabular shrink-0 text-[11px] font-bold text-white/70 [font-variant-numeric:tabular-nums]">{formatNumber(total)}</span>
      </button>
      {expanded && <p className="px-1 pb-1.5 text-[10.5px] text-white/55">{hint}</p>}

      {expanded ? (
        conversations.length === 0 ? (
          <p className="px-1 py-2 text-[11.5px] text-white/70">Sin conversaciones visibles en este grupo con el filtro actual.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedId}
                onSelect={() => onSelect(conversation.id)}
              />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export function ConversationsInboxView({ inbox }: { inbox: SofiaConversationsInbox }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => firstConversationId(inbox));
  const [filter, setFilter] = useState<FilterKey>('all');

  const selectedConversation = useMemo(() => findConversationById(inbox, selectedId), [inbox, selectedId]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7" data-testid="sofia-conversations-summary">
        <StatCard label="Total" value={formatNumber(inbox.summary.totalConversations)} icon={<InboxIcon className="h-4 w-4" />} variant="console" />
        <StatCard label="Real" value={formatNumber(inbox.summary.realConversations)} variant="console" />
        <StatCard label="Validación interna" value={formatNumber(inbox.summary.internalValidationConversations)} variant="console" />
        <StatCard label="Sandbox" value={formatNumber(inbox.summary.sandboxConversations)} variant="console" />
        <StatCard label="Histórico" value={formatNumber(inbox.summary.historicalConversations)} variant="console" />
        <StatCard label="Pendientes de revisión" value={formatNumber(inbox.summary.pendingReview)} accent="warning" variant="console" />
        <StatCard label="Enviados" value={formatNumber(inbox.summary.outboundSent)} icon={<MessagesSquare className="h-4 w-4" />} variant="console" />
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="sofia-conversations-filters" role="group" aria-label="Filtrar por señal">
        {FILTER_CHIPS.map((chip) => {
          const isActive = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              aria-pressed={isActive}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-[background-color,border-color,box-shadow]',
                isActive
                  ? 'border-brand-500 bg-brand-500 text-ink shadow-soft'
                  : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-brand-400/30 hover:bg-white/[0.06]',
              )}
              data-testid={`sofia-conversations-filter-${chip.key}`}
            >
              {chip.label}
              <span className="numeric-tabular [font-variant-numeric:tabular-nums]">{formatNumber(chip.getCount(inbox.filters, inbox.summary))}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={cn(CONSOLE_CARD_CLASS, 'lg:col-span-5')} data-testid="sofia-conversations-list">
          {inbox.summary.totalConversations === 0 ? (
            <EmptyStrip variant="console" title="Sin conversaciones" description="No hay conversaciones registradas todavía." />
          ) : (
            <div className="max-h-[38rem] space-y-4 overflow-y-auto pr-1">
              {CONVERSATION_SCOPE_GROUPS.map((group) => {
                const groupData = inbox[group.key];
                const filtered = groupData.conversations.filter((conversation) => matchesFilter(conversation, filter));
                return (
                  <ConversationGroupSection
                    key={group.key}
                    groupKey={group.key}
                    label={group.label}
                    hint={group.hint}
                    total={groupData.total}
                    hiddenByDefault={groupData.hiddenByDefault}
                    conversations={filtered}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-7">
          <ConversationDetailPanel conversation={selectedConversation} />
        </div>
      </div>
    </div>
  );
}
