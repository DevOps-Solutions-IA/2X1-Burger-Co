'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionTitle } from '@/components/ui/section-title';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { useAuth } from '@/features/auth/auth-provider';
import { canPerformAction } from '@/features/auth/access-control';
import { apiFetch, subscribeOperationalStream } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { CacheStorage, TTL } from '@/lib/cache-storage';
import { buildWhatsAppUrl } from '@/lib/thermal-receipt';
import { Bike, CheckCircle2, Clock3, MapPinned, MessageCircle, Navigation, PackageCheck, RefreshCw, TriangleAlert, UserRound } from 'lucide-react';
import { toast } from 'sonner';

type DeliveryWorkflowStatus = 'PENDING_ASSIGNMENT' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'ISSUE';
type OrderStatus = 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
type DeliveryIssueType =
  | 'CUSTOMER_UNREACHABLE'
  | 'INCOMPLETE_ADDRESS'
  | 'LOCATION_MISMATCH'
  | 'PAYMENT_PENDING'
  | 'DELIVERY_REJECTED'
  | 'ROUTE_INCIDENT'
  | 'OTHER';

type DeliveryOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  deliveryWorkflowStatus: DeliveryWorkflowStatus | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryReference: string | null;
  deliveryLatitude: number | string | null;
  deliveryLongitude: number | string | null;
  deliveryDistanceKm: number | string | null;
  deliveryZoneLabel: string | null;
  deliveryFee: number | string;
  deliveryLocationSource: string | null;
  deliveryLocationReceivedAt: string | null;
  assignedRiderId: string | null;
  assignedRiderAt: string | null;
  assignedRider: { id: string; fullName: string } | null;
  createdBy: { id: string; fullName: string } | null;
  subtotal: number | string;
  notes: string | null;
  deliveryIssues: Array<{
    id: string;
    issueType: DeliveryIssueType;
    summary: string;
    details: string | null;
    createdAt: string;
  }>;
};

type OperationalAlert = {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  title: string;
  message: string;
  entityId: string | null;
  createdAt: string;
};

const workflowLabels: Record<DeliveryWorkflowStatus, string> = {
  PENDING_ASSIGNMENT: 'Pendiente',
  ASSIGNED: 'Asignado',
  IN_TRANSIT: 'En camino',
  DELIVERED: 'Entregado',
  ISSUE: 'Novedad',
};

const DELIVERY_RIDER_CACHE_KEY = 'inventory_fastfood_delivery_rider_orders';
const DELIVERY_RIDER_ALERTS_CACHE_KEY = 'inventory_fastfood_delivery_rider_alerts';

function formatSyncLabel(timestamp?: number) {
  if (!timestamp) {
    return 'Sin sincronización reciente';
  }

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) {
    return 'Actualizado hace instantes';
  }
  if (seconds < 60) {
    return `Actualizado hace ${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `Actualizado hace ${minutes} min`;
  }
  return `Actualizado ${formatDateTime(new Date(timestamp).toISOString())}`;
}

function getAlertTone(severity: OperationalAlert['severity']) {
  return severity === 'CRITICAL' ? 'danger' : severity === 'WARNING' ? 'warning' : 'info';
}

function getAlertSeverityLabel(severity: OperationalAlert['severity']) {
  return severity === 'CRITICAL' ? 'Crítica' : severity === 'WARNING' ? 'Advertencia' : 'Informativa';
}

function patchDeliveryOrdersSnapshot(orders: DeliveryOrder[] | undefined, event: Parameters<Parameters<typeof subscribeOperationalStream>[0]>[0]) {
  if (!orders?.length) {
    return orders;
  }

  if (event.type === 'delivery.workflow.updated') {
    return orders.map((order) =>
      order.id === event.entityId
        ? {
            ...order,
            deliveryWorkflowStatus: event.workflowStatus ?? order.deliveryWorkflowStatus,
          }
        : order,
    );
  }

  if (event.type === 'delivery.location.received') {
    return orders.map((order) =>
      order.id === event.entityId
        ? {
            ...order,
            deliveryLocationReceivedAt: order.deliveryLocationReceivedAt ?? event.at,
          }
        : order,
    );
  }

  if (event.type === 'order.updated') {
    if (event.status === 'PAID' || event.status === 'CANCELLED') {
      return orders.filter((order) => order.id !== event.entityId);
    }

    return orders;
  }

  return orders;
}

function patchOperationalAlertsSnapshot(
  alerts: OperationalAlert[] | undefined,
  event: Parameters<Parameters<typeof subscribeOperationalStream>[0]>[0],
) {
  if (event.type !== 'operational.alert.updated' || !alerts?.length) {
    return alerts;
  }

  return alerts.map((alert) =>
    alert.id === event.alertId
      ? {
          ...alert,
          severity: event.severity ?? alert.severity,
          status:
            event.status === 'OPEN' || event.status === 'ACKNOWLEDGED' || event.status === 'RESOLVED'
              ? event.status
              : alert.status,
        }
      : alert,
  );
}

export default function DeliveryPanelPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const previousOrdersRef = useRef<Map<string, DeliveryOrder>>(new Map());
  const hasSeenLiveDataRef = useRef(false);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const canUpdateDelivery = canPerformAction(
    user?.permissions,
    'delivery.update',
    user?.roles,
    ['admin', 'supervisor', 'cashier', 'delivery'],
  );

  const initialDeliveries = useMemo(() => {
    if (typeof window === 'undefined' || !user?.sub) {
      return undefined;
    }

    return CacheStorage.read<DeliveryOrder[]>(`${DELIVERY_RIDER_CACHE_KEY}:${user.sub}`) ?? undefined;
  }, [user?.sub]);

  const deliveries = useQuery({
    queryKey: ['delivery-orders', user?.sub ?? 'anonymous'],
    queryFn: () => apiFetch<DeliveryOrder[]>('/orders/delivery-active'),
    initialData: initialDeliveries,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 3_000,
  });
  const initialAlerts = useMemo(() => {
    if (typeof window === 'undefined' || !user?.sub) {
      return undefined;
    }

    return CacheStorage.read<OperationalAlert[]>(`${DELIVERY_RIDER_ALERTS_CACHE_KEY}:${user.sub}`) ?? undefined;
  }, [user?.sub]);
  const operationalAlerts = useQuery({
    queryKey: ['operational-alerts', 'deliveries', user?.sub ?? 'anonymous'],
    queryFn: () => apiFetch<OperationalAlert[]>('/orders/operational-alerts?module=deliveries'),
    initialData: initialAlerts,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 3_000,
  });

  const updateWorkflow = useMutation({
    mutationFn: ({
      orderId,
      workflowStatus,
      notes,
      issueType,
    }: {
      orderId: string;
      workflowStatus: DeliveryWorkflowStatus;
      notes?: string;
      issueType?: DeliveryIssueType;
    }) => {
      if (!canUpdateDelivery) throw new Error('No tienes permiso para actualizar entregas.');
      return apiFetch(`/orders/${orderId}/delivery-workflow`, {
        method: 'POST',
        body: JSON.stringify({ workflowStatus, notes, issueType }),
      });
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.workflowStatus === 'ASSIGNED'
          ? 'Pedido tomado'
          : variables.workflowStatus === 'IN_TRANSIT'
            ? 'Pedido marcado en camino'
            : variables.workflowStatus === 'DELIVERED'
              ? 'Pedido marcado como entregado'
              : 'Novedad registrada',
      );
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['delivery-orders', user?.sub ?? 'anonymous'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries', user?.sub ?? 'anonymous'], type: 'active' }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar el pedido'),
  });

  const summary = useMemo(() => {
    const items = deliveries.data ?? [];
    return {
      total: items.length,
      mine: items.filter((item) => item.assignedRiderId === user?.sub).length,
      inTransit: items.filter((item) => item.deliveryWorkflowStatus === 'IN_TRANSIT').length,
      pending: items.filter((item) => item.deliveryWorkflowStatus === 'PENDING_ASSIGNMENT').length,
    };
  }, [deliveries.data, user?.sub]);
  const lastSyncLabel = useMemo(
    () => formatSyncLabel(Math.max(deliveries.dataUpdatedAt || 0, operationalAlerts.dataUpdatedAt || 0)),
    [deliveries.dataUpdatedAt, operationalAlerts.dataUpdatedAt],
  );
  const criticalAlertCount = (operationalAlerts.data ?? []).filter((alert) => alert.severity === 'CRITICAL').length;
  const deliveryMetric = (value: number) => (deliveries.isError && deliveries.data === undefined ? '—' : String(value));

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.sub || !deliveries.data) {
      return;
    }

    CacheStorage.write(`${DELIVERY_RIDER_CACHE_KEY}:${user.sub}`, deliveries.data, TTL.DELIVERY_DATA);
  }, [deliveries.data, user?.sub]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.sub || !operationalAlerts.data) {
      return;
    }

    CacheStorage.write(`${DELIVERY_RIDER_ALERTS_CACHE_KEY}:${user.sub}`, operationalAlerts.data, TTL.DELIVERY_DATA);
  }, [operationalAlerts.data, user?.sub]);

  useEffect(() => {
    const currentOrders = deliveries.data ?? [];
    const nextMap = new Map(currentOrders.map((order) => [order.id, order]));

    if (!hasSeenLiveDataRef.current) {
      previousOrdersRef.current = nextMap;
      if (currentOrders.length > 0) {
        hasSeenLiveDataRef.current = true;
      }
      return;
    }

    for (const order of currentOrders) {
      const previous = previousOrdersRef.current.get(order.id);
      if (!previous) {
        continue;
      }

      if (!previous.deliveryLocationReceivedAt && order.deliveryLocationReceivedAt) {
        toast.success(`${order.number} ya tiene ubicación en vivo.`);
      }

      if (previous.deliveryWorkflowStatus !== order.deliveryWorkflowStatus && order.assignedRiderId === user?.sub) {
        if (order.deliveryWorkflowStatus === 'ASSIGNED') {
          toast.info(`${order.number} quedó a tu cargo.`);
        } else if (order.deliveryWorkflowStatus === 'IN_TRANSIT') {
          toast.info(`${order.number} ya figura en camino.`);
        } else if (order.deliveryWorkflowStatus === 'DELIVERED') {
          toast.success(`${order.number} quedó entregado.`);
        } else if (order.deliveryWorkflowStatus === 'ISSUE') {
          toast.warning(`${order.number} quedó con novedad.`);
        }
      }
    }

    for (const [orderId, previous] of previousOrdersRef.current.entries()) {
      if (nextMap.has(orderId)) {
        continue;
      }

      if (previous.assignedRiderId === user?.sub) {
        toast.success(`${previous.number} salió de tus activos. Revisa si ya quedó entregado.`);
      }
    }

    previousOrdersRef.current = nextMap;
  }, [deliveries.data, user?.sub]);

  useEffect(
    () =>
      subscribeOperationalStream(
        (event) => {
          const isRelevantEvent =
            event.type === 'operational.refresh'
              ? event.scope === 'all' || event.scope === 'orders'
              : event.type === 'delivery.location.received' ||
                event.type === 'delivery.location.pending' ||
                event.type === 'delivery.workflow.updated' ||
                event.type === 'operational.alert.updated' ||
                (event.type === 'order.updated' && event.orderType === 'DELIVERY');
          if (!isRelevantEvent) {
            return;
          }

          queryClient.setQueryData<DeliveryOrder[] | undefined>(['delivery-orders', user?.sub ?? 'anonymous'], (current) =>
            patchDeliveryOrdersSnapshot(current, event),
          );
          queryClient.setQueryData<OperationalAlert[] | undefined>(
            ['operational-alerts', 'deliveries', user?.sub ?? 'anonymous'],
            (current) => patchOperationalAlertsSnapshot(current, event),
          );

          void Promise.all([
            queryClient.refetchQueries({ queryKey: ['delivery-orders', user?.sub ?? 'anonymous'], type: 'active' }),
            queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries', user?.sub ?? 'anonymous'], type: 'active' }),
          ]);
        },
        setStreamStatus,
      ),
    [queryClient, user?.sub],
  );

  useEffect(() => {
    const refetch = async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['delivery-orders', user?.sub ?? 'anonymous'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries', user?.sub ?? 'anonymous'], type: 'active' }),
      ]);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refetch();
      }
    };

    const handleOnline = () => {
      void refetch();
    };

    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [queryClient, user?.sub]);

  return (
    <div className="space-y-6 p-4 sm:p-5">
      <SectionTitle
        eyebrow="Reparto"
        title="Domicilios — Tus entregas"
        description="Toma pedidos, confirma avances y sigue cada entrega."
        status={<Badge tone="info">{summary.total} activos</Badge>}
      />

      {!canUpdateDelivery ? (
        <StatusBanner
          tone="info"
          title="Modo consulta"
          description="Puedes revisar tus entregas, pero esta sesión no tiene la capacidad delivery.update para cambiar el flujo."
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard compact label="A mi cargo" value={deliveryMetric(summary.mine)} hint="Pedidos asignados a esta sesión" icon={<UserRound className="h-5 w-5" />} />
        <MetricCard compact label="Pendientes" value={deliveryMetric(summary.pending)} hint="Sin domiciliario confirmado" icon={<Clock3 className="h-5 w-5" />} accent="warning" />
        <MetricCard compact label="En camino" value={deliveryMetric(summary.inTransit)} hint="Pedidos despachados ahora" icon={<Navigation className="h-5 w-5" />} accent="success" />
        <MetricCard compact label="Activos" value={deliveryMetric(summary.total)} hint="Abiertos en reparto" icon={<Bike className="h-5 w-5" />} />
      </div>

      {deliveries.isError ? (
        <StatusBanner
          tone="danger"
          title={deliveries.data?.length ? 'No pudimos actualizar las entregas' : 'Entregas no disponibles'}
          description={deliveries.data?.length ? 'Mostramos la última copia segura guardada en este dispositivo.' : 'Revisa la conexión y vuelve a intentar. No asumimos que no haya pedidos.'}
          action={
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => void deliveries.refetch()} disabled={deliveries.isFetching}>
              <RefreshCw className={`h-4 w-4 ${deliveries.isFetching ? 'animate-spin' : ''}`} />
              Reintentar
            </Button>
          }
        />
      ) : null}

      {operationalAlerts.isError ? (
        <StatusBanner
          tone="warning"
          title="Alertas no disponibles"
          description="Las entregas siguen visibles, pero no podemos confirmar las alertas del turno."
          action={
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => void operationalAlerts.refetch()} disabled={operationalAlerts.isFetching}>
              Reintentar alertas
            </Button>
          }
        />
      ) : null}

      <StatusBanner
        tone="info"
        title="La ubicación es solo una ayuda logística"
        description="Abrir el mapa o recibir coordenadas no modifica la dirección comercial, la tarifa de domicilio ni el total confirmado."
      />

      <StatusBanner
        tone={streamStatus === 'open' ? 'info' : streamStatus === 'connecting' ? 'warning' : 'warning'}
        title={
          streamStatus === 'open'
            ? 'Panel en vivo'
            : streamStatus === 'connecting'
              ? 'Reconectando panel'
              : 'Panel sin conexión en vivo'
        }
        description={
          streamStatus === 'open'
            ? 'Los cambios del panel administrativo llegan aquí sin recargar.'
            : streamStatus === 'connecting'
              ? 'Conservamos el último estado útil mientras vuelve la conexión.'
              : 'Se conserva el último estado guardado. Revisa red o sesión si esto persiste.'
        }
        action={<p className="text-[12px] font-medium opacity-80">{lastSyncLabel}</p>}
      />

      {(operationalAlerts.data ?? []).length ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">Alertas del turno</p>
              <h2 className="mt-1 text-lg font-semibold text-ink">Seguimiento persistente</h2>
              <p className="mt-1 text-sm text-stone-500">Siguen visibles aunque refresques o se reconecte el panel.</p>
            </div>
            <Badge tone={criticalAlertCount > 0 ? 'danger' : 'warning'}>
              {operationalAlerts.data?.length ?? 0}
            </Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {(operationalAlerts.data ?? [])
              .filter((alert) => !alert.entityId || (deliveries.data ?? []).some((order) => order.id === alert.entityId))
              .slice(0, 6)
              .map((alert) => (
                <div key={alert.id} className="rounded-[1.2rem] border border-stone-200 bg-stone-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{alert.title}</p>
                    <Badge tone={getAlertTone(alert.severity)}>
                      {getAlertSeverityLabel(alert.severity)}
                    </Badge>
                    <Badge tone="neutral">{alert.status === 'ACKNOWLEDGED' ? 'Reconocida' : alert.status === 'RESOLVED' ? 'Resuelta' : 'Abierta'}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-stone-700">{alert.message}</p>
                  <p className="mt-2 text-xs text-stone-500">Registrada {formatDateTime(alert.createdAt)}</p>
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {deliveries.isLoading
          ? Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-48 rounded-[1.7rem]" />)
          : null}

        {!deliveries.isLoading && !deliveries.isError && !(deliveries.data?.length ?? 0) ? (
          <Card>
            <EmptyState
              title="No hay domicilios activos ahora"
              description="Cuando te asignen uno, lo vas a ver acá."
            />
          </Card>
        ) : null}

        {(deliveries.data ?? []).map((order) => {
          const isMine = order.assignedRiderId === user?.sub;
          const canTake = !order.assignedRiderId && order.deliveryWorkflowStatus === 'PENDING_ASSIGNMENT';
          const customerWhatsapp = order.customerPhone ? buildWhatsAppUrl(order.customerPhone) : null;
          const hasCoordinates = order.deliveryLatitude != null && order.deliveryLongitude != null;
          const mapUrl = hasCoordinates
            ? `https://www.google.com/maps/search/?api=1&query=${order.deliveryLatitude},${order.deliveryLongitude}`
            : null;

          return (
            <Card key={order.id} className="overflow-hidden p-0">
              <div className="grid gap-4 border-b border-stone-100 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold text-ink">{order.number}</p>
                    <Badge tone={isMine ? 'success' : order.assignedRiderId ? 'neutral' : 'warning'}>
                      {order.deliveryWorkflowStatus ? workflowLabels[order.deliveryWorkflowStatus] : 'Pendiente'}
                    </Badge>
                    <Badge tone="neutral">{formatCurrency(order.subtotal)}</Badge>
                  </div>
                  <p className="mt-2 text-[13px] leading-6 text-stone-600">
                    {order.customerName || 'Cliente sin nombre'} · {order.customerPhone || 'Sin teléfono'}
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-stone-600">
                    {order.deliveryReference || 'Sin dirección registrada'}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3 py-2 text-right text-[12px] text-stone-500">
                  <p className="font-medium text-ink">
                    Rider: {order.assignedRider?.fullName ? order.assignedRider.fullName : 'Sin asignar'}
                  </p>
                  <p className="mt-1">{order.assignedRiderAt ? `Desde ${formatDateTime(order.assignedRiderAt)}` : 'Disponible para tomar'}</p>
                </div>
              </div>

              <div className="border-b border-stone-100 bg-stone-50/40 px-5 py-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InfoPill icon={<MapPinned className="h-4 w-4" />} label="Zona" value={order.deliveryZoneLabel || 'Zona no disponible'} />
                  <InfoPill
                    icon={<Navigation className="h-4 w-4" />}
                    label="Distancia"
                    value={order.deliveryDistanceKm != null ? `${Number(order.deliveryDistanceKm).toFixed(1)} km` : 'Pendiente'}
                  />
                  <InfoPill icon={<PackageCheck className="h-4 w-4" />} label="Domicilio" value={formatCurrency(order.deliveryFee)} />
                  <InfoPill
                    icon={<Clock3 className="h-4 w-4" />}
                    label="Ubicación"
                    value={order.deliveryLocationReceivedAt ? `Confirmada ${formatDateTime(order.deliveryLocationReceivedAt)}` : 'Pendiente por cliente'}
                  />
                </div>
              </div>

              {order.deliveryIssues[0] ? (
                <div className="border-t border-rose-100 bg-rose-50/70 px-5 py-3 text-[13px] leading-6 text-rose-900">
                  <span className="font-semibold">Novedad activa:</span> {order.deliveryIssues[0].summary}
                </div>
              ) : null}

              {order.notes ? (
                <div className="border-t border-stone-100 px-5 py-3 text-[13px] leading-6 text-stone-600">
                  <span className="font-medium text-ink">Notas:</span> {order.notes}
                </div>
              ) : null}

              <div className="grid gap-2 border-t border-stone-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
                {customerWhatsapp ? (
                  <Button asChild size="sm" variant="secondary" className="min-h-11 w-full justify-center">
                    <a href={customerWhatsapp} target="_blank" rel="noreferrer">
                      <MessageCircle className="mr-2 h-4 w-4" />
                      Contactar cliente
                    </a>
                  </Button>
                ) : null}

                {mapUrl ? (
                  <Button asChild size="sm" variant="secondary" className="min-h-11 w-full justify-center">
                    <a href={mapUrl} target="_blank" rel="noreferrer">
                      <MapPinned className="mr-2 h-4 w-4" />
                      Abrir mapa
                    </a>
                  </Button>
                ) : null}

                {canUpdateDelivery && canTake ? (
                  <Button
                    size="sm"
                    className="min-h-11 w-full justify-center"
                    onClick={() => updateWorkflow.mutate({ orderId: order.id, workflowStatus: 'ASSIGNED' })}
                    disabled={updateWorkflow.isPending}
                  >
                    <Bike className="mr-2 h-4 w-4" />
                    Tomar pedido
                  </Button>
                ) : null}

                {canUpdateDelivery && isMine && order.deliveryWorkflowStatus === 'ASSIGNED' ? (
                  <Button
                    size="sm"
                    className="min-h-11 w-full justify-center"
                    onClick={() => updateWorkflow.mutate({ orderId: order.id, workflowStatus: 'IN_TRANSIT' })}
                    disabled={updateWorkflow.isPending}
                  >
                    <Navigation className="mr-2 h-4 w-4" />
                    Marcar en camino
                  </Button>
                ) : null}

                {canUpdateDelivery && isMine && order.deliveryWorkflowStatus === 'IN_TRANSIT' ? (
                  <>
                    <Button
                      size="sm"
                      className="min-h-11 w-full justify-center"
                      onClick={() => updateWorkflow.mutate({ orderId: order.id, workflowStatus: 'DELIVERED' })}
                      disabled={updateWorkflow.isPending}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Marcar entregado
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-11 w-full justify-center"
                      onClick={() =>
                        updateWorkflow.mutate({
                          orderId: order.id,
                          workflowStatus: 'ISSUE',
                          issueType: 'ROUTE_INCIDENT',
                          notes: 'Novedad registrada desde panel de domiciliario.',
                        })
                      }
                      disabled={updateWorkflow.isPending}
                    >
                      <TriangleAlert className="mr-2 h-4 w-4" />
                      Reportar novedad
                    </Button>
                  </>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function InfoPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.15rem] border border-stone-200 bg-white px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
      <div className="flex items-center gap-2 text-stone-500">
        {icon}
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{label}</p>
      </div>
      <p className="mt-2 text-[14px] font-semibold leading-5 text-ink">{value}</p>
    </div>
  );
}
