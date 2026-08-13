import type {
  SofiaCrmCustomerInteraction,
  SofiaInboxConversation,
  SofiaInboxScope,
  SofiaConversationsInbox,
} from '@/features/sofia/contracts';
import type { CrmTimelineEvent } from '@/features/crm/contracts';

export type TimelineActor = 'CUSTOMER' | 'SOFIA' | 'HUMAN_AGENT' | 'SYSTEM_EVENT';

export type ConversationFilter =
  | 'operational'
  | 'real'
  | 'internal_validation'
  | 'human_required'
  | 'payment_sensitive'
  | 'blocked'
  | 'sandbox'
  | 'historical';

export type ConversationAction = 'pause' | 'resume' | 'take-over' | 'release';

export type CustomerOperationalRelationType =
  | 'CONVERSATION'
  | 'ORDER_CHECKOUT'
  | 'PAYMENT_INTENT'
  | 'DELIVERY_EVENT'
  | 'SERVICE_CASE';

export type CustomerOperationalRelation = {
  id: string;
  type: CustomerOperationalRelationType;
  occurredAt: string;
  status: string | null;
  secondaryStatus: string | null;
  summary: string | null;
  amount: string | null;
  currency: string | null;
  href: string | null;
  financialSuccess: boolean | null;
};

export type CustomerOperationalRelationAccess = Readonly<{
  payments: boolean;
  serviceCases: boolean;
}>;

const operationalRelationTypes = new Set<CustomerOperationalRelationType>([
  'CONVERSATION',
  'ORDER_CHECKOUT',
  'PAYMENT_INTENT',
  'DELIVERY_EVENT',
  'SERVICE_CASE',
]);

function factString(facts: Record<string, unknown>, key: string) {
  const value = facts[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function customerOperationalRelations(
  events: readonly CrmTimelineEvent[],
  access: CustomerOperationalRelationAccess = { payments: true, serviceCases: true },
): CustomerOperationalRelation[] {
  return events.flatMap((event) => {
    if (!operationalRelationTypes.has(event.type as CustomerOperationalRelationType)) return [];

    const type = event.type as CustomerOperationalRelationType;
    const status = type === 'DELIVERY_EVENT'
      ? factString(event.facts, 'toStatus')
      : factString(event.facts, 'status');
    const orderTicketId = factString(event.facts, 'orderTicketId');
    const href = type === 'CONVERSATION'
      ? `/conversations/${encodeURIComponent(event.id)}`
      : type === 'PAYMENT_INTENT'
        ? access.payments ? `/payments?intent=${encodeURIComponent(event.id)}` : null
        : type === 'DELIVERY_EVENT'
          ? orderTicketId ? `/orders/${encodeURIComponent(orderTicketId)}` : null
          : type === 'SERVICE_CASE'
            ? access.serviceCases ? `/customer-service?case=${encodeURIComponent(event.id)}` : null
            : type === 'ORDER_CHECKOUT'
              ? orderTicketId ? `/orders/${encodeURIComponent(orderTicketId)}` : null
              : null;

    return [{
      id: event.id,
      type,
      occurredAt: event.occurredAt,
      status,
      secondaryStatus: type === 'CONVERSATION'
        ? factString(event.facts, 'handoffState')
        : type === 'ORDER_CHECKOUT'
          ? factString(event.facts, 'fulfillment')
          : type === 'DELIVERY_EVENT'
            ? factString(event.facts, 'fromStatus')
            : type === 'SERVICE_CASE'
              ? factString(event.facts, 'category')
              : factString(event.facts, 'provider'),
      summary: factString(event.facts, 'summary'),
      amount: type === 'PAYMENT_INTENT'
        ? factString(event.facts, 'amount')
        : type === 'ORDER_CHECKOUT'
          ? factString(event.facts, 'total')
          : null,
      currency: factString(event.facts, 'currency'),
      href,
      financialSuccess: type === 'PAYMENT_INTENT' ? status === 'SUCCEEDED' : null,
    }];
  });
}

export const conversationFilters: ReadonlyArray<{ id: ConversationFilter; label: string }> = [
  { id: 'operational', label: 'Operación' },
  { id: 'real', label: 'Real' },
  { id: 'internal_validation', label: 'Validación' },
  { id: 'human_required', label: 'Requiere humano' },
  { id: 'payment_sensitive', label: 'Pago sensible' },
  { id: 'blocked', label: 'Bloqueadas' },
  { id: 'sandbox', label: 'Sandbox' },
  { id: 'historical', label: 'Histórico' },
];

export function customerDisplayName(displayName: string | null) {
  return displayName?.trim() || 'Cliente sin nombre registrado';
}

export function humanizeCode(value: string) {
  return value
    .trim()
    .replaceAll('_', ' ')
    .toLocaleLowerCase('es-CO')
    .replace(/^./, (character) => character.toLocaleUpperCase('es-CO'));
}

export function scopeLabel(scope: SofiaInboxScope) {
  const labels: Record<SofiaInboxScope, string> = {
    real: 'Operación real',
    internal_validation: 'Validación interna',
    sandbox: 'Sandbox aislado',
    historical: 'Histórico',
  };
  return labels[scope];
}

export function scopeTone(scope: SofiaInboxScope) {
  if (scope === 'real') return 'success' as const;
  if (scope === 'internal_validation') return 'warning' as const;
  if (scope === 'sandbox') return 'info' as const;
  return 'neutral' as const;
}

export function interactionActor(interaction: SofiaCrmCustomerInteraction): TimelineActor | null {
  if (interaction.direction === 'INBOUND') return 'CUSTOMER';
  if (interaction.direction === 'INTERNAL' || interaction.channel === 'SYSTEM') return 'SYSTEM_EVENT';

  const kind = interaction.kind.toLocaleUpperCase('en-US');
  if (kind.includes('SOFIA') || kind.includes('AI_')) return 'SOFIA';
  if (kind.includes('HUMAN') || kind.includes('AGENT') || kind.includes('OPERATOR')) {
    return 'HUMAN_AGENT';
  }
  return null;
}

export function messageActor(message: SofiaInboxConversation['messages'][number]): TimelineActor | null {
  if (message.direction === 'INBOUND') return 'CUSTOMER';
  if (message.direction === 'SYSTEM') return 'SYSTEM_EVENT';
  if (message.aiIntent) return 'SOFIA';
  return null;
}

export function actorLabel(actor: TimelineActor | null) {
  const labels: Record<TimelineActor, string> = {
    CUSTOMER: 'Cliente',
    SOFIA: 'SOFIA',
    HUMAN_AGENT: 'Agente humano',
    SYSTEM_EVENT: 'Evento del sistema',
  };
  return actor ? labels[actor] : 'Actor no expuesto';
}

export function filterConversations(
  data: SofiaConversationsInbox | undefined,
  filter: ConversationFilter,
  search: string,
) {
  if (!data) return [];
  const operational = [...data.real.conversations, ...data.internalValidation.conversations];
  let conversations: SofiaInboxConversation[];
  if (filter === 'operational') conversations = operational;
  else if (filter === 'real') conversations = data.real.conversations;
  else if (filter === 'internal_validation') conversations = data.internalValidation.conversations;
  else if (filter === 'sandbox') conversations = data.sandbox.conversations;
  else if (filter === 'historical') conversations = data.historical.conversations;
  else {
    conversations = operational.filter((conversation) => {
      if (filter === 'human_required') return conversation.signals.humanRequired;
      if (filter === 'payment_sensitive') return conversation.signals.paymentSensitive;
      return conversation.signals.blocked;
    });
  }

  const term = search.trim().toLocaleLowerCase('es-CO');
  if (!term) return conversations;
  return conversations.filter((conversation) =>
    [
      conversation.customerLabel,
      conversation.phoneMasked,
      conversation.lastMessagePreview,
      conversation.operationalState,
      conversation.recommendedAction,
    ].some((value) => value?.toLocaleLowerCase('es-CO').includes(term)),
  );
}

export function conversationFilterCount(data: SofiaConversationsInbox | undefined, filter: ConversationFilter) {
  if (!data) return undefined;
  if (filter === 'operational') return data.filters.allOperational;
  if (filter === 'real') return data.real.total;
  if (filter === 'internal_validation') return data.internalValidation.total;
  if (filter === 'sandbox') return data.sandbox.total;
  if (filter === 'historical') return data.historical.total;
  if (filter === 'human_required') return data.filters.humanRequired;
  if (filter === 'payment_sensitive') return data.filters.paymentSensitive;
  return data.filters.blocked;
}

export function availableConversationActions(
  conversation: SofiaInboxConversation,
  canGovern: boolean,
): ConversationAction[] {
  if (!canGovern || !['real', 'internal_validation'].includes(conversation.scope)) return [];
  if (conversation.humanStatus === 'HUMAN_TAKEN') return ['release'];
  if (conversation.humanStatus === 'SOFIA_PAUSED') return ['resume'];

  const actions: ConversationAction[] = [];
  if (conversation.humanStatus === 'SOFIA_ACTIVE' && conversation.sofiaEnabled) actions.push('pause');
  if (['HUMAN_REQUIRED', 'SOFIA_ACTIVE'].includes(conversation.humanStatus)) actions.push('take-over');
  return actions;
}

export function canCancelOutbound(status: string) {
  return ['SUGGESTED', 'APPROVAL_PENDING', 'QUEUED', 'RETRYING'].includes(status);
}
