'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  ExternalLink,
  MapPinned,
  Navigation,
  Radio,
  ReceiptText,
  Route,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  FilterBar,
  MetricSurface,
  PageHeader,
  QueryState,
  StatusBadge,
  Timeline,
  type TimelineItem,
} from '@/components/product';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError, apiFetch, apiFetchBlob, subscribeOperationalStream } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import { cn } from '@/lib/utils';
import {
  deliveryOrdersSchema,
  deliveryReceiptHistorySchema,
  deliveryReceiptStatusSchema,
  deliveryRidersSchema,
  locationInboxSchema,
  operationalAlertsSchema,
  type DeliveryIssueType,
  type DeliveryLocationInboxItem,
  type DeliveryOrder,
  type DeliveryReceiptHistory,
  type DeliveryReceiptStatus,
  type DeliveryWorkflowStatus,
  type OperationalAlert,
} from './contracts';

type DeliveryQueueFilter =
  | 'all'
  | 'pending'
  | 'assigned'
  | 'intransit'
  | 'issue'
  | 'sofia'
  | 'manual'
  | 'unselected'
  | 'online_pending'
  | 'nequi_pending'
  | 'cash'
  | 'paid'
  | 'manual_review'
  | 'failed';

const workflowLabels: Record<DeliveryWorkflowStatus, string> = {
  PENDING_ASSIGNMENT: 'Pendiente de asignación',
  ASSIGNED: 'Asignado',
  IN_TRANSIT: 'En tránsito',
  DELIVERED: 'Entregado',
  ISSUE: 'Con novedad',
};

const paymentLabels: Record<string, string> = {
  UNSELECTED: 'Pago sin seleccionar',
  CASH_ON_DELIVERY: 'Efectivo contra entrega',
  PENDING_MANUAL_VERIFICATION: 'Verificación manual pendiente',
  PENDING_ONLINE_PAYMENT: 'Pago en línea pendiente',
  PAID: 'Pagado (evidencia histórica)',
  FAILED: 'Pago fallido',
  MANUAL_REVIEW: 'Revisión financiera',
  CANCELLED: 'Pago cancelado',
};

const issueLabels: Record<DeliveryIssueType, string> = {
  CUSTOMER_UNREACHABLE: 'Cliente no responde',
  INCOMPLETE_ADDRESS: 'Dirección incompleta',
  LOCATION_MISMATCH: 'Ubicación en conflicto',
  PAYMENT_PENDING: 'Pago pendiente',
  DELIVERY_REJECTED: 'Entrega rechazada',
  ROUTE_INCIDENT: 'Incidente de ruta',
  OTHER: 'Otra novedad',
};

const receiptSendLabels: Record<DeliveryReceiptStatus['sendStatus'], string> = {
  NOT_REQUESTED: 'Sin solicitar',
  PENDING: 'Pendiente',
  SENT: 'Enviada',
  FAILED: 'Fallida',
  SKIPPED_NO_PHONE: 'Sin teléfono',
  SKIPPED_CHANNEL_BLOCKED: 'Canal bloqueado',
};

function queryStatus(query: { isLoading: boolean; isError: boolean; error: unknown; data: unknown }) {
  if (query.isLoading && !query.data) return 'loading' as const;
  if (query.isError) return query.error instanceof ApiError && query.error.status === 403 ? 'permission_denied' as const : 'error' as const;
  return 'ready' as const;
}

function isSofiaOrder(order: DeliveryOrder) {
  return order.whatsappDeliveryOrder?.source === 'WHATSAPP_SOFIA' || order.whatsappDeliveryOrder?.createdByAgentNameSnapshot === 'Sofía';
}

function effectiveWorkflow(order: DeliveryOrder): DeliveryWorkflowStatus {
  return order.deliveryWorkflowStatus ?? 'PENDING_ASSIGNMENT';
}

function paymentLabel(order: DeliveryOrder) {
  const status = order.whatsappDeliveryOrder?.paymentStatus;
  return status ? paymentLabels[status] ?? status.replaceAll('_', ' ') : 'Pago sin seleccionar';
}

function paymentTone(status?: string | null) {
  if (status === 'PAID') return 'warning' as const;
  if (status === 'FAILED' || status === 'CANCELLED') return 'danger' as const;
  if (status === 'MANUAL_REVIEW' || status === 'PENDING_MANUAL_VERIFICATION') return 'warning' as const;
  return 'neutral' as const;
}

function workflowTone(status: DeliveryWorkflowStatus) {
  if (status === 'DELIVERED') return 'success' as const;
  if (status === 'ISSUE') return 'danger' as const;
  if (status === 'IN_TRANSIT' || status === 'ASSIGNED') return 'info' as const;
  return 'warning' as const;
}

function matchesFilter(order: DeliveryOrder, filter: DeliveryQueueFilter) {
  const workflow = effectiveWorkflow(order);
  const payment = order.whatsappDeliveryOrder?.paymentStatus;
  if (filter === 'all') return true;
  if (filter === 'pending') return workflow === 'PENDING_ASSIGNMENT';
  if (filter === 'assigned') return workflow === 'ASSIGNED';
  if (filter === 'intransit') return workflow === 'IN_TRANSIT';
  if (filter === 'issue') return workflow === 'ISSUE';
  if (filter === 'sofia') return isSofiaOrder(order);
  if (filter === 'manual') return !isSofiaOrder(order);
  if (filter === 'unselected') return isSofiaOrder(order) && payment === 'UNSELECTED';
  if (filter === 'online_pending') return isSofiaOrder(order) && payment === 'PENDING_ONLINE_PAYMENT';
  if (filter === 'nequi_pending') return isSofiaOrder(order) && payment === 'PENDING_MANUAL_VERIFICATION';
  if (filter === 'cash') return isSofiaOrder(order) && payment === 'CASH_ON_DELIVERY';
  if (filter === 'paid') return isSofiaOrder(order) && payment === 'PAID';
  if (filter === 'manual_review') return isSofiaOrder(order) && payment === 'MANUAL_REVIEW';
  if (filter === 'failed') return isSofiaOrder(order) && payment === 'FAILED';
  return true;
}

function patchOrders(orders: DeliveryOrder[] | undefined, event: Parameters<Parameters<typeof subscribeOperationalStream>[0]>[0]) {
  if (!orders) return orders;
  if (event.type === 'delivery.workflow.updated') {
    return orders.map((order) => order.id === event.entityId
      ? { ...order, deliveryWorkflowStatus: event.workflowStatus ?? order.deliveryWorkflowStatus, updatedAt: event.at }
      : order);
  }
  if (event.type === 'delivery.location.received') {
    return orders.map((order) => order.id === event.entityId
      ? { ...order, deliveryLocationReceivedAt: order.deliveryLocationReceivedAt ?? event.at, updatedAt: event.at }
      : order);
  }
  if (event.type === 'order.updated' && (event.status === 'PAID' || event.status === 'CANCELLED')) {
    return orders.filter((order) => order.id !== event.entityId);
  }
  return orders;
}

function patchAlerts(alerts: OperationalAlert[] | undefined, event: Parameters<Parameters<typeof subscribeOperationalStream>[0]>[0]) {
  if (!alerts || event.type !== 'operational.alert.updated') return alerts;
  return alerts.map((alert) => alert.id === event.alertId
    ? {
        ...alert,
        severity: event.severity ?? alert.severity,
        status: event.status === 'ACKNOWLEDGED' || event.status === 'RESOLVED' ? event.status : alert.status,
      }
    : alert);
}

export function DeliveryOperationsScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [queueFilter, setQueueFilter] = useState<DeliveryQueueFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [riderSelection, setRiderSelection] = useState<Record<string, string>>({});
  const [locationSelection, setLocationSelection] = useState<Record<string, string>>({});
  const [issueType, setIssueType] = useState<DeliveryIssueType>('ROUTE_INCIDENT');
  const [issueNote, setIssueNote] = useState('');
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);

  const canManageAssignments = Boolean(user?.roles.some((role) => role === 'admin' || role === 'supervisor' || role === 'cashier'));
  const canReviewLocations = canManageAssignments;

  const deliveries = useQuery({
    queryKey: ['delivery-admin-orders'],
    queryFn: async () => deliveryOrdersSchema.parse(await apiFetch('/orders/delivery-active')),
    refetchInterval: visiblePolling(POLLING_INTERVAL.critical),
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
  const locationInbox = useQuery({
    queryKey: ['delivery-location-inbox'],
    queryFn: async () => locationInboxSchema.parse(await apiFetch('/orders/delivery-location-inbox?status=REQUIRES_REVIEW')),
    enabled: canReviewLocations,
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
    refetchOnWindowFocus: true,
  });
  const alerts = useQuery({
    queryKey: ['operational-alerts', 'deliveries'],
    queryFn: async () => operationalAlertsSchema.parse(await apiFetch('/orders/operational-alerts?module=deliveries')),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
    refetchOnWindowFocus: true,
  });
  const riders = useQuery({
    queryKey: ['users', 'delivery-riders'],
    queryFn: async () => deliveryRidersSchema.parse(await apiFetch('/users')),
    enabled: Boolean(user?.roles.some((role) => role === 'admin' || role === 'supervisor')),
    staleTime: POLLING_INTERVAL.reference,
  });

  const selectedOrder = deliveries.data?.find((order) => order.id === selectedOrderId) ?? null;
  const receiptStatus = useQuery({
    queryKey: ['delivery-receipt-status', selectedOrderId],
    queryFn: async () => deliveryReceiptStatusSchema.parse(await apiFetch(`/orders/${selectedOrderId}/delivery-receipt-status`)),
    enabled: Boolean(selectedOrderId),
    refetchInterval: visiblePolling(POLLING_INTERVAL.reference),
  });
  const receiptHistory = useQuery({
    queryKey: ['delivery-receipt-history', selectedOrderId],
    queryFn: async () => deliveryReceiptHistorySchema.parse(await apiFetch(`/orders/${selectedOrderId}/delivery-receipt-history`)),
    enabled: Boolean(selectedOrderId),
    staleTime: POLLING_INTERVAL.operational,
  });

  const refreshOperationalData = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['delivery-location-inbox'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries'], type: 'active' }),
    ]);
  };

  const assignRider = useMutation({
    mutationFn: ({ orderId, riderId }: { orderId: string; riderId: string }) => apiFetch(`/orders/${orderId}/assign-rider`, {
      method: 'POST',
      body: JSON.stringify({ riderId }),
    }),
    onSuccess: async () => {
      toast.success('Domiciliario asignado');
      await refreshOperationalData();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible asignar el domiciliario'),
  });
  const updateWorkflow = useMutation({
    mutationFn: (input: { orderId: string; workflowStatus: DeliveryWorkflowStatus; notes?: string; issueType?: DeliveryIssueType }) =>
      apiFetch(`/orders/${input.orderId}/delivery-workflow`, {
        method: 'POST',
        body: JSON.stringify({ workflowStatus: input.workflowStatus, notes: input.notes, issueType: input.issueType }),
      }),
    onSuccess: async () => {
      toast.success('Estado logístico actualizado');
      setIssueNote('');
      await refreshOperationalData();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar el reparto'),
  });
  const resolveLocation = useMutation({
    mutationFn: ({ inboxId, orderId, ignore }: { inboxId: string; orderId?: string; ignore?: boolean }) =>
      apiFetch<{ order?: { id: string } | null }>(`/orders/delivery-location-inbox/${inboxId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ orderId, ignore }),
      }),
    onSuccess: async (result) => {
      toast[result && 'order' in result && result.order === null ? 'warning' : 'success'](
        result && 'order' in result && result.order === null
          ? 'La ubicación entra en conflicto. No se cambió dirección, tarifa ni total.'
          : 'Ubicación logística procesada sin cambiar el total comercial.',
      );
      await refreshOperationalData();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible procesar la ubicación'),
  });
  const updateAlert = useMutation({
    mutationFn: ({ alertId, status }: { alertId: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }) =>
      apiFetch(`/orders/operational-alerts/${alertId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: async () => queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries'], type: 'active' }),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar la alerta'),
  });
  const openReceipt = useMutation({
    mutationFn: async (orderId: string) => URL.createObjectURL(await apiFetchBlob(`/orders/${orderId}/delivery-receipt`)),
    onSuccess: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo abrir la cuenta vigente'),
  });

  useEffect(() => subscribeOperationalStream((event) => {
    const relevant = event.type === 'delivery.location.received'
      || event.type === 'delivery.location.pending'
      || event.type === 'delivery.workflow.updated'
      || event.type === 'operational.alert.updated'
      || (event.type === 'order.updated' && event.orderType === 'DELIVERY')
      || (event.type === 'operational.refresh' && (event.scope === 'all' || event.scope === 'orders'));
    if (!relevant) return;
    queryClient.setQueryData<DeliveryOrder[] | undefined>(['delivery-admin-orders'], (current) => patchOrders(current, event));
    queryClient.setQueryData<OperationalAlert[] | undefined>(['operational-alerts', 'deliveries'], (current) => patchAlerts(current, event));
    void Promise.all([
      queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['delivery-location-inbox'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries'], type: 'active' }),
    ]);
  }, setStreamStatus), [queryClient]);

  const summary = useMemo(() => {
    const rows = deliveries.data ?? [];
    const sofia = rows.filter(isSofiaOrder);
    return {
      total: rows.length,
      pending: rows.filter((row) => effectiveWorkflow(row) === 'PENDING_ASSIGNMENT').length,
      assigned: rows.filter((row) => effectiveWorkflow(row) === 'ASSIGNED').length,
      inTransit: rows.filter((row) => effectiveWorkflow(row) === 'IN_TRANSIT').length,
      issue: rows.filter((row) => effectiveWorkflow(row) === 'ISSUE').length,
      sofia: sofia.length,
      manual: rows.length - sofia.length,
      unselected: sofia.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'UNSELECTED').length,
      onlinePending: sofia.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'PENDING_ONLINE_PAYMENT').length,
      nequiPending: sofia.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'PENDING_MANUAL_VERIFICATION').length,
      cash: sofia.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'CASH_ON_DELIVERY').length,
      paid: sofia.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'PAID').length,
      review: sofia.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'MANUAL_REVIEW').length,
      failed: sofia.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'FAILED').length,
    };
  }, [deliveries.data]);

  const normalizedSearch = search.trim().toLocaleLowerCase('es-CO');
  const filteredOrders = (deliveries.data ?? []).filter((order) => {
    const searchable = `${order.number} ${order.customerName ?? ''} ${order.customerPhone ?? ''} ${order.deliveryReference ?? ''}`.toLocaleLowerCase('es-CO');
    return matchesFilter(order, queueFilter) && (!normalizedSearch || searchable.includes(normalizedSearch));
  });
  const deliveryRiders = (riders.data ?? []).filter((rider) => rider.isActive && rider.roles.some((role) => role.name === 'delivery'));
  const openAlerts = (alerts.data ?? []).filter((alert) => alert.status !== 'RESOLVED');
  const pendingLocations = locationInbox.data ?? [];

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8" data-testid="deliveries-page">
      <PageHeader
        eyebrow="Control logístico"
        title="Domicilios"
        description="Opera asignaciones, tránsito, evidencia y novedades sin alterar la verdad comercial del pedido."
        status={<StatusBadge status={streamStatus === 'open' ? 'ACTIVE' : streamStatus === 'connecting' ? 'PENDING' : 'FAILED'} label={streamStatus === 'open' ? 'Actualización en vivo' : streamStatus === 'connecting' ? 'Conectando eventos' : 'Eventos desconectados'} />}
        actions={<Button type="button" variant="secondary" onClick={() => void refreshOperationalData()} disabled={deliveries.isFetching}>Actualizar datos</Button>}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Resumen logístico">
        <MetricSurface density="compact" label="Pendientes" value={summary.pending} context="Sin asignación" icon={<Clock3 className="h-5 w-5" />} unavailable={deliveries.isError} />
        <MetricSurface density="compact" label="Asignados" value={summary.assigned} context="Con responsable" icon={<UserRound className="h-5 w-5" />} unavailable={deliveries.isError} />
        <MetricSurface density="compact" label="En tránsito" value={summary.inTransit} context="Entrega activa" icon={<Navigation className="h-5 w-5" />} unavailable={deliveries.isError} />
        <MetricSurface density="compact" label="Novedades" value={summary.issue} context={`${openAlerts.length} alertas abiertas`} icon={<AlertTriangle className="h-5 w-5" />} unavailable={deliveries.isError || alerts.isError} />
        <MetricSurface density="compact" label="Ubicaciones por revisar" value={pendingLocations.length} context="Solo apoyo logístico" icon={<MapPinned className="h-5 w-5" />} unavailable={!canReviewLocations || locationInbox.isError} />
      </section>

      <section className="rounded-2xl border border-brand-200 bg-brand-50 p-4" data-testid="deliveries-sofia-ops-summary">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-heading text-sm font-semibold text-ink">Protección de verdad comercial</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">La ubicación compartida sirve únicamente para logística. Esta superficie no cambia dirección confirmada, cotización, tarifa ni total.</p>
          </div>
          <StatusBadge status="ACTIVE" label="Phase A protegida" tone="success" />
        </div>
      </section>

      <OperationalReview
        alerts={openAlerts}
        alertsStatus={queryStatus(alerts)}
        locations={pendingLocations}
        locationsStatus={canReviewLocations ? queryStatus(locationInbox) : 'permission_denied'}
        locationSelection={locationSelection}
        setLocationSelection={setLocationSelection}
        resolveLocation={resolveLocation}
        updateAlert={updateAlert}
        onRetry={() => void refreshOperationalData()}
      />

      <FilterBar
        density="compact"
        search={<Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido, cliente, teléfono o dirección" aria-label="Buscar domicilios" />}
        activeCount={Number(queueFilter !== 'all') + Number(Boolean(normalizedSearch))}
        filters={
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" data-testid="deliveries-status-filter" role="group" aria-label="Filtrar por estado logístico">
            {([
              ['all', 'Todos', summary.total],
              ['pending', 'Pendientes', summary.pending],
              ['assigned', 'Asignados', summary.assigned],
              ['intransit', 'En tránsito', summary.inTransit],
              ['issue', 'Novedad', summary.issue],
            ] as const).map(([key, label, count]) => <FilterButton key={key} id={key} label={label} count={count} selected={queueFilter === key} onClick={() => setQueueFilter(key)} />)}
          </div>
        }
        actions={<Button type="button" variant="ghost" onClick={() => { setQueueFilter('all'); setSearch(''); }}>Limpiar</Button>}
      />

      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="deliveries-sofia-ops-filters" role="group" aria-label="Filtrar por origen y evidencia de pago">
        {([
          ['sofia', 'Sofía', summary.sofia],
          ['manual', 'Otros canales', summary.manual],
          ['unselected', 'Sin pago', summary.unselected],
          ['online_pending', 'Online pendiente', summary.onlinePending],
          ['nequi_pending', 'Manual pendiente', summary.nequiPending],
          ['cash', 'Contra entrega', summary.cash],
          ['paid', 'Pagados', summary.paid],
          ['manual_review', 'Revisión', summary.review],
          ['failed', 'Fallidos', summary.failed],
        ] as const).map(([key, label, count]) => <FilterButton key={key} id={key} label={label} count={count} selected={queueFilter === key} onClick={() => setQueueFilter(key)} compact />)}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.65fr)]">
        <section className="min-w-0 rounded-2xl border border-line bg-panel shadow-sm" aria-labelledby="delivery-queue-title">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4">
            <div>
              <h2 id="delivery-queue-title" className="font-heading text-base font-semibold text-ink">Cola operativa</h2>
              <p className="mt-1 text-sm text-muted">{filteredOrders.length} de {summary.total} domicilios activos</p>
            </div>
            <Radio className={cn('h-5 w-5', streamStatus === 'open' ? 'text-signal-success' : 'text-muted')} aria-hidden="true" />
          </div>
          <div className="max-h-[44rem] space-y-2 overflow-y-auto p-3" data-testid="deliveries-queue-list">
            <QueryState
              status={queryStatus(deliveries)}
              title={deliveries.isError ? 'No se pudo cargar la cola' : undefined}
              onRetry={() => void deliveries.refetch()}
              skeletonRows={6}
            >
              {filteredOrders.length === 0 ? (
                <QueryState status="empty" title="Sin domicilios para este filtro" description="Ajusta los filtros; no se generan pedidos de ejemplo." />
              ) : filteredOrders.map((order) => (
                <DeliveryQueueItem
                  key={order.id}
                  order={order}
                  selected={order.id === selectedOrderId}
                  buttonRef={order.id === selectedOrderId ? selectedTriggerRef : undefined}
                  onSelect={() => setSelectedOrderId(order.id)}
                />
              ))}
            </QueryState>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-panel shadow-sm" data-testid="deliveries-detail">
          {!selectedOrder ? (
            <QueryState status="empty" className="m-4 min-h-72" title="Selecciona un domicilio" description="Elige un pedido de la cola para revisar su evidencia y operar el flujo autorizado." />
          ) : (
            <DeliveryDetail
              order={selectedOrder}
              receiptStatus={receiptStatus.data}
              receiptHistory={receiptHistory.data}
              receiptLoading={receiptStatus.isLoading || receiptHistory.isLoading}
              receiptError={receiptStatus.isError || receiptHistory.isError}
              riders={deliveryRiders}
              riderValue={riderSelection[selectedOrder.id] ?? selectedOrder.assignedRiderId ?? ''}
              setRiderValue={(value) => setRiderSelection((current) => ({ ...current, [selectedOrder.id]: value }))}
              canManageAssignments={canManageAssignments}
              assignmentDirectoryAvailable={!riders.isError && riders.isEnabled}
              assignRider={assignRider}
              updateWorkflow={updateWorkflow}
              issueType={issueType}
              setIssueType={setIssueType}
              issueNote={issueNote}
              setIssueNote={setIssueNote}
              openReceipt={openReceipt}
            />
          )}
        </section>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {selectedOrder ? `Domicilio ${selectedOrder.number}: ${workflowLabels[effectiveWorkflow(selectedOrder)]}.` : 'Ningún domicilio seleccionado.'}
      </p>
    </div>
  );
}

function FilterButton({ id, label, count, selected, onClick, compact = false }: { id: DeliveryQueueFilter; label: string; count: number; selected: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'shrink-0 rounded-xl border font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100',
        compact ? 'min-h-10 px-3 text-xs' : 'min-h-11 px-3.5 text-sm',
        selected ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-muted hover:border-brand-300 hover:text-ink',
      )}
      data-testid={`deliveries-filter-${id.replaceAll('_', '-')}`}
    >
      {label} <span className="ml-1 tabular-nums opacity-75">{count}</span>
    </button>
  );
}

function DeliveryQueueItem({ order, selected, onSelect, buttonRef }: { order: DeliveryOrder; selected: boolean; onSelect: () => void; buttonRef?: React.RefObject<HTMLButtonElement | null> }) {
  const workflow = effectiveWorkflow(order);
  const sofia = isSofiaOrder(order);
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100',
        selected ? 'border-ink bg-ink text-white shadow-soft' : 'border-line bg-panel hover:border-brand-300 hover:bg-brand-50/40',
      )}
      data-testid={sofia ? 'deliveries-sofia-queue-item' : 'deliveries-queue-item'}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-sm font-bold">{order.number}</span>
            {sofia ? <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', selected ? 'border-white/25 text-white' : 'border-brand-300 bg-brand-50 text-brand-900')} data-testid="deliveries-sofia-order-chip">Sofía</span> : null}
          </div>
          <p className={cn('mt-1 truncate text-sm', selected ? 'text-stone-200' : 'text-muted')}>{order.customerName ?? 'Cliente sin nombre'}</p>
        </div>
        <span className="shrink-0 font-heading text-sm font-bold tabular-nums">{formatCurrency(Number(order.subtotal))}</span>
      </div>
      <p className={cn('mt-2 line-clamp-2 text-xs leading-5', selected ? 'text-stone-300' : 'text-muted')}>{order.deliveryReference ?? 'Dirección no registrada'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusBadge status={workflow} label={workflowLabels[workflow]} tone={workflowTone(workflow)} className={selected ? 'border-white/20 bg-white/10 text-white' : undefined} />
        {sofia ? <span data-testid="deliveries-sofia-payment-status"><StatusBadge status={order.whatsappDeliveryOrder?.paymentStatus ?? 'UNSELECTED'} label={paymentLabel(order)} tone={paymentTone(order.whatsappDeliveryOrder?.paymentStatus)} className={selected ? 'border-white/20 bg-white/10 text-white' : undefined} /></span> : null}
      </div>
    </button>
  );
}

function OperationalReview({
  alerts,
  alertsStatus,
  locations,
  locationsStatus,
  locationSelection,
  setLocationSelection,
  resolveLocation,
  updateAlert,
  onRetry,
}: {
  alerts: OperationalAlert[];
  alertsStatus: ReturnType<typeof queryStatus>;
  locations: DeliveryLocationInboxItem[];
  locationsStatus: ReturnType<typeof queryStatus>;
  locationSelection: Record<string, string>;
  setLocationSelection: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  resolveLocation: ReturnType<typeof useMutation<unknown, Error, { inboxId: string; orderId?: string; ignore?: boolean }>>;
  updateAlert: ReturnType<typeof useMutation<unknown, Error, { alertId: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }>>;
  onRetry: () => void;
}) {
  if (alerts.length === 0 && locations.length === 0 && alertsStatus === 'ready' && locationsStatus === 'ready') return null;
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm" data-testid="deliveries-alerts-panel" aria-labelledby="operational-review-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="operational-review-title" className="font-heading text-base font-semibold text-ink">Revisión operativa</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Alertas y ubicaciones que requieren una decisión humana explícita.</p>
        </div>
        <StatusBadge status={alerts.length + locations.length > 0 ? 'PENDING' : 'RESOLVED'} label={`${alerts.length + locations.length} pendientes`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Alertas</h3>
          <div className="mt-2 space-y-2">
            <QueryState status={alertsStatus} onRetry={onRetry} skeletonRows={2}>
              {alerts.length === 0 ? <p className="rounded-xl bg-canvas p-3 text-sm text-muted">Sin alertas abiertas.</p> : alerts.slice(0, 6).map((alert) => (
                <article key={alert.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <StatusBadge status={alert.severity} label={alert.severity === 'CRITICAL' ? 'Crítica' : alert.severity === 'WARNING' ? 'Advertencia' : 'Información'} tone={alert.severity === 'CRITICAL' ? 'danger' : alert.severity === 'WARNING' ? 'warning' : 'info'} />
                      <h4 className="mt-2 text-sm font-semibold text-ink">{alert.title}</h4>
                      <p className="mt-1 text-sm leading-5 text-muted">{alert.message}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {alert.status === 'OPEN' ? <Button size="sm" variant="secondary" onClick={() => updateAlert.mutate({ alertId: alert.id, status: 'ACKNOWLEDGED' })}>Revisada</Button> : null}
                      <Button size="sm" variant="ghost" onClick={() => updateAlert.mutate({ alertId: alert.id, status: 'RESOLVED' })}>Resolver</Button>
                    </div>
                  </div>
                </article>
              ))}
            </QueryState>
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Ubicaciones en conflicto</h3>
          <div className="mt-2 space-y-2">
            <QueryState status={locationsStatus} onRetry={onRetry} skeletonRows={2}>
              {locations.length === 0 ? <p className="rounded-xl bg-canvas p-3 text-sm text-muted">Sin ubicaciones pendientes.</p> : locations.map((item) => {
                const selected = locationSelection[item.id] ?? '';
                const conflict = item.matchedRule === 'coordinate_conflict';
                return (
                  <article key={item.id} className={cn('rounded-xl border p-3', conflict ? 'border-signal-warning/30 bg-signal-warning/5' : 'border-line')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={conflict ? 'FINANCIAL_REVIEW_REQUIRED' : 'PENDING'} label={conflict ? 'Conflicto de coordenadas' : 'Requiere asociación'} tone="warning" />
                      <time className="text-xs text-muted">{formatDateTime(item.receivedAt)}</time>
                    </div>
                    <p className="mt-2 text-sm leading-5 text-muted">{item.processingNotes ?? 'Ubicación recibida pendiente de revisión.'}</p>
                    <p className="mt-1 text-xs font-semibold text-signal-warning">Aplicarla nunca cambia dirección, tarifa, cotización ni total.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <label className="min-w-0 flex-1 text-xs font-semibold text-muted">
                        Pedido logístico
                        <Select className="mt-1" value={selected} onChange={(event) => setLocationSelection((current) => ({ ...current, [item.id]: event.target.value }))}>
                          <option value="">Selecciona un pedido</option>
                          {item.candidateOrders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.customerName ?? 'Sin nombre'}</option>)}
                        </Select>
                      </label>
                      <div className="flex items-end gap-2">
                        <Button size="sm" onClick={() => resolveLocation.mutate({ inboxId: item.id, orderId: selected })} disabled={!selected || resolveLocation.isPending}>Aplicar</Button>
                        <Button size="sm" variant="ghost" onClick={() => resolveLocation.mutate({ inboxId: item.id, ignore: true })} disabled={resolveLocation.isPending}>Ignorar</Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </QueryState>
          </div>
        </div>
      </div>
    </section>
  );
}

function DeliveryDetail({
  order,
  receiptStatus,
  receiptHistory,
  receiptLoading,
  receiptError,
  riders,
  riderValue,
  setRiderValue,
  canManageAssignments,
  assignmentDirectoryAvailable,
  assignRider,
  updateWorkflow,
  issueType,
  setIssueType,
  issueNote,
  setIssueNote,
  openReceipt,
}: {
  order: DeliveryOrder;
  receiptStatus?: DeliveryReceiptStatus;
  receiptHistory?: DeliveryReceiptHistory;
  receiptLoading: boolean;
  receiptError: boolean;
  riders: Array<{ id: string; fullName: string }>;
  riderValue: string;
  setRiderValue: (value: string) => void;
  canManageAssignments: boolean;
  assignmentDirectoryAvailable: boolean;
  assignRider: ReturnType<typeof useMutation<unknown, Error, { orderId: string; riderId: string }>>;
  updateWorkflow: ReturnType<typeof useMutation<unknown, Error, { orderId: string; workflowStatus: DeliveryWorkflowStatus; notes?: string; issueType?: DeliveryIssueType }>>;
  issueType: DeliveryIssueType;
  setIssueType: (value: DeliveryIssueType) => void;
  issueNote: string;
  setIssueNote: (value: string) => void;
  openReceipt: ReturnType<typeof useMutation<string, Error, string>>;
}) {
  const workflow = effectiveWorkflow(order);
  const sofia = isSofiaOrder(order);
  const timeline = buildTimeline(order, receiptHistory);
  const canTransit = Boolean(order.assignedRiderId) && (workflow === 'ASSIGNED' || workflow === 'ISSUE');
  const canDeliver = Boolean(order.assignedRiderId) && workflow === 'IN_TRANSIT';

  return (
    <div className="divide-y divide-line">
      <header className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-bold text-ink">{order.number}</h2>
              <StatusBadge status={workflow} label={workflowLabels[workflow]} tone={workflowTone(workflow)} />
              {sofia ? <span data-testid="deliveries-detail-sofia-chip"><StatusBadge status="ACTIVE" label="Sofía / WhatsApp" tone="info" /></span> : null}
              {sofia ? <span data-testid="deliveries-detail-sofia-payment-badge"><StatusBadge status={order.whatsappDeliveryOrder?.paymentStatus ?? 'UNSELECTED'} label={paymentLabel(order)} tone={paymentTone(order.whatsappDeliveryOrder?.paymentStatus)} /></span> : null}
            </div>
            <p className="mt-2 text-sm text-muted">{order.customerName ?? 'Cliente sin nombre'} · {order.customerPhone ?? 'Sin teléfono'}</p>
            {sofia ? <p className="mt-1 text-xs font-semibold text-brand-900" data-testid="deliveries-detail-sofia-payment">Origen Sofía / WhatsApp · {paymentLabel(order)}</p> : null}
          </div>
          <div className="rounded-xl bg-canvas px-4 py-3 text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Total comercial</p>
            <p className="mt-1 font-heading text-xl font-bold tabular-nums text-ink">{formatCurrency(Number(order.subtotal))}</p>
            <p className="mt-1 text-xs text-muted">Incluye tarifa persistida de {formatCurrency(Number(order.deliveryFee))}</p>
          </div>
        </div>
      </header>

      <section className="p-4 sm:p-5" aria-labelledby="delivery-location-title">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <h3 id="delivery-location-title" className="text-xs font-semibold uppercase tracking-wider text-muted">Dirección comercial confirmada</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{order.deliveryReference ?? 'No registrada'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge status={order.deliveryLocationReceivedAt ? 'ACTIVE' : 'PENDING'} label={order.deliveryLocationReceivedAt ? 'Ubicación logística recibida' : 'Ubicación logística pendiente'} tone={order.deliveryLocationReceivedAt ? 'success' : 'warning'} />
              {order.deliveryZoneLabel ? <StatusBadge status="ACTIVE" label={order.deliveryZoneLabel} tone="neutral" /> : null}
              {order.deliveryDistanceKm != null ? <StatusBadge status="ACTIVE" label={`${Number(order.deliveryDistanceKm).toFixed(1)} km`} tone="neutral" /> : null}
            </div>
          </div>
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-3">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-900" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-ink">Ubicación protegida</h3>
                <p className="mt-1 text-sm leading-5 text-muted">Las coordenadas ayudan al reparto. No cambian dirección, cotización, tarifa, total ni versión comercial.</p>
              </div>
            </div>
            {order.deliveryLatitude != null && order.deliveryLongitude != null ? (
              <Button asChild size="sm" variant="secondary" className="mt-3">
                <a href={`https://www.google.com/maps/search/?api=1&query=${order.deliveryLatitude},${order.deliveryLongitude}`} target="_blank" rel="noreferrer"><MapPinned className="h-4 w-4" aria-hidden="true" />Abrir mapa</a>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="p-4 sm:p-5" data-testid="deliveries-receipt-panel" aria-labelledby="delivery-receipt-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 id="delivery-receipt-title" className="text-xs font-semibold uppercase tracking-wider text-muted">Cuenta de domicilio</h3>
            {receiptStatus ? (
              <div className="mt-2">
                <p className="text-sm font-semibold text-ink" data-testid="deliveries-receipt-version">Versión {receiptStatus.version} · VIGENTE</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span data-testid="deliveries-receipt-send-status"><StatusBadge status={receiptStatus.sendStatus} label={receiptSendLabels[receiptStatus.sendStatus]} tone={receiptStatus.sendStatus === 'SENT' ? 'success' : receiptStatus.sendStatus === 'FAILED' ? 'danger' : 'warning'} /></span>
                  <StatusBadge status="ACTIVE" label={`Total ${formatCurrency(receiptStatus.total)}`} tone="neutral" />
                </div>
                <p className="mt-2 text-xs text-muted">Generada {formatDateTime(receiptStatus.lastGeneratedAt)}</p>
              </div>
            ) : <p className="mt-2 text-sm text-muted">{receiptLoading ? 'Consultando cuenta vigente…' : receiptError ? 'La evidencia de cuenta no está disponible.' : 'Sin evidencia de cuenta.'}</p>}
          </div>
          <Button size="sm" variant="secondary" onClick={() => openReceipt.mutate(order.id)} disabled={openReceipt.isPending} data-testid="deliveries-receipt-view"><ExternalLink className="h-4 w-4" aria-hidden="true" />Ver cuenta vigente</Button>
        </div>
      </section>

      {sofia ? <HistoricalPaymentEvidence order={order} /> : null}

      {order.deliveryIssues.length > 0 ? (
        <section className="bg-signal-danger/5 p-4 sm:p-5" aria-labelledby="delivery-issues-title">
          <h3 id="delivery-issues-title" className="text-xs font-semibold uppercase tracking-wider text-signal-danger">Novedades abiertas</h3>
          <div className="mt-3 space-y-2">
            {order.deliveryIssues.map((issue) => <article key={issue.id} className="rounded-xl border border-signal-danger/20 bg-panel p-3"><p className="text-sm font-semibold text-ink">{issueLabels[issue.issueType]}</p><p className="mt-1 text-sm text-muted">{issue.summary}</p><time className="mt-2 block text-xs text-muted">{formatDateTime(issue.createdAt)}</time></article>)}
          </div>
        </section>
      ) : null}

      <section className="p-4 sm:p-5" aria-labelledby="delivery-assignment-title">
        <h3 id="delivery-assignment-title" className="text-xs font-semibold uppercase tracking-wider text-muted">Asignación</h3>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" data-testid="deliveries-rider-select">
          <label className="min-w-0 flex-1 text-sm font-semibold text-ink">
            Domiciliario
            <Select className="mt-1" value={riderValue} onChange={(event) => setRiderValue(event.target.value)} disabled={!canManageAssignments || !assignmentDirectoryAvailable}>
              <option value="">Sin asignar</option>
              {riders.map((rider) => <option key={rider.id} value={rider.id}>{rider.fullName}</option>)}
            </Select>
          </label>
          <Button size="sm" onClick={() => assignRider.mutate({ orderId: order.id, riderId: riderValue })} disabled={!canManageAssignments || !riderValue || assignRider.isPending} data-testid="deliveries-assign-button">Asignar</Button>
        </div>
        {!assignmentDirectoryAvailable && canManageAssignments ? <p className="mt-2 text-xs text-signal-warning">El directorio de domiciliarios no está disponible para este rol o sesión. No se inventan opciones.</p> : null}
      </section>

      <section className="p-4 sm:p-5" aria-labelledby="delivery-flow-title">
        <h3 id="delivery-flow-title" className="text-xs font-semibold uppercase tracking-wider text-muted">Transición operativa</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <Button variant="secondary" onClick={() => updateWorkflow.mutate({ orderId: order.id, workflowStatus: 'ASSIGNED' })} disabled={updateWorkflow.isPending || !order.assignedRiderId || workflow === 'ASSIGNED' || workflow === 'IN_TRANSIT' || workflow === 'DELIVERED'}><UserRound className="h-4 w-4" aria-hidden="true" />Confirmar asignación</Button>
          <Button variant="secondary" onClick={() => updateWorkflow.mutate({ orderId: order.id, workflowStatus: 'IN_TRANSIT' })} disabled={updateWorkflow.isPending || !canTransit}><Navigation className="h-4 w-4" aria-hidden="true" />Marcar en tránsito</Button>
          <Button variant="secondary" onClick={() => updateWorkflow.mutate({ orderId: order.id, workflowStatus: 'DELIVERED' })} disabled={updateWorkflow.isPending || !canDeliver} data-testid="deliveries-delivered-button"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Marcar entregado</Button>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-canvas p-3">
          <div className="grid gap-3 lg:grid-cols-[0.8fr_1.6fr_auto] lg:items-end">
            <label className="text-sm font-semibold text-ink">Tipo de novedad<Select className="mt-1" value={issueType} onChange={(event) => setIssueType(event.target.value as DeliveryIssueType)}>{Object.entries(issueLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
            <label className="text-sm font-semibold text-ink">Detalle operativo<Textarea className="mt-1 min-h-11" rows={2} maxLength={240} value={issueNote} onChange={(event) => setIssueNote(event.target.value)} placeholder="Describe el hecho sin prometer compensaciones" /></label>
            <Button variant="secondary" className="text-signal-danger" onClick={() => updateWorkflow.mutate({ orderId: order.id, workflowStatus: 'ISSUE', issueType, notes: issueNote.trim() || undefined })} disabled={updateWorkflow.isPending} data-testid="deliveries-incident-button"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Registrar novedad</Button>
          </div>
        </div>
      </section>

      <section className="p-4 sm:p-5" aria-labelledby="delivery-evidence-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="delivery-evidence-title" className="text-xs font-semibold uppercase tracking-wider text-muted">Evidencia y línea de tiempo</h3>
          <StatusBadge status="ACTIVE" label={`${timeline.length} eventos visibles`} tone="neutral" />
        </div>
        <Timeline className="mt-4" density="compact" items={timeline} label={`Evidencia del domicilio ${order.number}`} />
      </section>
    </div>
  );
}

function HistoricalPaymentEvidence({ order }: { order: DeliveryOrder }) {
  const historical = order.whatsappDeliveryOrder;
  if (!historical) return null;
  return (
    <section className="bg-canvas p-4 sm:p-5" data-testid="deliveries-sofia-payment-link-panel" aria-labelledby="historical-payment-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="historical-payment-title" className="text-xs font-semibold uppercase tracking-wider text-muted">Evidencia histórica Sofía</h3>
          <p className="mt-2 text-sm font-semibold text-ink" data-testid="deliveries-sofia-payment-link-status">{historical.orderReference ?? 'Sin referencia histórica'} · {paymentLabel(order)}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" data-testid="deliveries-sofia-origin-detail">
            <span>Fuente: Sofía / WhatsApp</span><span>Webhook: {historical.webhookEventCount} evento(s)</span><span>Proveedor: {historical.onlinePaymentProvider ?? 'No registrado'}</span>
          </div>
        </div>
        {historical.orderReference ? <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(historical.orderReference!); toast.success('Referencia copiada'); }} data-testid="deliveries-sofia-copy-reference"><Copy className="h-4 w-4" aria-hidden="true" />Copiar referencia</Button> : null}
      </div>
      <div className="mt-3 rounded-xl border border-signal-warning/25 bg-signal-warning/5 p-3" data-testid="deliveries-sofia-payment-read-only"><p className="text-sm font-semibold text-ink">Solo lectura</p><p className="mt-1 text-sm leading-5 text-muted">Este panel no crea enlaces ni cambia estados financieros. La autoridad de pago permanece en el checkout canónico.</p></div>
      {historical.paymentEvents.length > 0 ? <div className="mt-3 space-y-2" data-testid="deliveries-sofia-payment-events">{historical.paymentEvents.slice(0, 5).map((event) => <article key={event.id} className="rounded-xl border border-line bg-panel p-3"><p className="text-sm font-semibold text-ink">{event.previousStatus ? `${paymentLabels[event.previousStatus] ?? event.previousStatus} → ` : ''}{paymentLabels[event.newStatus] ?? event.newStatus}</p><p className="mt-1 text-xs text-muted">{event.message ?? event.eventType} · {formatDateTime(event.createdAt)}</p></article>)}</div> : null}
    </section>
  );
}

function buildTimeline(order: DeliveryOrder, history?: DeliveryReceiptHistory): TimelineItem[] {
  const items: Array<TimelineItem & { sortAt: string }> = [];
  for (const version of history?.versions ?? []) {
    items.push({
      id: `receipt-${version.version}`,
      sortAt: version.generatedAt,
      title: `Cuenta versión ${version.version} · ${version.status === 'ACTIVE' ? 'Vigente' : 'Reemplazada'}`,
      timestamp: formatDateTime(version.generatedAt),
      description: `${version.summary}${version.newTotal != null ? ` · Total ${formatCurrency(version.newTotal)}` : ''}`,
      tone: version.status === 'ACTIVE' ? 'success' : 'neutral',
      icon: <ReceiptText className="h-4 w-4" />,
    });
  }
  if (order.deliveryLocationReceivedAt) {
    items.push({ id: 'location', sortAt: order.deliveryLocationReceivedAt, title: 'Ubicación recibida para logística', timestamp: formatDateTime(order.deliveryLocationReceivedAt), description: 'Sin cambios en dirección, tarifa ni total comercial.', tone: 'info', icon: <MapPinned className="h-4 w-4" /> });
  }
  for (const issue of order.deliveryIssues) {
    items.push({ id: `issue-${issue.id}`, sortAt: issue.createdAt, title: issueLabels[issue.issueType], timestamp: formatDateTime(issue.createdAt), description: issue.summary, tone: 'danger', icon: <AlertTriangle className="h-4 w-4" /> });
  }
  for (const event of order.whatsappDeliveryOrder?.paymentEvents ?? []) {
    items.push({ id: `payment-${event.id}`, sortAt: event.createdAt, title: 'Evidencia histórica de pago', timestamp: formatDateTime(event.createdAt), description: event.message ?? event.eventType, tone: paymentTone(event.newStatus), icon: <ClipboardList className="h-4 w-4" /> });
  }
  items.push({ id: 'workflow-current', sortAt: order.updatedAt, title: `Estado actual: ${workflowLabels[effectiveWorkflow(order)]}`, timestamp: formatDateTime(order.updatedAt), description: order.assignedRider?.fullName ? `Responsable: ${order.assignedRider.fullName}` : 'Sin domiciliario asignado.', tone: workflowTone(effectiveWorkflow(order)), icon: <Route className="h-4 w-4" /> });
  return items.sort((left, right) => right.sortAt.localeCompare(left.sortAt));
}
