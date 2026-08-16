import { MessageCircle, ShieldAlert, User } from 'lucide-react';
import { StatusBadge } from '@/components/sofia';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SofiaInboxConversation } from '@/features/sofia/contracts';
import {
  CONVERSATION_SIGNAL_LABEL,
  MESSAGE_DIRECTION_LABEL,
  activeSignals,
  toneFromMessageDirection,
  toneFromSignal,
} from './format';

export function ConversationDetailPanel({ conversation }: { conversation: SofiaInboxConversation | undefined }) {
  if (!conversation) {
    return (
      <Card data-testid="sofia-conversations-detail-empty">
        <EmptyState
          title="Selecciona una conversación"
          description="Elige una conversación de la bandeja para ver sus mensajes, señales y razones operacionales."
          icon={<MessageCircle className="h-5 w-5" />}
        />
      </Card>
    );
  }

  const signals = activeSignals(conversation);

  return (
    <Card data-testid="sofia-conversations-detail" className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
            <User className="h-4 w-4 shrink-0 text-stone-600" aria-hidden="true" />
            {conversation.customerLabel}
          </p>
          <p className="mt-0.5 text-[11.5px] text-stone-600">{conversation.phoneMasked ?? 'Sin identidad registrada'}</p>
        </div>
        <StatusBadge tone="read_only" label={`${conversation.provider} · ${conversation.mode}`} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">Estado</p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-stone-800">{conversation.status}</p>
        </div>
        <div className="rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">Estado humano</p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-stone-800">{conversation.humanStatus}</p>
        </div>
        <div className="rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">Estado operacional</p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-stone-800">{conversation.operationalState}</p>
        </div>
        <div className="rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">SOFIA en esta conversación</p>
          <StatusBadge tone={conversation.sofiaEnabled ? 'success' : 'read_only'} label={conversation.sofiaEnabled ? 'Habilitada' : 'Deshabilitada'} className="mt-0.5" />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/70 px-3.5 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-900">Acción recomendada</p>
        <p className="mt-0.5 text-[12.5px] font-semibold text-brand-900">{conversation.recommendedAction}</p>
      </div>

      <div className="mt-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Señales</p>
        {signals.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-stone-600">Sin señales activas para esta conversación.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="sofia-conversations-detail-signals">
            {signals.map((key) => (
              <StatusBadge key={key} tone={toneFromSignal(key)} label={CONVERSATION_SIGNAL_LABEL[key]} data-testid={`sofia-conversations-detail-signal-${key}`} />
            ))}
          </div>
        )}
      </div>

      {conversation.operationalReasons.length > 0 ? (
        <div className="mt-3.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            <ShieldAlert className="h-3.5 w-3.5" /> Razones operacionales
          </p>
          <ul className="mt-1.5 space-y-1.5" data-testid="sofia-conversations-detail-reasons">
            {conversation.operationalReasons.map((reason) => (
              <li
                key={reason.code}
                className="rounded-lg border border-stone-100 bg-stone-50/70 px-3 py-1.5 text-[12px] font-semibold text-stone-700"
                data-testid={`sofia-conversations-detail-reason-${reason.code}`}
              >
                {reason.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex-1 min-h-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
          Mensajes ({conversation.messages.length})
        </p>
        {conversation.messages.length === 0 ? (
          <EmptyState className="mt-2" title="Sin mensajes" description="Esta conversación todavía no tiene mensajes registrados." />
        ) : (
          <ol className="mt-2 max-h-[26rem] space-y-2 overflow-y-auto pr-1" data-testid="sofia-conversations-detail-messages">
            {conversation.messages.map((message) => (
              <li
                key={message.id}
                className="rounded-xl border border-stone-100 bg-white px-3.5 py-2.5 shadow-sm"
                data-testid={`sofia-conversations-detail-message-${message.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge tone={toneFromMessageDirection(message.direction)} label={MESSAGE_DIRECTION_LABEL[message.direction]} />
                  <p className="text-[11px] text-stone-600">{formatDateTime(message.createdAt)}</p>
                </div>
                <p className={cn('mt-1.5 text-[12.5px] leading-5', message.bodyPreview ? 'text-stone-800' : 'text-stone-600 italic')}>
                  {message.bodyPreview ?? 'Sin vista previa disponible'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-stone-600">
                  <span>Estado: {message.status}</span>
                  {message.aiIntent ? <span>Intención IA: {message.aiIntent}</span> : null}
                  {message.confidence !== null ? <span>Confianza: {Math.round(message.confidence * 100)}%</span> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
