import { MessageCircle, ShieldAlert, Sparkles, User } from 'lucide-react';
import { CONSOLE_CARD_CLASS, EmptyStrip, SectionHeading, StatusBadge } from '@/components/sofia';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SofiaInboxConversation } from '@/features/sofia/contracts';
import {
  CONVERSATION_SIGNAL_LABEL,
  MESSAGE_DIRECTION_LABEL,
  activeSignals,
  avatarClassFromId,
  initialsFromLabel,
  toneFromMessageDirection,
  toneFromSignal,
} from './format';

function ConversationFacts({ conversation }: { conversation: SofiaInboxConversation }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">Estado</p>
        <p className="mt-0.5 text-[12.5px] font-semibold text-white/85">{conversation.status}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">Estado humano</p>
        <p className="mt-0.5 text-[12.5px] font-semibold text-white/85">{conversation.humanStatus}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">Estado operacional</p>
        <p className="mt-0.5 text-[12.5px] font-semibold text-white/85">{conversation.operationalState}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">SOFIA en esta conversación</p>
        <StatusBadge
          tone={conversation.sofiaEnabled ? 'success' : 'read_only'}
          label={conversation.sofiaEnabled ? 'Habilitada' : 'Deshabilitada'}
          className="mt-0.5"
          variant="console"
        />
      </div>
    </div>
  );
}

export function ConversationDetailPanel({ conversation }: { conversation: SofiaInboxConversation | undefined }) {
  if (!conversation) {
    return (
      <div data-testid="sofia-conversations-detail-empty" className={cn(CONSOLE_CARD_CLASS, 'flex h-full items-center justify-center')}>
        <EmptyStrip
          variant="console"
          title="Selecciona una conversación"
          description="Elige una conversación de la bandeja para ver sus mensajes, señales y razones operacionales."
          icon={<MessageCircle className="h-5 w-5" />}
        />
      </div>
    );
  }

  const signals = activeSignals(conversation);

  return (
    <div data-testid="sofia-conversations-detail" className={cn(CONSOLE_CARD_CLASS, 'flex h-full flex-col')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
              avatarClassFromId(conversation.id, 'console'),
            )}
            aria-hidden="true"
          >
            {initialsFromLabel(conversation.customerLabel)}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-white">
              <User className="hidden h-4 w-4 shrink-0 text-white/55 sm:block" aria-hidden="true" />
              {conversation.customerLabel}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-white/70">{conversation.phoneMasked ?? 'Sin identidad registrada'}</p>
          </div>
        </div>
        <StatusBadge tone="read_only" label={`${conversation.provider} · ${conversation.mode}`} variant="console" />
      </div>

      <ConversationFacts conversation={conversation} />

      <div className="mt-3 rounded-xl border border-brand-400/25 bg-brand-400/[0.08] px-3.5 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-300">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Acción recomendada
        </p>
        <p className="mt-0.5 text-[12.5px] font-semibold text-brand-200">{conversation.recommendedAction}</p>
      </div>

      <div className="mt-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">Señales</p>
        {signals.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-white/70">Sin señales activas para esta conversación.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="sofia-conversations-detail-signals">
            {signals.map((key) => (
              <StatusBadge
                key={key}
                tone={toneFromSignal(key)}
                label={CONVERSATION_SIGNAL_LABEL[key]}
                data-testid={`sofia-conversations-detail-signal-${key}`}
                variant="console"
              />
            ))}
          </div>
        )}
      </div>

      {conversation.operationalReasons.length > 0 ? (
        <div className="mt-3.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
            <ShieldAlert className="h-3.5 w-3.5" /> Razones operacionales
          </p>
          <ul className="mt-1.5 space-y-1.5" data-testid="sofia-conversations-detail-reasons">
            {conversation.operationalReasons.map((reason) => (
              <li
                key={reason.code}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white/85"
                data-testid={`sofia-conversations-detail-reason-${reason.code}`}
              >
                {reason.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 min-h-0 flex-1">
        <SectionHeading icon={<MessageCircle className="h-4.5 w-4.5" />} title={`Mensajes (${conversation.messages.length})`} tone="ink" variant="console" />
        {conversation.messages.length === 0 ? (
          <EmptyStrip variant="console" className="mt-2" title="Sin mensajes" description="Esta conversación todavía no tiene mensajes registrados." />
        ) : (
          <ol className="mt-3 max-h-[26rem] space-y-2.5 overflow-y-auto pr-1" data-testid="sofia-conversations-detail-messages">
            {conversation.messages.map((message) => {
              const isOutbound = message.direction === 'OUTBOUND';
              const isSystem = message.direction === 'SYSTEM';
              return (
                <li
                  key={message.id}
                  className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}
                  data-testid={`sofia-conversations-detail-message-${message.id}`}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl border px-3.5 py-2.5 shadow-sm',
                      isSystem
                        ? 'border-white/10 bg-white/[0.06]'
                        : isOutbound
                          ? 'border-sky-400/25 bg-sky-400/[0.08]'
                          : 'border-white/10 bg-white/[0.04]',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge tone={toneFromMessageDirection(message.direction)} label={MESSAGE_DIRECTION_LABEL[message.direction]} variant="console" />
                      <p className="text-[11px] text-white/70">{formatDateTime(message.createdAt)}</p>
                    </div>
                    <p className={cn('mt-1.5 text-[12.5px] leading-5', message.bodyPreview ? 'text-white/85' : 'italic text-white/70')}>
                      {message.bodyPreview ?? 'Sin vista previa disponible'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                      <span>Estado: {message.status}</span>
                      {message.aiIntent ? <span>Intención IA: {message.aiIntent}</span> : null}
                      {message.confidence !== null ? <span>Confianza: {Math.round(message.confidence * 100)}%</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
