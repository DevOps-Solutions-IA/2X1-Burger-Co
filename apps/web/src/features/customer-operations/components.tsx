import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleSlash2,
  LockKeyhole,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/product';
import type {
  SofiaCrmCustomerConsent,
  SofiaCrmCustomerSummary,
  SofiaInboxConversation,
} from '@/features/sofia/contracts';
import { formatDateTime } from '@/lib/format';
import {
  actorLabel,
  availableConversationActions,
  canCancelOutbound,
  humanizeCode,
  messageActor,
  scopeLabel,
  scopeTone,
  type ConversationAction,
  type TimelineActor,
} from './model';
import { useConversationOperations } from './queries';

export function ActorBadge({ actor }: { actor: TimelineActor | null }) {
  const tone = actor === 'CUSTOMER' ? 'info' : actor === 'SOFIA' ? 'success' : actor === 'HUMAN_AGENT' ? 'warning' : 'neutral';
  return <StatusBadge status={actor ?? 'UNAVAILABLE'} label={actorLabel(actor)} tone={tone} />;
}

export function IdentityList({ identities }: { identities: SofiaCrmCustomerSummary['identities'] }) {
  if (identities.length === 0) {
    return <p className="text-sm text-muted">No hay una identidad protegida disponible.</p>;
  }
  return (
    <ul className="space-y-2">
      {identities.map((identity) => (
        <li key={identity.id} className="rounded-xl border border-line bg-canvas p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                Teléfono {identity.isPrimary ? 'principal' : 'alterno'}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink">{identity.valueMasked}</p>
            </div>
            <StatusBadge
              status={identity.verifiedAt ? 'VERIFIED' : 'UNVERIFIED'}
              label={identity.verifiedAt ? 'Verificada' : 'No verificada'}
              tone={identity.verifiedAt ? 'success' : 'neutral'}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConsentList({ consents }: { consents: SofiaCrmCustomerConsent[] }) {
  if (consents.length === 0) {
    return <p className="text-sm text-muted">No hay consentimiento registrado para este perfil.</p>;
  }
  return (
    <ul className="space-y-2">
      {consents.map((consent) => (
        <li key={consent.id} className="rounded-xl border border-line bg-canvas p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">
              {consent.purpose === 'SERVICE' ? 'Servicio' : 'Marketing'} · {consent.channel}
            </p>
            <StatusBadge
              status={consent.status}
              label={consent.status === 'GRANTED' ? 'Otorgado' : 'Revocado'}
              tone={consent.status === 'GRANTED' ? 'success' : 'neutral'}
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            Fuente {consent.source} · versión {consent.version} · {formatDateTime(consent.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function UnavailableDomain({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-xl border border-dashed border-line bg-canvas p-4" aria-label={`${title}: no disponible`}>
      <div className="flex items-start gap-3">
        <CircleSlash2 className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>
    </section>
  );
}

export function PrivacyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-signal-info/25 bg-signal-info/10 p-4 text-sm leading-6 text-ink">
      <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-signal-info" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function Pagination({
  page,
  pages,
  total,
  onChange,
  disabled,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <nav className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Paginación">
      <p className="text-sm text-muted">
        {total.toLocaleString('es-CO')} registros · página {page} de {Math.max(pages, 1)}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" className="min-h-11" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
        </Button>
        <Button type="button" variant="secondary" size="sm" className="min-h-11" disabled={disabled || pages === 0 || page >= pages} onClick={() => onChange(page + 1)}>
          Siguiente <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

export function ConversationListCard({ conversation }: { conversation: SofiaInboxConversation }) {
  return (
    <article className="rounded-2xl border border-line bg-panel p-4 shadow-sm transition hover:border-brand-400/60 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-semibold text-ink">{conversation.customerLabel}</h2>
            <StatusBadge status={conversation.scope} label={scopeLabel(conversation.scope)} tone={scopeTone(conversation.scope)} />
          </div>
          <p className="mt-1 font-mono text-xs text-muted">{conversation.phoneMasked ?? 'Identidad no disponible'}</p>
        </div>
        {conversation.unreadCount > 0 ? (
          <span className="min-w-7 rounded-full bg-brand-500 px-2 py-1 text-center text-xs font-bold tabular-nums text-ink" aria-label={`${conversation.unreadCount} sin leer`}>
            {conversation.unreadCount}
          </span>
        ) : null}
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted">
        {conversation.lastMessagePreview ?? 'No hay texto sanitizado disponible.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusBadge status={conversation.humanStatus} label={humanizeCode(conversation.humanStatus)} />
        <StatusBadge status={conversation.operationalState} label={humanizeCode(conversation.operationalState)} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        <time className="text-xs tabular-nums text-muted" dateTime={conversation.lastMessageAt ?? undefined}>
          {formatDateTime(conversation.lastMessageAt)}
        </time>
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href={`/conversations/${encodeURIComponent(conversation.id)}`} aria-label={`Abrir conversación de ${conversation.customerLabel}`}>
            Abrir <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

const actionCopy: Record<ConversationAction, { label: string; icon: typeof PauseCircle }> = {
  pause: { label: 'Pausar SOFIA', icon: PauseCircle },
  resume: { label: 'Reanudar SOFIA', icon: PlayCircle },
  'take-over': { label: 'Tomar conversación', icon: UserRoundCheck },
  release: { label: 'Liberar a SOFIA', icon: Bot },
};

export function ConversationDetail({
  conversation,
  canGovern,
}: {
  conversation: SofiaInboxConversation;
  canGovern: boolean;
}) {
  const operations = useConversationOperations();
  const actions = availableConversationActions(conversation, canGovern);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5" aria-labelledby="conversation-state-heading">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <MessageCircle className="h-5 w-5 text-brand-800" aria-hidden="true" />
              <h2 id="conversation-state-heading" className="font-heading text-xl font-semibold text-ink">Estado operacional</h2>
              <StatusBadge status={conversation.scope} label={scopeLabel(conversation.scope)} tone={scopeTone(conversation.scope)} />
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">Acción recomendada: {conversation.recommendedAction}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const copy = actionCopy[action];
              const Icon = copy.icon;
              return (
                <Button
                  key={action}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  disabled={operations.isPending}
                  onClick={() => operations.action.mutate({ conversationId: conversation.id, action })}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" /> {copy.label}
                </Button>
              );
            })}
            {actions.length === 0 ? (
              <StatusBadge status="NO_ACTION" label={canGovern ? 'Sin transición disponible' : 'Acción restringida'} tone="neutral" />
            ) : null}
          </div>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-canvas p-3"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Handoff</dt><dd className="mt-1 text-sm font-semibold text-ink">{humanizeCode(conversation.humanStatus)}</dd></div>
          <div className="rounded-xl bg-canvas p-3"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">SOFIA</dt><dd className="mt-1 text-sm font-semibold text-ink">{conversation.sofiaEnabled ? 'Activa' : 'Pausada'}</dd></div>
          <div className="rounded-xl bg-canvas p-3"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">IA</dt><dd className="mt-1 text-sm font-semibold text-ink">{conversation.ai.dryRun ? 'Dry-run supervisado' : humanizeCode(conversation.ai.mode)}</dd></div>
          <div className="rounded-xl bg-canvas p-3"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Envío real</dt><dd className="mt-1 text-sm font-semibold text-signal-danger">Bloqueado</dd></div>
        </dl>
      </section>

      {conversation.operationalReasons.length ? (
        <section className="rounded-2xl border border-signal-warning/30 bg-signal-warning/10 p-4" aria-label="Motivos operativos">
          <h2 className="font-heading text-base font-semibold text-ink">Motivos operativos</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {conversation.operationalReasons.map((reason) => <StatusBadge key={reason.code} status={reason.code} label={reason.label} tone="warning" />)}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5" aria-labelledby="message-timeline-heading">
          <div className="border-b border-line pb-4">
            <h2 id="message-timeline-heading" className="font-heading text-lg font-semibold text-ink">Mensajes sanitizados</h2>
            <p className="mt-1 text-sm leading-6 text-muted">No incluye payload crudo, secretos ni razonamiento interno.</p>
          </div>
          {conversation.messages.length ? (
            <ol className="mt-5 space-y-3" aria-label="Mensajes de la conversación">
              {conversation.messages.map((message) => {
                const actor = messageActor(message);
                return (
                  <li key={message.id} className="rounded-xl border border-line bg-canvas p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ActorBadge actor={actor} />
                      <time className="text-xs tabular-nums text-muted" dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{message.bodyPreview ?? 'Mensaje sin texto disponible.'}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge status={message.status} label={humanizeCode(message.status)} />
                      {message.aiIntent ? <StatusBadge status="AI_INTENT" label={`Intención: ${humanizeCode(message.aiIntent)}`} tone="info" /> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="mt-5 text-sm text-muted">El backend no expone mensajes sanitizados para esta conversación.</p>}
        </section>

        <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5" aria-labelledby="outbox-heading">
          <div className="border-b border-line pb-4">
            <h2 id="outbox-heading" className="font-heading text-lg font-semibold text-ink">Sugerencias de SOFIA</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Borradores internos. Nunca equivalen a un mensaje enviado.</p>
          </div>
          {conversation.outboundMessages.length ? (
            <ul className="mt-5 space-y-3">
              {conversation.outboundMessages.map((outbound) => (
                <li key={outbound.id} className="rounded-xl border border-line bg-canvas p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ActorBadge actor="SOFIA" />
                    <StatusBadge
                      status={outbound.sent ? 'SENT' : outbound.status}
                      label={outbound.sent ? 'Envío detectado' : humanizeCode(outbound.status)}
                      tone={outbound.sent ? 'danger' : 'warning'}
                    />
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{outbound.bodyPreview ?? 'Sugerencia sin preview disponible.'}</p>
                  {outbound.lastError ? <p className="mt-2 text-sm text-signal-danger">{outbound.lastError}</p> : null}
                  {canCancelOutbound(outbound.status) && canGovern ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3 min-h-11"
                      disabled={operations.isPending}
                      onClick={() => operations.cancelOutbound.mutate({ outboundId: outbound.id })}
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" /> Cancelar sugerencia
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="mt-5 text-sm text-muted">No hay sugerencias internas registradas.</p>}
        </section>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Relaciones disponibles">
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Borradores</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{conversation.relatedOperationCounts.orderDrafts}</p><p className="mt-1 text-xs text-muted">Conteo real; el contrato no expone IDs navegables.</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Domicilios</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{conversation.relatedOperationCounts.deliveryOrders}</p><p className="mt-1 text-xs text-muted">Conteo real; vínculo de detalle no disponible.</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Outbox</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{conversation.outboxTotal}</p><p className="mt-1 text-xs text-muted">Sugerencias internas registradas.</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Envíos reales</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{conversation.outboundSentCount}</p><p className="mt-1 text-xs text-muted">Debe permanecer en cero en receive-only.</p></div>
      </section>
    </div>
  );
}
