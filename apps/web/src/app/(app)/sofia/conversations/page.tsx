'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/ui/section-title';
import { apiFetch } from '@/lib/api';
import {
  SofiaConversationStateBadge,
  SofiaEmptyState,
  SofiaModeBadge,
  SofiaPageHero,
  SofiaSafetyDecisionBadge,
  SofiaStatusCard,
  SofiaStatusPill,
  SofiaTechnicalDetailsAccordion,
} from '@/components/sofia';

type InboxScope = 'real' | 'internal_validation' | 'sandbox' | 'historical';

type InboxConversation = {
  id: string;
  scope: InboxScope;
  customerLabel: string;
  phoneMasked: string | null;
  phoneHash: string | null;
  provider: string;
  mode: string;
  status: string;
  humanStatus: string;
  sofiaEnabled: boolean;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  operationalState: string;
  recommendedAction: string;
  signals: {
    humanRequired: boolean;
    paymentSensitive: boolean;
    unknownProduct: boolean;
    aiSuggestion: boolean;
    blocked: boolean;
    allowlistPending: boolean;
    pendingReview: boolean;
  };
  operationalReasons: Array<{ code: string; label: string }>;
  technicalReasonCodes: string[];
  messages: Array<{
    id: string;
    direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
    provider: string;
    status: string;
    bodyPreview: string | null;
    aiIntent: string | null;
    confidence: number | null;
    createdAt: string;
  }>;
  outboundMessages: Array<{
    id: string;
    bodyPreview: string | null;
    hasMedia: boolean;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    sentAt: string | null;
    sent: boolean;
    realSendingEnabled: boolean;
  }>;
  outboxTotal: number;
  outboundSentCount: number;
  relatedOperationCounts: {
    orderDrafts: number;
    deliveryOrders: number;
  };
  ai: {
    provider: string;
    mode: string;
    dryRun: boolean;
  };
  safety: {
    safetyGuard: boolean;
    sentFalseExpected: boolean;
    realSendingEnabled: boolean;
    whatsappCanMarkPaid: boolean;
  };
  updatedAt: string;
  createdAt: string;
};

type ConversationsInbox = {
  generatedAt: string;
  scope: {
    realOperationEnabled: boolean;
    realOperationReason: string;
    receiveOnly: boolean;
    sandboxHiddenByDefault: boolean;
    historicalHiddenByDefault: boolean;
  };
  real: { total: number; conversations: InboxConversation[] };
  internalValidation: { total: number; conversations: InboxConversation[] };
  sandbox: { total: number; hiddenByDefault: boolean; conversations: InboxConversation[] };
  historical: { total: number; hiddenByDefault: boolean; conversations: InboxConversation[] };
  filters: {
    allOperational: number;
    humanRequired: number;
    paymentSensitive: number;
    unknownProduct: number;
    blocked: number;
    aiSuggestions: number;
  };
  summary: {
    totalConversations: number;
    realConversations: number;
    internalValidationConversations: number;
    sandboxConversations: number;
    historicalConversations: number;
    pendingReview: number;
    outboundSent: number;
  };
  security: {
    realSendingEnabled: boolean;
    autoReplyEnabled: boolean;
    productionEnabled: boolean;
    whatsappCanMarkPaid: boolean;
    deepSeekEnabled: boolean;
    aiMode: string;
    dataPolicy: {
      noSecrets: boolean;
      noQrRaw: boolean;
      noFullPhone: boolean;
      providerPayloadExcluded: boolean;
    };
  };
};

type ConversationFilter =
  | 'real'
  | 'internal_validation'
  | 'human_required'
  | 'payment_sensitive'
  | 'unknown_product'
  | 'blocked'
  | 'sandbox'
  | 'historical';

const FILTERS: Array<{ key: ConversationFilter; label: string }> = [
  { key: 'real', label: 'Operación real' },
  { key: 'internal_validation', label: 'Validación interna' },
  { key: 'human_required', label: 'Requieren humano' },
  { key: 'payment_sensitive', label: 'Pagos sensibles' },
  { key: 'unknown_product', label: 'Producto no reconocido' },
  { key: 'blocked', label: 'Bloqueadas' },
  { key: 'sandbox', label: 'Sandbox' },
  { key: 'historical', label: 'Histórico' },
];

function formatDate(value: string | null) {
  if (!value) return 'Sin fecha';
  return new Date(value).toLocaleString('es-CO');
}

function filterConversations(data: ConversationsInbox | undefined, filter: ConversationFilter) {
  if (!data) return [];
  const operational = [...data.real.conversations, ...data.internalValidation.conversations];
  if (filter === 'real') return data.real.conversations;
  if (filter === 'internal_validation') return data.internalValidation.conversations;
  if (filter === 'sandbox') return data.sandbox.conversations;
  if (filter === 'historical') return data.historical.conversations;
  return operational.filter((conversation) => {
    if (filter === 'human_required') return conversation.signals.humanRequired;
    if (filter === 'payment_sensitive') return conversation.signals.paymentSensitive;
    if (filter === 'unknown_product') return conversation.signals.unknownProduct;
    if (filter === 'blocked') return conversation.signals.blocked;
    return false;
  });
}

function countForFilter(data: ConversationsInbox | undefined, filter: ConversationFilter) {
  if (!data) return 0;
  if (filter === 'real') return data.real.total;
  if (filter === 'internal_validation') return data.internalValidation.total;
  if (filter === 'sandbox') return data.sandbox.total;
  if (filter === 'historical') return data.historical.total;
  if (filter === 'human_required') return data.filters.humanRequired;
  if (filter === 'payment_sensitive') return data.filters.paymentSensitive;
  if (filter === 'unknown_product') return data.filters.unknownProduct;
  if (filter === 'blocked') return data.filters.blocked;
  return 0;
}

function toneForScope(scope: InboxScope): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (scope === 'real') return 'success';
  if (scope === 'internal_validation') return 'warning';
  if (scope === 'sandbox') return 'info';
  return 'neutral';
}

function scopeLabel(scope: InboxScope) {
  if (scope === 'real') return 'Operación real';
  if (scope === 'internal_validation') return 'Validación interna';
  if (scope === 'sandbox') return 'Sandbox';
  return 'Histórico';
}

function operationalStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ADDRESS_MISSING: 'Falta dirección',
    ORDER_CONFIRMATION_MISSING: 'Falta confirmación del pedido',
    P0_COMMERCIAL: 'Requiere revisión comercial',
    MAXI_FAMILY_COPY_RISK: 'Riesgo comercial',
    COMMERCIAL_RULE: 'Revisión comercial',
    UNKNOWN_PRODUCT: 'Producto no reconocido',
    PAYMENT_SENSITIVE: 'Pago sensible',
    LOW_CONFIDENCE: 'Baja confianza',
    HUMAN_REQUESTED: 'Cliente pidió humano',
    HUMAN_REQUIRED: 'Requiere humano',
    ALLOWLIST_REQUIRED: 'Número fuera de allowlist',
    DRAFT_ONLY: 'Borrador interno',
    BLOCKED: 'Bloqueada',
    FAILED: 'Falló',
    SENT: 'Envío real detectado',
    SUGGESTED: 'Sugerencia interna',
    APPROVAL_PENDING: 'Pendiente de revisión',
    QUEUED: 'En cola bloqueada',
    RECEIVED: 'Recibido',
    PROCESSED: 'Procesado',
  };
  return labels[status] ?? status.replace(/_/g, ' ').toLowerCase();
}

function selectedEmptyCopy(filter: ConversationFilter, realOperationEnabled: boolean) {
  if (filter === 'real' && !realOperationEnabled) {
    return {
      title: 'Operación real pendiente',
      description:
        'Las conversaciones comerciales reales se activarán después de validar allowlist final e inbound aceptado. Mientras tanto, revisa validaciones internas y sandbox por separado.',
    };
  }
  if (filter === 'sandbox') {
    return {
      title: 'Sandbox oculto por defecto',
      description: 'Los registros sandbox no se mezclan con operación real. Esta pestaña es solo para auditoría.',
    };
  }
  if (filter === 'historical') {
    return {
      title: 'Sin histórico visible',
      description: 'Los datos históricos se mantienen separados para evitar confundirlos con operación actual.',
    };
  }
  return {
    title: 'Sin conversaciones para este filtro',
    description: 'No hay datos reales disponibles para este estado. No se inventan conversaciones ni métricas.',
  };
}

export default function SofiaWhatsappConversationsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('real');

  const inbox = useQuery({
    queryKey: ['sofia-conversations-inbox'],
    queryFn: () => apiFetch<ConversationsInbox>('/admin/sofia/conversations/inbox'),
  });

  const data = inbox.data;
  const filteredConversations = useMemo(() => filterConversations(data, filter), [data, filter]);
  const selectedConversation = useMemo(
    () =>
      filteredConversations.find((conversation) => conversation.id === selectedId) ??
      filteredConversations[0],
    [filteredConversations, selectedId],
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['sofia-conversations-inbox'] });
  };

  const conversationAction = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: 'pause' | 'resume' | 'take-over' | 'release';
    }) => apiFetch(`/admin/sofia/conversations/${id}/${action}`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Conversación actualizada');
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la conversación.'),
  });

  const outboundCancel = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/admin/sofia/outbound/${id}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Mensaje saliente cancelado');
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar el mensaje saliente.'),
  });

  const feedbackAction = useMutation({
    mutationFn: ({ feedbackType }: { feedbackType: string }) =>
      apiFetch('/admin/sofia/learning/feedback', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: selectedConversation?.id,
          feedbackType,
          rating: feedbackType === 'GOOD_REPLY' ? 5 : 2,
          notes:
            'Feedback humano registrado desde /sofia/conversations. No se envía a proveedor externo.',
          tags: ['conversations', 'real-data'],
        }),
      }),
    onSuccess: () => toast.success('Feedback humano registrado sin entrenamiento externo'),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar feedback.'),
  });

  if (inbox.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" data-testid="sofia-whatsapp-conversations-page">
        <div className="max-w-md rounded-[1.75rem] border border-stone-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-stone-900" />
          <h1 className="mt-5 text-xl font-black text-stone-950">Cargando inbox real de Sofía</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">
            Esperando datos sanitizados del backend. No se muestran métricas ni estados hasta recibir fuente real.
          </p>
        </div>
      </div>
    );
  }

  if (inbox.isError || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" data-testid="sofia-whatsapp-conversations-page">
        <div className="max-w-md rounded-[1.75rem] border border-red-200 bg-red-50 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-600" />
          <h1 className="mt-5 text-xl font-black text-red-900">No se pudo cargar Conversations</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-red-700">
            El inbox requiere `/admin/sofia/conversations/inbox`. No se usan mocks ni datos estáticos como respaldo.
          </p>
        </div>
      </div>
    );
  }

  const emptyCopy = selectedEmptyCopy(filter, Boolean(data?.scope.realOperationEnabled));
  const aiStatus =
    data.security.deepSeekEnabled && data.security.aiMode === 'dry_run'
      ? 'DeepSeek dry-run'
      : data.security.deepSeekEnabled
        ? 'IA habilitada sin dry-run'
        : 'IA rules/fallback';

  return (
    <div className="space-y-6" data-testid="sofia-whatsapp-conversations-page">
      <SofiaPageHero
        eyebrow="Sofía Conversations"
        title="Conversaciones Sofía"
        description="Inbox supervisado para revisar mensajes, sugerencias IA y bloqueos de seguridad. Sofía no envía respuestas reales ni confirma pagos."
        statusChips={
          <>
            <SofiaStatusPill status="RECEIVE_ONLY" label="Receive-only" />
            <SofiaStatusPill status="DRY_RUN" label={aiStatus} />
            <SofiaStatusPill status="BLOCKED" label="Envío real bloqueado" />
            <SofiaStatusPill status="BLOCKED" label="Producción bloqueada" />
          </>
        }
        data-testid="sofia-conversations-hero"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="sofia-conversation-operator-summary">
        <SofiaStatusCard
          title="Operación real"
          value={String(data?.real.total ?? 0)}
          description={
            data?.scope.realOperationEnabled
              ? 'Conversaciones comerciales habilitadas.'
              : 'Pendiente: allowlist final e inbound aceptado.'
          }
          icon={MessageCircle}
          tone={data?.scope.realOperationEnabled ? 'safe' : 'pending'}
        />
        <SofiaStatusCard
          title="Validación interna"
          value={String(data?.internalValidation.total ?? 0)}
          description="Pruebas QR, transporte real o validaciones controladas separadas de clientes."
          icon={ShieldCheck}
          tone="info"
        />
        <SofiaStatusCard
          title="Revisión humana"
          value={String(data?.filters.humanRequired ?? 0)}
          description="Estados operativos que requieren operador."
          icon={UserRoundCheck}
          tone={(data?.filters.humanRequired ?? 0) > 0 ? 'pending' : 'safe'}
        />
        <SofiaStatusCard
          title="SENT real"
          value={String(data?.summary.outboundSent ?? 0)}
          description="Debe permanecer en cero durante receive-only."
          icon={Ban}
          tone={(data?.summary.outboundSent ?? 0) > 0 ? 'blocked' : 'safe'}
        />
      </section>

      <div className="rounded-[1.5rem] border border-red-200 bg-red-50 p-4 text-red-900">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-black">Acciones bloqueadas</p>
            <p className="mt-1 text-sm font-semibold leading-6">
              Envío real bloqueado, Auto reply OFF, PAID bloqueado y producción bloqueada.
              Sandbox e histórico no se suman como operación real.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.55fr]">
        <Card className="space-y-4 p-5" data-testid="sofia-whatsapp-conversations-list">
          <SectionTitle
            eyebrow="Inbox supervisado"
            title="Bandeja operativa"
            description="La clasificación viene del backend sanitizado. No se muestran teléfonos completos, QR raw ni payloads crudos."
          />

          <div className="flex flex-wrap gap-2" data-testid="sofia-conversation-filters">
            {FILTERS.map((item) => {
              const count = countForFilter(data, item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setFilter(item.key);
                    setSelectedId('');
                  }}
                  className={`rounded-full border px-3 py-2 text-[11px] font-black transition ${
                    filter === item.key
                      ? 'border-stone-950 bg-stone-950 text-white shadow-sm'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-950'
                  }`}
                >
                  {item.label} ({count})
                </button>
              );
            })}
          </div>

          {!data?.scope.realOperationEnabled ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Operación real pendiente: falta cerrar allowlist final e inbound aceptado. La vista real puede estar vacía.
            </div>
          ) : null}

          <div className="space-y-3">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedId(conversation.id)}
                className={`w-full rounded-2xl border p-4 text-left transition-all duration-200 ${
                  selectedConversation?.id === conversation.id
                    ? 'border-stone-950 bg-stone-50 shadow-sm ring-1 ring-stone-200'
                    : 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                }`}
                data-testid="sofia-conversation-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-extrabold text-stone-900" title={conversation.customerLabel}>
                      {conversation.customerLabel}
                    </p>
                    <p className="text-xs font-medium text-stone-500">
                      {conversation.phoneMasked ?? 'Teléfono no disponible'} · hash {conversation.phoneHash ?? 'n/d'}
                    </p>
                  </div>
                  <Badge tone={toneForScope(conversation.scope)}>{scopeLabel(conversation.scope)}</Badge>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-stone-600">
                  {conversation.lastMessagePreview || 'Sin preview sanitizado'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <SofiaConversationStateBadge state={conversation.operationalState} />
                  <SofiaModeBadge label={conversation.mode} tone={conversation.mode === 'receive_only' ? 'info' : 'pending'} />
                  {conversation.ai.dryRun ? <SofiaSafetyDecisionBadge status="DeepSeek dry-run" /> : null}
                  {conversation.safety.sentFalseExpected ? <SofiaModeBadge label="sent=false" tone="blocked" /> : null}
                </div>
                <p className="mt-3 text-xs font-bold text-stone-500">
                  Acción recomendada: {conversation.recommendedAction}
                </p>
              </button>
            ))}

            {!filteredConversations.length && (
              <SofiaEmptyState
                icon={MessageCircle}
                title={emptyCopy.title}
                description={emptyCopy.description}
              />
            )}
          </div>
        </Card>

        <Card className="space-y-5 p-5" data-testid="sofia-conversation-detail">
          {selectedConversation ? (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MessageCircle className="h-5 w-5 text-stone-700" />
                    <h2 className="text-2xl font-extrabold text-stone-950">
                      {selectedConversation.customerLabel}
                    </h2>
                    <Badge tone={toneForScope(selectedConversation.scope)}>
                      {scopeLabel(selectedConversation.scope)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium text-stone-500">
                    {selectedConversation.phoneMasked ?? 'Teléfono no disponible'} · {selectedConversation.provider} ·{' '}
                    {selectedConversation.mode}
                  </p>
                  <p className="mt-2 text-xs font-bold text-stone-700">
                    Acción recomendada: {selectedConversation.recommendedAction}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      conversationAction.mutate({ id: selectedConversation.id, action: 'pause' })
                    }
                  >
                    <PauseCircle className="mr-2 h-4 w-4" /> Pausar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      conversationAction.mutate({ id: selectedConversation.id, action: 'resume' })
                    }
                  >
                    <PlayCircle className="mr-2 h-4 w-4" /> Reactivar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      conversationAction.mutate({
                        id: selectedConversation.id,
                        action: 'take-over',
                      })
                    }
                  >
                    <UserRoundCheck className="mr-2 h-4 w-4" /> Tomar humano
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      conversationAction.mutate({
                        id: selectedConversation.id,
                        action: 'release',
                      })
                    }
                  >
                    <Bot className="mr-2 h-4 w-4" /> Liberar
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-500">Estado operativo</p>
                  <p className="mt-2 text-sm font-black text-stone-950">
                    {operationalStatusLabel(selectedConversation.operationalState)}
                  </p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-500">SafetyGuard</p>
                  <p className="mt-2 text-sm font-black text-stone-950">
                    {selectedConversation.safety.safetyGuard ? 'Activo' : 'No disponible'}
                  </p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-500">DeepSeek</p>
                  <p className="mt-2 text-sm font-black text-stone-950">
                    {selectedConversation.ai.dryRun ? 'dry-run' : 'No disponible'}
                  </p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-500">Envío</p>
                  <p className="mt-2 text-sm font-black text-red-700">Bloqueado</p>
                </div>
              </div>

              {selectedConversation.operationalReasons.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-black text-amber-900">Motivos operativos</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedConversation.operationalReasons.map((reason) => (
                      <Badge key={reason.code} tone="warning">
                        {reason.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <h3 className="text-sm font-extrabold uppercase tracking-[0.14em] text-stone-500">
                    Mensajes sanitizados
                  </h3>
                  <div className="mt-4 max-h-[28rem] space-y-3 overflow-auto pr-1">
                    {selectedConversation.messages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-2xl border p-3 ${
                          message.direction === 'INBOUND'
                            ? 'border-sky-200 bg-sky-50'
                            : message.direction === 'SYSTEM'
                              ? 'border-stone-200 bg-white'
                              : 'border-teal-200 bg-teal-50'
                        }`}
                        data-testid={
                          message.direction === 'INBOUND'
                            ? 'sofia-whatsapp-inbound-message'
                            : 'sofia-whatsapp-suggested-reply'
                        }
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <Badge
                            tone={
                              message.direction === 'INBOUND'
                                ? 'info'
                                : message.direction === 'SYSTEM'
                                  ? 'neutral'
                                  : 'warning'
                            }
                          >
                            {message.direction}
                          </Badge>
                          <span className="text-[11px] font-bold text-stone-400">
                            {formatDate(message.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-stone-700">
                          {message.bodyPreview || 'Mensaje sin texto disponible'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <SofiaSafetyDecisionBadge status={operationalStatusLabel(message.status)} />
                          {message.aiIntent ? <SofiaModeBadge label={message.aiIntent} tone="dryRun" /> : null}
                        </div>
                      </div>
                    ))}
                    {!selectedConversation.messages.length ? (
                      <SofiaEmptyState
                        title="Sin mensajes visibles"
                        description="El backend no devolvió mensajes sanitizados para esta conversación."
                      />
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-teal-200 bg-teal-50/50 p-4">
                  <h3 className="text-sm font-extrabold uppercase tracking-[0.14em] text-teal-800">
                    Respuestas sugeridas / outbox
                  </h3>
                  <div className="mt-4 space-y-3">
                    {selectedConversation.outboundMessages.map((outbound) => (
                      <div key={outbound.id} className="rounded-2xl border border-teal-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <SofiaSafetyDecisionBadge status={operationalStatusLabel(outbound.status)} />
                          <SofiaModeBadge label={outbound.sent ? 'sent=true' : 'sent=false'} tone={outbound.sent ? 'blocked' : 'safe'} />
                        </div>
                        <p className="mt-3 text-sm font-semibold text-stone-800">
                          {outbound.bodyPreview || 'Sin preview de sugerencia'}
                        </p>
                        {outbound.hasMedia ? (
                          <p className="mt-2 text-xs font-extrabold text-teal-800">
                            Media adjunta: sí, URL no expuesta.
                          </p>
                        ) : null}
                        {outbound.lastError ? (
                          <p className="mt-2 text-xs font-bold text-red-700">{outbound.lastError}</p>
                        ) : null}
                        <div className="mt-3 grid gap-2 rounded-xl bg-stone-50 px-3 py-3 text-xs font-semibold text-stone-700">
                          <span className="inline-flex items-center gap-2">
                            <Brain className="h-3.5 w-3.5" />
                            DeepSeek/rules: sugerencia interna, no respuesta al cliente.
                          </span>
                          <span>SafetyGuard: envío real bloqueado; sent=false obligatorio.</span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled
                            title="Envío real bloqueado en receive-only"
                          >
                            <Ban className="mr-2 h-4 w-4" /> Envío real bloqueado
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => outboundCancel.mutate({ id: outbound.id })}
                          >
                            <XCircle className="mr-2 h-4 w-4" /> Cancelar sugerencia
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!selectedConversation.outboundMessages.length ? (
                      <SofiaEmptyState
                        title="Sin sugerencias internas"
                        description="Cuando Sofía genere una respuesta candidata aparecerá aquí como draft/sugerencia, no como envío real."
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <div className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
                  <div>
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.14em] text-sky-800">
                      Operación supervisada
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-sky-800">
                      Provider {selectedConversation.provider}, modo {selectedConversation.mode}. Sofía no confirma pagos ni crea operación real desde WhatsApp.
                    </p>
                  </div>
                </div>
              </div>

              <SofiaTechnicalDetailsAccordion
                title="Ver detalle técnico"
                description="Códigos originales, señales y conteos. Colapsado por defecto para no contaminar la operación."
                data-testid="sofia-conversation-safety-detail"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <TechnicalRow label="Provider" value={selectedConversation.provider} />
                  <TechnicalRow label="Mode" value={selectedConversation.mode} />
                  <TechnicalRow label="Status" value={selectedConversation.status} />
                  <TechnicalRow label="Human status" value={selectedConversation.humanStatus} />
                  <TechnicalRow label="Outbox" value={`${selectedConversation.outboxTotal} sugerencia(s)`} />
                  <TechnicalRow label="Outbound SENT" value={String(selectedConversation.outboundSentCount)} />
                  <TechnicalRow label="Drafts Sofía" value={String(selectedConversation.relatedOperationCounts.orderDrafts)} />
                  <TechnicalRow label="Domicilios vinculados" value={String(selectedConversation.relatedOperationCounts.deliveryOrders)} />
                  <div className="rounded-2xl bg-stone-50 p-4 md:col-span-2">
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-stone-500">Reason codes técnicos</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedConversation.technicalReasonCodes.length ? (
                        selectedConversation.technicalReasonCodes.map((code) => (
                          <span
                            key={code}
                            className="inline-flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-xs font-bold text-stone-700"
                            title={code}
                          >
                            {operationalStatusLabel(code)}
                            <code className="text-[10px] font-semibold text-stone-400">{code}</code>
                          </span>
                        ))
                      ) : (
                        <span className="text-sm font-semibold text-stone-500">Sin reason codes técnicos</span>
                      )}
                    </div>
                  </div>
                </div>
              </SofiaTechnicalDetailsAccordion>

              <div
                className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
                data-testid="sofia-human-feedback-panel"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.14em] text-amber-800">
                      Feedback humano controlado
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-amber-800">
                      Registra aprendizaje interno. No cambia prompt ni catálogo automáticamente.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => feedbackAction.mutate({ feedbackType: 'GOOD_REPLY' })}
                      data-testid="sofia-feedback-good"
                    >
                      Útil
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => feedbackAction.mutate({ feedbackType: 'BAD_REPLY' })}
                      data-testid="sofia-feedback-bad"
                    >
                      Incorrecta
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        feedbackAction.mutate({ feedbackType: 'SHOULD_HAVE_HANDED_OFF' })
                      }
                      data-testid="sofia-feedback-handoff"
                    >
                      Debió pasar a humano
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <SofiaEmptyState
              icon={Clock3}
              title={emptyCopy.title}
              description={emptyCopy.description}
            />
          )}
        </Card>
      </div>

      <SofiaTechnicalDetailsAccordion
        title="Fuente de datos del inbox"
        description="Contrato backend usado por esta vista; no contiene PII completa ni payloads crudos."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <TechnicalRow label="Endpoint" value="/admin/sofia/conversations/inbox" />
          <TechnicalRow label="Generado" value={data?.generatedAt ? formatDate(data.generatedAt) : 'No disponible'} />
          <TechnicalRow label="No secretos" value={data?.security.dataPolicy.noSecrets ? 'Sí' : 'No disponible'} />
          <TechnicalRow label="No QR raw" value={data?.security.dataPolicy.noQrRaw ? 'Sí' : 'No disponible'} />
          <TechnicalRow label="No teléfono completo" value={data?.security.dataPolicy.noFullPhone ? 'Sí' : 'No disponible'} />
          <TechnicalRow label="Payload proveedor excluido" value={data?.security.dataPolicy.providerPayloadExcluded ? 'Sí' : 'No disponible'} />
        </div>
      </SofiaTechnicalDetailsAccordion>
    </div>
  );
}

function TechnicalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-stone-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <p className="mt-2 break-words text-sm font-bold text-stone-900">{value}</p>
    </div>
  );
}
