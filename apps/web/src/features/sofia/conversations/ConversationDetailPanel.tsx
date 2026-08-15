import { Ban, MessageCircle, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/sofia/workspace';
import { cn } from '@/lib/utils';
import type { SofiaInboxConversation } from '@/features/sofia/contracts';
import { SCOPE_LABEL, SCOPE_TONE, maskedPhoneOrLabel, toneFromFreeStatus } from './conversation-status';

export function ConversationDetailPanel({
  conversation,
  'data-testid': testId,
}: {
  conversation: SofiaInboxConversation | null;
  'data-testid'?: string;
}) {
  if (!conversation) {
    return (
      <Card className="p-4" data-testid={testId}>
        <EmptyState
          icon={<MessageCircle className="h-5 w-5" />}
          title="Selecciona una conversación"
          description="Elige una conversación de la bandeja para revisar mensajes, señales y estado de outbound."
        />
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-400">
            {maskedPhoneOrLabel(conversation.phoneMasked, conversation.customerLabel)}
          </p>
          <h2 className="text-[15px] font-semibold text-ink">{conversation.recommendedAction}</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge tone={SCOPE_TONE[conversation.scope]} label={SCOPE_LABEL[conversation.scope]} />
          <StatusBadge tone={toneFromFreeStatus(conversation.humanStatus)} label={conversation.humanStatus} />
        </div>
      </div>

      {conversation.operationalReasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="sofia-conversation-reasons">
          {conversation.operationalReasons.map((reason) => (
            <StatusBadge key={reason.code} tone="pending" label={reason.label} withDot={false} />
          ))}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-stone-400">Mensajes</p>
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {conversation.messages.length > 0 ? (
            conversation.messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'rounded-[0.9rem] border p-2.5 text-[12px]',
                  message.direction === 'INBOUND' ? 'border-sky-200 bg-sky-50' : message.direction === 'SYSTEM' ? 'border-stone-200 bg-stone-50' : 'border-sofia-200 bg-white',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge tone="read_only" label={message.direction} withDot={false} />
                  <span className="text-[10.5px] font-medium text-stone-400">{new Date(message.createdAt).toLocaleString('es-CO')}</span>
                </div>
                <p className="mt-1.5 font-medium text-stone-700">{message.bodyPreview ?? 'Sin vista previa'}</p>
                {message.aiIntent && <p className="mt-1 text-[10.5px] font-medium text-sofia-600">Intención: {message.aiIntent}</p>}
              </div>
            ))
          ) : (
            <p className="text-[12px] font-medium text-stone-500">Sin mensajes registrados.</p>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Ban className="h-3.5 w-3.5 text-red-500" />
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-stone-400">
            Outbox — envío real bloqueado ({conversation.outboundSentCount}/{conversation.outboxTotal} enviados)
          </p>
        </div>
        <div className="space-y-2">
          {conversation.outboundMessages.length > 0 ? (
            conversation.outboundMessages.map((outbound) => (
              <div key={outbound.id} className="rounded-[0.9rem] border border-stone-200 bg-white p-2.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge tone={outbound.sent ? 'failed' : 'blocked'} label={outbound.status} />
                  <span className="text-[10.5px] font-medium text-stone-400">Intentos: {outbound.attempts}</span>
                </div>
                <p className="mt-1.5 font-medium text-stone-700">{outbound.bodyPreview ?? 'Sin vista previa'}</p>
                {outbound.lastError && <p className="mt-1 text-[10.5px] font-medium text-red-600">{outbound.lastError}</p>}
              </div>
            ))
          ) : (
            <p className="text-[12px] font-medium text-stone-500">Sin mensajes salientes registrados.</p>
          )}
        </div>
      </div>

      <div className="rounded-[0.9rem] border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          Seguridad
        </div>
        <p className="mt-1 text-[12px] font-medium text-emerald-800">
          IA: {conversation.ai.provider} ({conversation.ai.mode}
          {conversation.ai.dryRun ? ', dry-run' : ''}) · SafetyGuard {conversation.safety.safetyGuard ? 'activo' : 'inactivo'} · WhatsApp no marca PAID.
        </p>
      </div>

      {conversation.technicalReasonCodes.length > 0 && (
        <details className="rounded-[0.9rem] border border-stone-200 bg-stone-50 p-3">
          <summary className="cursor-pointer text-[11px] font-semibold text-stone-500">Detalle técnico</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {conversation.technicalReasonCodes.map((code) => (
              <span key={code} className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-mono text-stone-600">
                {code}
              </span>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
