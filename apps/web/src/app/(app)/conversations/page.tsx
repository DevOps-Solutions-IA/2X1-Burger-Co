'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { Bot, MessageCircle, Search, ShieldAlert, UserRoundCheck } from 'lucide-react';
import {
  FilterBar,
  MetricSurface,
  ModuleTabs,
  PageHeader,
  QueryState,
  StatusBadge,
} from '@/components/product';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-provider';
import { hasPermission } from '@/features/auth/access-control';
import { ConversationListCard, PrivacyNotice } from '@/features/customer-operations/components';
import {
  conversationFilterCount,
  conversationFilters,
  filterConversations,
  type ConversationFilter,
} from '@/features/customer-operations/model';
import { useConversationInbox } from '@/features/customer-operations/queries';

export default function ConversationsPage() {
  const { user } = useAuth();
  const canRead = hasPermission(user?.permissions, 'orders.read');
  const [filter, setFilter] = useState<ConversationFilter>('operational');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const inbox = useConversationInbox(canRead);
  const data = inbox.data;
  const conversations = useMemo(
    () => filterConversations(data, filter, deferredSearch),
    [data, deferredSearch, filter],
  );

  const queryStatus = !canRead
    ? 'permission_denied'
    : inbox.isPending
      ? 'loading'
      : inbox.isError || !data
        ? 'error'
        : conversations.length === 0
          ? 'empty'
          : 'ready';

  return (
    <div className="space-y-6" data-testid="conversations-page">
      <PageHeader
        eyebrow="SOFIA operations"
        title="Conversaciones"
        description="Bandeja supervisada de mensajes sanitizados, handoff y sugerencias internas. El envío automático permanece bloqueado."
        status={
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="RECEIVE_ONLY" label="Receive-only" tone="info" />
            <StatusBadge status="OUTBOUND_BLOCKED" label="Outbound bloqueado" tone="danger" />
          </div>
        }
        actions={<Button type="button" variant="secondary" onClick={() => void inbox.refetch()} disabled={inbox.isFetching}>Actualizar</Button>}
      />

      <ModuleTabs
        label="Navegación de conversaciones"
        items={[
          { id: 'inbox', label: 'Bandeja', href: '/conversations', active: true },
          { id: 'customers', label: 'Clientes', href: '/customers' },
        ]}
      />

      {data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricSurface label="Conversaciones" value={data.summary.totalConversations.toLocaleString('es-CO')} context="Todos los ámbitos separados" icon={<MessageCircle className="h-5 w-5" />} />
          <MetricSurface label="Revisión humana" value={data.filters.humanRequired.toLocaleString('es-CO')} context="Requieren control de operador" icon={<UserRoundCheck className="h-5 w-5" />} />
          <MetricSurface label="Pendientes de revisión" value={data.summary.pendingReview.toLocaleString('es-CO')} context="Fuente operacional real" icon={<ShieldAlert className="h-5 w-5" />} />
          <MetricSurface label="Envíos reales" value={data.summary.outboundSent.toLocaleString('es-CO')} context="Debe permanecer en cero" icon={<Bot className="h-5 w-5" />} status={<StatusBadge status={data.summary.outboundSent === 0 ? 'PASS' : 'FAILED'} label={data.summary.outboundSent === 0 ? 'Seguro' : 'Revisar'} tone={data.summary.outboundSent === 0 ? 'success' : 'danger'} />} />
        </div>
      ) : null}

      <FilterBar
        activeCount={(filter === 'operational' ? 0 : 1) + (search.trim() ? 1 : 0)}
        search={
          <div className="relative">
            <label htmlFor="conversation-search" className="sr-only">Buscar conversación</label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              id="conversation-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cliente, identidad protegida, estado o mensaje"
              maxLength={120}
              autoComplete="off"
              className="pl-10 text-base sm:text-sm"
            />
          </div>
        }
        filters={conversationFilters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            aria-pressed={filter === item.id}
            className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${filter === item.id ? 'border-brand-500 bg-brand-500 text-ink' : 'border-line bg-panel text-muted hover:bg-canvas hover:text-ink'}`}
          >
            {item.label}
            {typeof conversationFilterCount(data, item.id) === 'number' ? (
              <span className="ml-2 tabular-nums">{conversationFilterCount(data, item.id)}</span>
            ) : null}
          </button>
        ))}
        actions={search || filter !== 'operational' ? (
          <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => { setSearch(''); setFilter('operational'); }}>Limpiar</Button>
        ) : undefined}
      />

      <PrivacyNotice>
        El contrato excluye teléfono completo, QR raw, payload del proveedor y razonamiento oculto. Los ámbitos sandbox e histórico permanecen separados.
      </PrivacyNotice>

      <QueryState
        status={queryStatus}
        title={inbox.isError ? 'No se pudo cargar la bandeja' : 'Sin conversaciones para este filtro'}
        description={inbox.isError ? 'El inbox operacional no está disponible. No se usan conversaciones simuladas como respaldo.' : 'No existe actividad real que coincida con la búsqueda y el ámbito seleccionados.'}
        onRetry={inbox.isError ? () => void inbox.refetch() : undefined}
      >
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Conversaciones disponibles">
          {conversations.map((conversation) => <ConversationListCard key={conversation.id} conversation={conversation} />)}
        </div>
      </QueryState>
    </div>
  );
}
