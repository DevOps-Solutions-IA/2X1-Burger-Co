'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionTitle } from '@/components/ui/section-title';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, apiFetchBlob, subscribeOperationalStream } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { CacheStorage, TTL } from '@/lib/cache-storage';
import { Bike, CheckCircle2, Clock3, Copy, ExternalLink, Link2, MapPinned, Navigation, TriangleAlert, UserRound } from 'lucide-react';
import { toast } from 'sonner';

type DeliveryWorkflowStatus = 'PENDING_ASSIGNMENT' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'ISSUE';
type DeliveryIssueType =
  | 'CUSTOMER_UNREACHABLE'
  | 'INCOMPLETE_ADDRESS'
  | 'LOCATION_MISMATCH'
  | 'PAYMENT_PENDING'
  | 'DELIVERY_REJECTED'
  | 'ROUTE_INCIDENT'
  | 'OTHER';

type DeliveryReceiptStatus = {
  orderId: string;
  orderNumber: string;
  version: number;
  status: 'ACTIVE';
  total: number;
  deliveryFee: number;
  lastGeneratedAt: string;
  sendStatus: 'NOT_REQUESTED' | 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED_NO_PHONE' | 'SKIPPED_CHANNEL_BLOCKED';
  sentAt: string | null;
};

const receiptSendStatusLabels: Record<DeliveryReceiptStatus['sendStatus'], string> = {
  NOT_REQUESTED: 'Sin solicitar',
  PENDING: 'Pendiente',
  SENT: 'Enviada',
  FAILED: 'Fallida',
  SKIPPED_NO_PHONE: 'Sin teléfono',
  SKIPPED_CHANNEL_BLOCKED: 'Canal no disponible',
};

const receiptSendStatusTone: Record<DeliveryReceiptStatus['sendStatus'], string> = {
  NOT_REQUESTED: 'bg-stone-100 text-stone-600',
  PENDING: 'bg-amber-100 text-amber-700',
  SENT: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  SKIPPED_NO_PHONE: 'bg-amber-100 text-amber-700',
  SKIPPED_CHANNEL_BLOCKED: 'bg-stone-100 text-stone-600',
};

type DeliveryOrder = {
  id: string;
  number: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryReference: string | null;
  deliveryLatitude: number | string | null;
  deliveryLongitude: number | string | null;
  deliveryDistanceKm: number | string | null;
  deliveryZoneLabel: string | null;
  deliveryFee: number | string;
  deliveryLocationReceivedAt: string | null;
  assignedRiderId: string | null;
  assignedRider: { id: string; fullName: string } | null;
  deliveryWorkflowStatus: DeliveryWorkflowStatus | null;
  deliveryIssues: Array<{
    id: string;
    issueType: DeliveryIssueType;
    summary: string;
    details: string | null;
    createdAt: string;
  }>;
  whatsappDeliveryOrder?: {
    id: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string | null;
    publicPaymentTokenExpiresAt: string | null;
    paymentLinkCreatedAt: string | null;
    paymentLinkLastOpenedAt: string | null;
    paymentLinkOpenCount: number;
    paymentMethodSelectedAt: string | null;
    manuallyVerifiedAt: string | null;
    manuallyVerifiedById: string | null;
    orderReference: string | null;
    onlinePaymentProvider: string | null;
    providerPaymentId: string | null;
    providerReference: string | null;
    providerCheckoutUrl: string | null;
    providerStatus: string | null;
    onlinePaymentCreatedAt: string | null;
    onlinePaymentExpiresAt: string | null;
    onlinePaymentPaidAt: string | null;
    webhookLastEventAt: string | null;
    webhookEventCount: number;
    paymentFailureReason: string | null;
    paymentReviewReason: string | null;
    source: string;
    createdByAgentNameSnapshot: string;
    customerNameSnapshot: string | null;
    customerPhoneSnapshot: string | null;
    manuallyVerifiedBy: { id: string; fullName: string; accessName: string | null } | null;
    paymentEvents: Array<{
      id: string;
      eventType: string;
      paymentMethod: string | null;
      previousStatus: string | null;
      newStatus: string;
      message: string | null;
      createdAt: string;
      actor: { id: string; fullName: string; accessName: string | null } | null;
    }>;
  } | null;
  subtotal: number | string;
  updatedAt: string;
};

type DeliveryLocationInboxItem = {
  id: string;
  rawSenderJid: string | null;
  normalizedSenderPhone: string | null;
  matchStatus: 'PENDING' | 'APPLIED' | 'REQUIRES_REVIEW' | 'IGNORED';
  matchedRule: string | null;
  processingNotes: string | null;
  receivedAt: string;
  candidateOrders: Array<{
    id: string;
    number: string;
    customerName: string | null;
    customerPhone: string | null;
    updatedAt: string;
  }>;
};

type OperationalAlert = {
  id: string;
  type: string;
  module: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
};

type User = {
  id: string;
  fullName: string;
  isActive: boolean;
  roles: Array<{ id: string; name: string }>;
};

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
  PENDING_ASSIGNMENT: 'Pendiente',
  ASSIGNED: 'Asignado',
  IN_TRANSIT: 'En camino',
  DELIVERED: 'Entregado',
  ISSUE: 'Novedad',
};

const sofiaPaymentStatusLabels: Record<string, string> = {
  UNSELECTED: 'Pago sin seleccionar',
  CASH_ON_DELIVERY: 'Efectivo contra entrega',
  PENDING_MANUAL_VERIFICATION: 'Nequi por verificar',
  PENDING_ONLINE_PAYMENT: 'Online pendiente',
  PAID: 'Pagado',
  FAILED: 'Pago fallido',
  MANUAL_REVIEW: 'Revisión manual',
  CANCELLED: 'Pago cancelado',
};

function sofiaPaymentSummary(order: DeliveryOrder) {
  const payment = order.whatsappDeliveryOrder;
  if (!payment) return 'Pago sin seleccionar';
  const statusLabel = sofiaPaymentStatusLabels[payment.paymentStatus] ?? payment.paymentStatus;
  const methodLabel =
    payment.paymentMethod === 'CASH'
      ? 'Efectivo'
      : payment.paymentMethod === 'NEQUI_MANUAL'
        ? 'Nequi manual'
        : payment.paymentMethod === 'ONLINE'
          ? 'Online futuro'
          : 'Sin método';
  return `${statusLabel} · ${methodLabel}`;
}

function sofiaPaymentStatusTone(status?: string | null) {
  if (status === 'CASH_ON_DELIVERY') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'PENDING_MANUAL_VERIFICATION') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (status === 'PENDING_ONLINE_PAYMENT') return 'border-indigo-200 bg-indigo-50 text-indigo-800';
  if (status === 'PAID') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'FAILED' || status === 'CANCELLED') return 'border-red-200 bg-red-50 text-red-800';
  if (status === 'MANUAL_REVIEW') return 'border-sofia-200 bg-sofia-50 text-sofia-700';
  return 'border-stone-200 bg-stone-50 text-stone-700';
}

function sofiaPaymentStatusLabel(status?: string | null) {
  return status ? (sofiaPaymentStatusLabels[status] ?? status) : 'Pago sin seleccionar';
}

const DELIVERY_ADMIN_CACHE_KEY = 'inventory_fastfood_delivery_admin_orders';
const DELIVERY_ADMIN_SELECTION_KEY = 'inventory_fastfood_delivery_admin_selection';
const DELIVERY_INBOX_CACHE_KEY = 'inventory_fastfood_delivery_admin_inbox';
const DELIVERY_ALERTS_CACHE_KEY = 'inventory_fastfood_delivery_admin_alerts';
const DELIVERY_INBOX_SELECTION_KEY = 'inventory_fastfood_delivery_admin_inbox_selection';

function isSofiaDeliveryOrder(order: DeliveryOrder) {
  return (
    order.whatsappDeliveryOrder?.source === 'WHATSAPP_SOFIA' ||
    order.whatsappDeliveryOrder?.createdByAgentNameSnapshot === 'Sofía'
  );
}

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
            updatedAt: event.at,
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
            updatedAt: event.at,
          }
        : order,
    );
  }

  if (event.type === 'order.updated') {
    if (event.status === 'PAID' || event.status === 'CANCELLED') {
      return orders.filter((order) => order.id !== event.entityId);
    }

    return orders.map((order) =>
      order.id === event.entityId
        ? {
            ...order,
            updatedAt: event.at,
          }
        : order,
    );
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

export default function DeliveriesPage() {
  const queryClient = useQueryClient();
  const previousOrdersRef = useRef<Map<string, DeliveryOrder>>(new Map());
  const hasSeenLiveDataRef = useRef(false);
  const [riderSelection, setRiderSelection] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') {
      return {};
    }

    try {
      const raw = window.localStorage.getItem(DELIVERY_ADMIN_SELECTION_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [inboxSelection, _setInboxSelection] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') {
      return {};
    }

    try {
      const raw = window.localStorage.getItem(DELIVERY_INBOX_SELECTION_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [queueFilter, setQueueFilter] = useState<DeliveryQueueFilter>('all');
  const [showAlerts, setShowAlerts] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [paymentLinks, setPaymentLinks] = useState<Record<string, string>>({});

  const initialDeliveries = useMemo(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    return CacheStorage.read<DeliveryOrder[]>(DELIVERY_ADMIN_CACHE_KEY) ?? undefined;
  }, []);

  const deliveries = useQuery({
    queryKey: ['delivery-admin-orders'],
    queryFn: () => apiFetch<DeliveryOrder[]>('/orders/delivery-active'),
    initialData: initialDeliveries,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 3_000,
  });
  const initialInbox = useMemo(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    return CacheStorage.read<DeliveryLocationInboxItem[]>(DELIVERY_INBOX_CACHE_KEY) ?? undefined;
  }, []);
  const initialAlerts = useMemo(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    return CacheStorage.read<OperationalAlert[]>(DELIVERY_ALERTS_CACHE_KEY) ?? undefined;
  }, []);
  const deliveryLocationInbox = useQuery({
    queryKey: ['delivery-location-inbox'],
    queryFn: () => apiFetch<DeliveryLocationInboxItem[]>('/orders/delivery-location-inbox?status=REQUIRES_REVIEW'),
    initialData: initialInbox,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 3_000,
  });
  const operationalAlerts = useQuery({
    queryKey: ['operational-alerts', 'deliveries'],
    queryFn: () => apiFetch<OperationalAlert[]>('/orders/operational-alerts?module=deliveries'),
    initialData: initialAlerts,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 3_000,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<User[]>('/users'),
  });

  const riders = useMemo(
    () => (users.data ?? []).filter((user) => user.isActive && user.roles.some((role) => role.name === 'delivery')),
    [users.data],
  );

  const assignRider = useMutation({
    mutationFn: ({ orderId, riderId }: { orderId: string; riderId: string }) =>
      apiFetch(`/orders/${orderId}/assign-rider`, {
        method: 'POST',
        body: JSON.stringify({ riderId }),
      }),
    onSuccess: async () => {
      toast.success('Domiciliario asignado');
      await queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible asignar el domiciliario'),
  });
  const _resolveInbox = useMutation({
    mutationFn: ({ inboxId, orderId, ignore }: { inboxId: string; orderId?: string; ignore?: boolean }) =>
      apiFetch(`/orders/delivery-location-inbox/${inboxId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          ignore,
        }),
      }),
    onSuccess: async () => {
      toast.success('Ubicación pendiente procesada');
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['delivery-location-inbox'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries'], type: 'active' }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible procesar la ubicación pendiente'),
  });
  const updateAlert = useMutation({
    mutationFn: ({ alertId, status }: { alertId: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }) =>
      apiFetch(`/orders/operational-alerts/${alertId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries'], type: 'active' });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar la alerta'),
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
    }) =>
      apiFetch(`/orders/${orderId}/delivery-workflow`, {
        method: 'POST',
        body: JSON.stringify({ workflowStatus, notes, issueType }),
      }),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar el reparto'),
  });

  const generateSofiaPaymentLink = useMutation({
    mutationFn: (orderId: string) =>
      apiFetch<{
        orderReference: string | null;
        publicPaymentUrl: string | null;
        expiresAt: string | null;
        paymentStatus: string;
        paymentMethod: string | null;
      }>(`/orders/${orderId}/sofia-payment-link`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async (link, orderId) => {
      if (link.publicPaymentUrl) {
        setPaymentLinks((current) => ({ ...current, [orderId]: link.publicPaymentUrl! }));
        await navigator.clipboard?.writeText(link.publicPaymentUrl).catch(() => undefined);
      }
      toast.success(link.publicPaymentUrl ? 'Link de pago copiado' : 'Link de pago generado');
      await queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible generar el link de pago'),
  });

  const updateSofiaPaymentStatus = useMutation({
    mutationFn: ({
      orderId,
      status,
      paymentMethod,
      message,
    }: {
      orderId: string;
      status: 'PAID' | 'FAILED' | 'MANUAL_REVIEW';
      paymentMethod?: 'CASH' | 'NEQUI_MANUAL' | 'ONLINE';
      message?: string;
    }) =>
      apiFetch(`/orders/${orderId}/sofia-payment-status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, paymentMethod, message }),
      }),
    onSuccess: async (_, variables) => {
      const labels: Record<string, string> = {
        PAID: 'Pago marcado como pagado',
        FAILED: 'Pago marcado como fallido',
        MANUAL_REVIEW: 'Pago enviado a revisión',
      };
      toast.success(labels[variables.status] ?? 'Pago actualizado');
      await queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar el pago Sofía'),
  });

  const summary = useMemo(() => {
    const rows = deliveries.data ?? [];
    const sofiaRows = rows.filter(isSofiaDeliveryOrder);
    return {
      total: rows.length,
      pending: rows.filter((row) => row.deliveryWorkflowStatus === 'PENDING_ASSIGNMENT').length,
      assigned: rows.filter((row) => row.deliveryWorkflowStatus === 'ASSIGNED').length,
      inTransit: rows.filter((row) => row.deliveryWorkflowStatus === 'IN_TRANSIT').length,
      issue: rows.filter((row) => row.deliveryWorkflowStatus === 'ISSUE').length,
      sofia: sofiaRows.length,
      manual: rows.filter((row) => !isSofiaDeliveryOrder(row)).length,
      unselected: sofiaRows.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'UNSELECTED').length,
      onlinePending: sofiaRows.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'PENDING_ONLINE_PAYMENT').length,
      nequiPending: sofiaRows.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'PENDING_MANUAL_VERIFICATION').length,
      cashOnDelivery: sofiaRows.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'CASH_ON_DELIVERY').length,
      paid: sofiaRows.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'PAID').length,
      manualReview: sofiaRows.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'MANUAL_REVIEW').length,
      failed: sofiaRows.filter((row) => row.whatsappDeliveryOrder?.paymentStatus === 'FAILED').length,
    };
  }, [deliveries.data]);
  const lastSyncLabel = useMemo(
    () => formatSyncLabel(Math.max(deliveries.dataUpdatedAt || 0, deliveryLocationInbox.dataUpdatedAt || 0, operationalAlerts.dataUpdatedAt || 0)),
    [deliveries.dataUpdatedAt, deliveryLocationInbox.dataUpdatedAt, operationalAlerts.dataUpdatedAt],
  );
  const pendingInboxCount = deliveryLocationInbox.data?.length ?? 0;
  const criticalAlertCount = (operationalAlerts.data ?? []).filter((alert) => alert.severity === 'CRITICAL').length;
  const openAlertCount = (operationalAlerts.data ?? []).length;

  const filterOrder = (order: DeliveryOrder) => {
    if (queueFilter === 'all') return true;
    if (queueFilter === 'pending') return !order.deliveryWorkflowStatus || order.deliveryWorkflowStatus === 'PENDING_ASSIGNMENT';
    if (queueFilter === 'assigned') return order.deliveryWorkflowStatus === 'ASSIGNED';
    if (queueFilter === 'intransit') return order.deliveryWorkflowStatus === 'IN_TRANSIT';
    if (queueFilter === 'issue') return order.deliveryWorkflowStatus === 'ISSUE';
    if (queueFilter === 'sofia') return isSofiaDeliveryOrder(order);
    if (queueFilter === 'manual') return !isSofiaDeliveryOrder(order);
    if (queueFilter === 'unselected') return isSofiaDeliveryOrder(order) && order.whatsappDeliveryOrder?.paymentStatus === 'UNSELECTED';
    if (queueFilter === 'online_pending') return isSofiaDeliveryOrder(order) && order.whatsappDeliveryOrder?.paymentStatus === 'PENDING_ONLINE_PAYMENT';
    if (queueFilter === 'nequi_pending') return isSofiaDeliveryOrder(order) && order.whatsappDeliveryOrder?.paymentStatus === 'PENDING_MANUAL_VERIFICATION';
    if (queueFilter === 'cash') return isSofiaDeliveryOrder(order) && order.whatsappDeliveryOrder?.paymentStatus === 'CASH_ON_DELIVERY';
    if (queueFilter === 'paid') return isSofiaDeliveryOrder(order) && order.whatsappDeliveryOrder?.paymentStatus === 'PAID';
    if (queueFilter === 'manual_review') return isSofiaDeliveryOrder(order) && order.whatsappDeliveryOrder?.paymentStatus === 'MANUAL_REVIEW';
    if (queueFilter === 'failed') return isSofiaDeliveryOrder(order) && order.whatsappDeliveryOrder?.paymentStatus === 'FAILED';
    return true;
  };
  const selectedOrder = (deliveries.data ?? []).find((o) => o.id === selectedOrderId) ?? null;

  const receiptStatus = useQuery({
    queryKey: ['delivery-receipt-status', selectedOrder?.id],
    queryFn: () => apiFetch<DeliveryReceiptStatus>(`/orders/${selectedOrder?.id}/delivery-receipt-status`),
    enabled: Boolean(selectedOrder?.id),
    refetchInterval: 30_000,
  });

  const openCurrentReceipt = useMutation({
    mutationFn: async (orderId: string) => {
      const blob = await apiFetchBlob(`/orders/${orderId}/delivery-receipt`);
      return URL.createObjectURL(blob);
    },
    onSuccess: (url) => {
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo abrir la cuenta vigente.'),
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(DELIVERY_ADMIN_SELECTION_KEY, JSON.stringify(riderSelection));
  }, [riderSelection]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(DELIVERY_INBOX_SELECTION_KEY, JSON.stringify(inboxSelection));
  }, [inboxSelection]);

  useEffect(() => {
    if (typeof window === 'undefined' || !deliveries.data) {
      return;
    }

    CacheStorage.write(DELIVERY_ADMIN_CACHE_KEY, deliveries.data, TTL.DELIVERY_DATA);
  }, [deliveries.data]);

  useEffect(() => {
    if (typeof window === 'undefined' || !deliveryLocationInbox.data) {
      return;
    }

    CacheStorage.write(DELIVERY_INBOX_CACHE_KEY, deliveryLocationInbox.data, TTL.DELIVERY_DATA);
  }, [deliveryLocationInbox.data]);

  useEffect(() => {
    if (typeof window === 'undefined' || !operationalAlerts.data) {
      return;
    }

    CacheStorage.write(DELIVERY_ALERTS_CACHE_KEY, operationalAlerts.data, TTL.DELIVERY_DATA);
  }, [operationalAlerts.data]);

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

      if (previous.deliveryWorkflowStatus !== order.deliveryWorkflowStatus && order.deliveryWorkflowStatus) {
        const riderName = order.assignedRider?.fullName ?? 'Sin asignar';
        if (order.deliveryWorkflowStatus === 'ASSIGNED') {
          toast.info(`${order.number} fue asignado a ${riderName}.`);
        } else if (order.deliveryWorkflowStatus === 'IN_TRANSIT') {
          toast.info(`${order.number} salió a entrega con ${riderName}.`);
        } else if (order.deliveryWorkflowStatus === 'DELIVERED') {
          toast.success(`${order.number} fue marcado como entregado.`);
        } else if (order.deliveryWorkflowStatus === 'ISSUE') {
          toast.warning(`${order.number} tiene una novedad registrada.`);
        }
      }

      if (!previous.deliveryLocationReceivedAt && order.deliveryLocationReceivedAt) {
        toast.success(`${order.number} recibió ubicación en vivo.`);
      }
    }

    for (const [orderId, previous] of previousOrdersRef.current.entries()) {
      if (nextMap.has(orderId)) {
        continue;
      }

      toast.success(`${previous.number} salió de la cola activa. Verifica si ya fue entregado o cerrado.`);
    }

    previousOrdersRef.current = nextMap;
  }, [deliveries.data]);

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

          queryClient.setQueryData<DeliveryOrder[] | undefined>(['delivery-admin-orders'], (current) =>
            patchDeliveryOrdersSnapshot(current, event),
          );
          queryClient.setQueryData<OperationalAlert[] | undefined>(['operational-alerts', 'deliveries'], (current) =>
            patchOperationalAlertsSnapshot(current, event),
          );

          void Promise.all([
            queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' }),
            queryClient.refetchQueries({ queryKey: ['delivery-location-inbox'], type: 'active' }),
            queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries'], type: 'active' }),
          ]);
        },
        setStreamStatus,
      ),
    [queryClient],
  );

  useEffect(() => {
    const refetch = async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['delivery-admin-orders'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['delivery-location-inbox'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['operational-alerts', 'deliveries'], type: 'active' }),
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
  }, [queryClient]);

  return (
    <div className="space-y-4 p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionTitle
            eyebrow="Centro operativo"
            title="Domicilios"
            description="Asigna, sigue y resuelve cada entrega sin perder visibilidad."
            status={
              <div className="flex items-center gap-2">
                <Badge tone="info">{summary.total} activos</Badge>
                <span className={`h-2 w-2 rounded-full ${streamStatus === 'open' ? 'bg-emerald-500 animate-pulse' : streamStatus === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <span className="text-[11px] font-medium text-stone-500">{lastSyncLabel}</span>
              </div>
            }
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard compact label="Pendientes" value={String(summary.pending)} hint="Sin rider" icon={<Clock3 className="h-5 w-5" />} accent="warning" />
        <MetricCard compact label="Asignados" value={String(summary.assigned)} hint="Listos" icon={<UserRound className="h-5 w-5" />} />
        <MetricCard compact label="En camino" value={String(summary.inTransit)} hint="Activos" icon={<Navigation className="h-5 w-5" />} accent="success" />
        <MetricCard compact label="Sofía" value={String(summary.sofia)} hint={`${summary.onlinePending} online · ${summary.nequiPending} Nequi · ${summary.cashOnDelivery} efectivo`} icon={<Link2 className="h-5 w-5" />} accent="ink" />
        <MetricCard compact label="Revisar" value={String(pendingInboxCount + openAlertCount)} hint={`${pendingInboxCount} ubicaciones · ${openAlertCount} alertas`} icon={<TriangleAlert className="h-5 w-5" />} accent={criticalAlertCount > 0 ? 'danger' : pendingInboxCount + openAlertCount > 0 ? 'warning' : 'ink'} />
      </div>

      <div
        className="flex flex-wrap gap-2 rounded-2xl border border-violet-100 bg-violet-50/70 p-3"
        data-testid="deliveries-sofia-ops-summary"
      >
        <Badge tone="info">Sofía: {summary.sofia}</Badge>
        <Badge tone={summary.nequiPending ? 'warning' : 'neutral'}>Nequi por verificar: {summary.nequiPending}</Badge>
        <Badge tone={summary.cashOnDelivery ? 'warning' : 'neutral'}>Efectivo contra entrega: {summary.cashOnDelivery}</Badge>
        <Badge tone={summary.paid ? 'success' : 'neutral'}>Pagados: {summary.paid}</Badge>
        <Badge tone={summary.manualReview ? 'warning' : 'neutral'}>Revisión manual: {summary.manualReview}</Badge>
      </div>


      {/* Master-Detail Layout */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:h-[calc(100vh-13rem)]">
        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-3 overflow-hidden">

          {/* 1. REVIEW MODULE — separated card, outside queue */}
          {(pendingInboxCount + openAlertCount) > 0 ? (
            <div className="shrink-0 rounded-[1.25rem] border border-stone-200 bg-white p-3.5" data-testid="deliveries-alerts-panel">
              <button
                type="button"
                onClick={() => setShowAlerts(!showAlerts)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${criticalAlertCount > 0 ? 'bg-red-500' : 'bg-amber-400'}`} />
                  <div>
                    <p className="text-[12px] font-extrabold text-ink">Revision operativa</p>
                    <p className="text-[11px] text-stone-500">{pendingInboxCount + openAlertCount} pendientes &middot; {openAlertCount} alertas &middot; {pendingInboxCount} ubicaciones</p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-stone-500 shrink-0">{showAlerts ? 'Ocultar' : 'Ver pendientes'}</span>
              </button>
              {showAlerts ? (
                <div className="mt-3 border-t border-stone-100 pt-3 space-y-2 max-h-40 overflow-y-auto">
                  {(operationalAlerts.data ?? []).slice(0, 4).map((alert) => (
                    <div key={alert.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-stone-700 truncate">{alert.title}</p>
                        {alert.message ? <p className="text-[10px] text-stone-500 truncate">{alert.message}</p> : null}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {alert.status === 'OPEN' ? (
                          <button type="button" className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-600 hover:border-stone-400 hover:text-ink" onClick={() => updateAlert.mutate({ alertId: alert.id, status: 'ACKNOWLEDGED' })}>Revisado</button>
                        ) : null}
                        <button type="button" className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-400 hover:border-stone-300 hover:text-stone-700" onClick={() => updateAlert.mutate({ alertId: alert.id, status: 'RESOLVED' })}>Descartar</button>
                      </div>
                    </div>
                  ))}
                  {(operationalAlerts.data ?? []).length > 4 ? (
                    <p className="text-[10px] font-semibold text-stone-400">+{(operationalAlerts.data ?? []).length - 4} mas</p>
                  ) : null}
                  {(deliveryLocationInbox.data ?? []).length > 0 ? (
                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                      <p className="text-[11px] font-bold text-stone-600">{deliveryLocationInbox.data!.length} ubicaciones por confirmar</p>
                      <p className="text-[10px] text-stone-400">Asocialas a un pedido desde la cola</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 2. QUEUE — separated card */}
          <div className="flex flex-col flex-1 overflow-hidden rounded-[1.25rem] border border-stone-200 bg-white">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 shrink-0">
              <div>
                <h2 className="text-[13px] font-extrabold uppercase tracking-[0.1em] text-stone-500">Cola operativa</h2>
                <p className="mt-0.5 text-[10px] font-medium text-stone-400">{deliveries.data?.length ?? 0} domicilios activos</p>
              </div>
            </div>

            {/* Segmented control */}
            <div className="mx-4 space-y-2 shrink-0" data-testid="deliveries-status-filter">
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-stone-100/80 p-0.5">
                {([
                  ['all', 'Todos', summary.total],
                  ['pending', 'Pendientes', summary.pending],
                  ['assigned', 'Asignados', summary.assigned],
                  ['intransit', 'En camino', summary.inTransit],
                  ['issue', 'Revision', summary.issue],
                ] as const).map(([tab, label, count]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setQueueFilter(tab)}
                    className={`min-w-[5.1rem] rounded-md py-2 text-[10px] font-bold uppercase tracking-[0.05em] transition ${
                      queueFilter === tab
                        ? 'bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                        : 'text-stone-500 hover:text-stone-700'
                    }`}
                    data-testid={`deliveries-filter-${tab}`}
                  >
                    <span className="block">{label}</span>
                    {count > 0 ? <span className="block text-[9px] opacity-40">{count}</span> : null}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 overflow-x-auto rounded-lg border border-violet-100 bg-violet-50/60 p-1" data-testid="deliveries-sofia-ops-filters">
                {([
                  ['sofia', 'Sofía', summary.sofia],
                  ['manual', 'Manual', summary.manual],
                  ['unselected', 'Sin pago', summary.unselected],
                  ['online_pending', 'Online', summary.onlinePending],
                  ['nequi_pending', 'Nequi', summary.nequiPending],
                  ['cash', 'Efectivo', summary.cashOnDelivery],
                  ['paid', 'Pagados', summary.paid],
                  ['manual_review', 'Revisión', summary.manualReview],
                  ['failed', 'Fallidos', summary.failed],
                ] as const).map(([tab, label, count]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setQueueFilter(tab)}
                    className={`min-w-[5.2rem] rounded-full border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.08em] transition ${
                      queueFilter === tab
                        ? 'border-violet-300 bg-white text-violet-900 shadow-sm'
                        : 'border-transparent text-violet-700 hover:border-violet-200 hover:bg-white/70'
                    }`}
                    data-testid={`deliveries-filter-${tab.replace('_', '-')}`}
                  >
                    <span>{label}</span>
                    <span className="ml-1 opacity-55">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 pt-3" data-testid="deliveries-queue-list">
              {deliveries.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-24 rounded-2xl" />
                  <Skeleton className="h-24 rounded-2xl" />
                  <Skeleton className="h-24 rounded-2xl" />
                </div>
              ) : null}
              {!deliveries.isLoading && (deliveries.data ?? []).filter(filterOrder).length === 0 ? (
                <EmptyState title="Sin domicilios en este filtro" description="Cambia de filtro o espera nuevos pedidos." icon={<Bike className="h-8 w-8" />} />
              ) : null}
              {(deliveries.data ?? []).filter(filterOrder).map((order) => {
                const isSelected = selectedOrderId === order.id;
                const isSofia = isSofiaDeliveryOrder(order);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedOrderId(order.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      isSelected
                        ? 'border-ink bg-stone-950 text-white shadow-soft'
                        : isSofia
                          ? 'border-violet-200 bg-violet-50/70 hover:border-violet-300'
                          : 'border-stone-200 bg-white hover:border-stone-300'
                    }`}
                    data-testid={isSofia ? 'deliveries-sofia-queue-item' : 'deliveries-queue-item'}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className={`truncate text-[13px] font-black ${isSelected ? 'text-white' : 'text-ink'}`}>{order.number}</p>
                          {isSofia ? (
                            <span className="rounded-full border border-sofia-200 bg-sofia-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-sofia-700" data-testid="deliveries-sofia-order-chip">
                              Sofía / WhatsApp
                            </span>
                          ) : null}
                        </div>
                        <p className={`mt-1 truncate text-[12px] font-semibold ${isSelected ? 'text-stone-200' : 'text-stone-600'}`}>
                          {order.customerName || 'Sin cliente'} · {order.customerPhone || 'Sin teléfono'}
                        </p>
                      </div>
                      <p className={`shrink-0 text-[12px] font-black tabular-nums ${isSelected ? 'text-white' : 'text-ink'}`}>
                        {formatCurrency(Number(order.subtotal))}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${
                        order.deliveryWorkflowStatus === 'ISSUE'
                          ? 'bg-red-100 text-red-700'
                          : order.deliveryWorkflowStatus === 'IN_TRANSIT'
                            ? 'bg-emerald-100 text-emerald-700'
                            : order.assignedRiderId
                              ? 'bg-sky-100 text-sky-700'
                              : 'bg-amber-100 text-amber-700'
                      }`}>
                        {order.deliveryWorkflowStatus ? workflowLabels[order.deliveryWorkflowStatus] : 'Pendiente'}
                      </span>
                      {isSofia ? (
                        <span
                          className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.06em] ${sofiaPaymentStatusTone(order.whatsappDeliveryOrder?.paymentStatus)}`}
                          data-testid="deliveries-sofia-payment-status"
                        >
                          {sofiaPaymentStatusLabel(order.whatsappDeliveryOrder?.paymentStatus)}
                        </span>
                      ) : null}
                    </div>
                    <p className={`mt-2 line-clamp-1 text-[11px] font-semibold ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
                      {order.deliveryReference || 'Sin dirección registrada'}
                    </p>
                    {isSofia && order.whatsappDeliveryOrder?.orderReference ? (
                      <p className={`mt-1 text-[10px] font-black uppercase tracking-[0.08em] ${isSelected ? 'text-violet-100' : 'text-violet-700'}`}>
                        {order.whatsappDeliveryOrder.orderReference}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Detail */}
        <div className="overflow-y-auto rounded-[1.5rem] border border-stone-200 bg-white" data-testid="deliveries-detail">
          {!selectedOrder ? (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState title="Selecciona un domicilio" description="Elige un pedido de la cola para gestionarlo." icon={<MapPinned className="h-10 w-10" />} />
            </div>
          ) : null}

          {selectedOrder ? (
            <div className="divide-y divide-stone-100">
              {/* 1. Header */}
              <div className={`flex items-start justify-between gap-4 px-5 py-4 ${
                isSofiaDeliveryOrder(selectedOrder) ? 'bg-violet-50/70' : ''
              }`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-extrabold text-ink tracking-tight">{selectedOrder.number}</p>
                    {isSofiaDeliveryOrder(selectedOrder) ? (
                      <span
                        className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-violet-800"
                        data-testid="deliveries-detail-sofia-chip"
                      >
                        Sofía
                      </span>
                    ) : null}
                    {isSofiaDeliveryOrder(selectedOrder) ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.06em] ${sofiaPaymentStatusTone(selectedOrder.whatsappDeliveryOrder?.paymentStatus)}`}
                        data-testid="deliveries-detail-sofia-payment-badge"
                      >
                        {sofiaPaymentStatusLabel(selectedOrder.whatsappDeliveryOrder?.paymentStatus)}
                      </span>
                    ) : null}
                    <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${
                      selectedOrder.deliveryWorkflowStatus === 'ISSUE' ? 'text-red-600' :
                      selectedOrder.deliveryWorkflowStatus === 'IN_TRANSIT' ? 'text-emerald-600' :
                      selectedOrder.assignedRiderId ? 'text-sky-600' : 'text-amber-600'
                    }`}>
                      {selectedOrder.deliveryWorkflowStatus ? workflowLabels[selectedOrder.deliveryWorkflowStatus] : 'Pendiente'}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-stone-600 truncate">
                    {selectedOrder.customerName || 'Sin nombre'} &middot; {selectedOrder.customerPhone || 'Sin telefono'}
                  </p>
	                  {isSofiaDeliveryOrder(selectedOrder) ? (
	                    <p className="mt-1 text-[11px] font-bold text-violet-700" data-testid="deliveries-detail-sofia-payment">
	                      Origen: Sofía · WhatsApp · {sofiaPaymentSummary(selectedOrder)}
	                      {selectedOrder.whatsappDeliveryOrder?.orderReference ? ` · ${selectedOrder.whatsappDeliveryOrder.orderReference}` : ''}
	                    </p>
	                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-stone-400">Tarifa</p>
                  <p className="text-[18px] font-black text-ink tabular-nums leading-none">{formatCurrency(selectedOrder.deliveryFee)}</p>
                </div>
              </div>

              <div className="border-y border-stone-100 bg-stone-50/70 px-5 py-3" data-testid="deliveries-receipt-panel">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-400">Cuenta de domicilio</p>
                    {receiptStatus.data ? (
                      <>
                        <p className="mt-1 text-[12px] font-black text-ink" data-testid="deliveries-receipt-version">
                          Cuenta vigente: versión {receiptStatus.data.version}
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-emerald-700">
                            Vigente
                          </span>
                          <span
                            className={`ml-1.5 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${receiptSendStatusTone[receiptStatus.data.sendStatus]}`}
                            data-testid="deliveries-receipt-send-status"
                          >
                            {receiptSendStatusLabels[receiptStatus.data.sendStatus]}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] font-semibold text-stone-500">
                          Total vigente {formatCurrency(receiptStatus.data.total)} · Última actualización{' '}
                          {formatDateTime(receiptStatus.data.lastGeneratedAt)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-[11px] font-semibold text-stone-400">
                        {receiptStatus.isLoading ? 'Cargando estado de la cuenta…' : 'Estado de cuenta no disponible.'}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0 justify-center text-[11px]"
                    onClick={() => openCurrentReceipt.mutate(selectedOrder.id)}
                    disabled={openCurrentReceipt.isPending}
                    data-testid="deliveries-receipt-view"
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Ver cuenta vigente
                  </Button>
                </div>
              </div>

              {isSofiaDeliveryOrder(selectedOrder) ? (
                <div className="border-y border-violet-100 bg-violet-50/60 px-5 py-3" data-testid="deliveries-sofia-payment-link-panel">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-500">Origen Sofía</p>
                      <p className="mt-1 truncate text-[12px] font-bold text-violet-900" data-testid="deliveries-sofia-payment-link-status">
                        {selectedOrder.whatsappDeliveryOrder?.orderReference
                          ? `${selectedOrder.whatsappDeliveryOrder.orderReference} · ${sofiaPaymentSummary(selectedOrder)}`
                          : 'Sin link generado'}
                      </p>
                      <div className="mt-2 grid gap-1.5 text-[11px] font-semibold text-violet-800 sm:grid-cols-2" data-testid="deliveries-sofia-origin-detail">
                        <span>Fuente: Sofía / WhatsApp</span>
                        <span>Total: {formatCurrency(Number(selectedOrder.subtotal))}</span>
                        <span>Provider: {selectedOrder.whatsappDeliveryOrder?.onlinePaymentProvider ?? 'Sin provider'}</span>
                        <span>Webhook: {selectedOrder.whatsappDeliveryOrder?.webhookEventCount ?? 0} evento(s)</span>
                        <span>Cliente: {selectedOrder.customerName || selectedOrder.whatsappDeliveryOrder?.customerNameSnapshot || 'Sin nombre'}</span>
                        <span>Teléfono: {selectedOrder.customerPhone || selectedOrder.whatsappDeliveryOrder?.customerPhoneSnapshot || 'Sin teléfono'}</span>
                      </div>
                      {selectedOrder.whatsappDeliveryOrder?.publicPaymentTokenExpiresAt ? (
                        <p className="mt-0.5 text-[11px] font-semibold text-violet-700">
                          Vence: {formatDateTime(selectedOrder.whatsappDeliveryOrder.publicPaymentTokenExpiresAt)}
                          {selectedOrder.whatsappDeliveryOrder.paymentLinkOpenCount
                            ? ` · ${selectedOrder.whatsappDeliveryOrder.paymentLinkOpenCount} apertura(s)`
                            : ''}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="justify-center text-[11px]"
                        onClick={() => generateSofiaPaymentLink.mutate(selectedOrder.id)}
                        disabled={generateSofiaPaymentLink.isPending}
                        data-testid="deliveries-generate-sofia-payment-link"
                      >
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        {selectedOrder.whatsappDeliveryOrder?.orderReference ? 'Regenerar link' : 'Generar link de pago'}
                      </Button>
                      {paymentLinks[selectedOrder.id] ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="justify-center text-[11px]"
                            onClick={() => {
                              const paymentLink = paymentLinks[selectedOrder.id];
                              if (!paymentLink) return;
                              void navigator.clipboard?.writeText(paymentLink);
                              toast.success('Link copiado');
                            }}
                            data-testid="deliveries-copy-sofia-payment-link"
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            Copiar link
                          </Button>
                          <Button asChild size="sm" variant="secondary" className="justify-center text-[11px]" data-testid="deliveries-open-sofia-payment-link">
                            <a href={paymentLinks[selectedOrder.id] ?? '#'} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Ver link
                            </a>
                          </Button>
                        </>
                      ) : null}
                      {selectedOrder.whatsappDeliveryOrder?.orderReference ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="justify-center text-[11px]"
                          onClick={() => {
                            const reference = selectedOrder.whatsappDeliveryOrder?.orderReference;
                            if (!reference) return;
                            void navigator.clipboard?.writeText(reference);
                            toast.success('Referencia copiada');
                          }}
                          data-testid="deliveries-sofia-copy-reference"
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          Copiar referencia
                        </Button>
                      ) : null}
                    </div>
                  </div>
	                  {paymentLinks[selectedOrder.id] ? (
	                    <p className="mt-3 break-all rounded-xl border border-violet-100 bg-white px-3 py-2 text-[11px] font-bold text-violet-900" data-testid="deliveries-sofia-payment-url">
	                      {paymentLinks[selectedOrder.id]}
	                    </p>
	                  ) : null}
                    <div className="mt-3 grid gap-2 rounded-xl border border-violet-100 bg-white p-3" data-testid="deliveries-sofia-manual-payment-actions">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-500">Validación manual operador</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedOrder.whatsappDeliveryOrder?.paymentStatus !== 'PAID' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="justify-center text-[11px]"
                            onClick={() => {
                              if (!window.confirm('Confirmar que el pago Sofía fue verificado por operador.')) return;
                              updateSofiaPaymentStatus.mutate({
                                orderId: selectedOrder.id,
                                status: 'PAID',
                                paymentMethod:
                                  selectedOrder.whatsappDeliveryOrder?.paymentMethod === 'NEQUI_MANUAL'
                                    ? 'NEQUI_MANUAL'
                                    : selectedOrder.whatsappDeliveryOrder?.paymentMethod === 'CASH'
                                      ? 'CASH'
                                      : undefined,
                                message: 'Operador validó manualmente el pago.',
                              });
                            }}
                            disabled={updateSofiaPaymentStatus.isPending}
                            data-testid="deliveries-sofia-mark-paid"
                          >
                            Marcar pagado
                          </Button>
                        ) : null}
                        {selectedOrder.whatsappDeliveryOrder?.paymentStatus !== 'PAID' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="justify-center text-[11px]"
                            onClick={() => {
                              if (!window.confirm('Confirmar pago Sofía como fallido.')) return;
                              updateSofiaPaymentStatus.mutate({
                                orderId: selectedOrder.id,
                                status: 'FAILED',
                                message: 'Operador marcó el pago como fallido.',
                              });
                            }}
                            disabled={updateSofiaPaymentStatus.isPending}
                            data-testid="deliveries-sofia-mark-failed"
                          >
                            Marcar fallido
                          </Button>
                        ) : null}
                        {selectedOrder.whatsappDeliveryOrder?.paymentStatus !== 'PAID' && selectedOrder.whatsappDeliveryOrder?.paymentStatus !== 'MANUAL_REVIEW' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="justify-center text-[11px]"
                            onClick={() =>
                              updateSofiaPaymentStatus.mutate({
                                orderId: selectedOrder.id,
                                status: 'MANUAL_REVIEW',
                                message: 'Operador envió el pago a revisión manual.',
                              })
                            }
                            disabled={updateSofiaPaymentStatus.isPending}
                            data-testid="deliveries-sofia-manual-review"
                          >
                            Enviar a revisión
                          </Button>
                        ) : null}
                        {selectedOrder.whatsappDeliveryOrder?.paymentStatus === 'PAID' ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-black text-emerald-700" data-testid="deliveries-sofia-payment-already-paid">
                            Pago validado. Continuar flujo de domicilio.
                          </span>
                        ) : null}
                      </div>
                      {selectedOrder.whatsappDeliveryOrder?.manuallyVerifiedAt ? (
                        <p className="text-[11px] font-bold text-emerald-700">
                          Verificado por {selectedOrder.whatsappDeliveryOrder.manuallyVerifiedBy?.fullName ?? 'operador'} · {formatDateTime(selectedOrder.whatsappDeliveryOrder.manuallyVerifiedAt)}
                        </p>
                      ) : null}
                    </div>
                    {selectedOrder.whatsappDeliveryOrder?.paymentEvents?.length ? (
                      <div className="mt-3 rounded-xl border border-violet-100 bg-white p-3" data-testid="deliveries-sofia-payment-events">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-500">Historial de pagos</p>
                        <div className="mt-2 space-y-2">
                          {selectedOrder.whatsappDeliveryOrder.paymentEvents.slice(0, 5).map((event) => (
                            <div key={event.id} className="rounded-lg bg-violet-50 px-3 py-2">
                              <p className="text-[11px] font-black text-violet-950">
                                {event.previousStatus ? `${sofiaPaymentStatusLabel(event.previousStatus)} → ` : ''}{sofiaPaymentStatusLabel(event.newStatus)}
                                {event.paymentMethod ? ` · ${event.paymentMethod}` : ''}
                              </p>
                              <p className="mt-0.5 text-[10px] font-semibold text-violet-700">
                                {event.message ?? event.eventType} · {formatDateTime(event.createdAt)}
                                {event.actor?.fullName ? ` · ${event.actor.fullName}` : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
	                </div>
	              ) : null}

              {/* 2. Direccion */}
              <div className="px-5 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 mb-1">Direccion</p>
                <p className="text-[13px] font-semibold text-ink">{selectedOrder.deliveryReference || 'Sin direccion registrada'}</p>
              </div>

              {/* 3. Logistica */}
              <div className="px-5 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 mb-2">Logistica</p>
                <div className="grid grid-cols-2 gap-2">
                  <InfoPill icon={<MapPinned className="h-3.5 w-3.5" />} label="Zona" value={selectedOrder.deliveryZoneLabel || '—'} />
                  <InfoPill icon={<Bike className="h-3.5 w-3.5" />} label="Distancia" value={selectedOrder.deliveryDistanceKm != null ? `${Number(selectedOrder.deliveryDistanceKm).toFixed(1)} km` : '—'} />
                  <InfoPill icon={<Clock3 className="h-3.5 w-3.5" />} label="Ubicacion" value={selectedOrder.deliveryLocationReceivedAt ? 'Confirmada' : 'Pendiente'} />
                  <InfoPill icon={<Clock3 className="h-3.5 w-3.5" />} label="Actualizado" value={formatDateTime(selectedOrder.updatedAt)} />
                </div>
              </div>

              {/* 4. Novedad */}
              {selectedOrder.deliveryIssues[0] ? (
                <div className="px-5 py-3 bg-red-50/50">
                  <div className="flex items-center gap-2 text-[12px] font-bold text-red-800">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                    {selectedOrder.deliveryIssues[0].summary}
                  </div>
                </div>
              ) : null}

              {/* 5. Repartidor */}
              <div className="px-5 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 mb-2">Repartidor</p>
                <div className="flex items-end gap-2" data-testid="deliveries-rider-select">
                  <Select
                    className="flex-1"
                    value={riderSelection[selectedOrder.id] ?? selectedOrder.assignedRiderId ?? ''}
                    onChange={(event) => setRiderSelection((c) => ({ ...c, [selectedOrder.id]: event.target.value }))}
                  >
                    <option value="">Sin asignar</option>
                    {riders.map((rider) => (
                      <option key={rider.id} value={rider.id}>{rider.fullName}</option>
                    ))}
                  </Select>
                  <Button size="sm" data-testid="deliveries-assign-button"
                    onClick={() => assignRider.mutate({ orderId: selectedOrder.id, riderId: riderSelection[selectedOrder.id] ?? selectedOrder.assignedRiderId ?? '' })}
                    disabled={assignRider.isPending || !(riderSelection[selectedOrder.id] ?? selectedOrder.assignedRiderId)}>
                    Asignar
                  </Button>
                </div>
              </div>

              {/* 6. Flujo operativo */}
              <div className="px-5 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 mb-2">Flujo</p>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                  {selectedOrder.deliveryLatitude && selectedOrder.deliveryLongitude ? (
                    <Button asChild size="sm" variant="secondary" className="w-full justify-center text-[11px]">
                      <a href={`https://www.google.com/maps/search/?api=1&query=${selectedOrder.deliveryLatitude},${selectedOrder.deliveryLongitude}`} target="_blank" rel="noreferrer">
                        <MapPinned className="mr-1.5 h-3.5 w-3.5" />Mapa
                      </a>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" className="w-full justify-center text-[11px]"
                    onClick={() => updateWorkflow.mutate({ orderId: selectedOrder.id, workflowStatus: 'ASSIGNED' })}
                    disabled={updateWorkflow.isPending}>
                    <UserRound className="mr-1.5 h-3.5 w-3.5" />Confirmar
                  </Button>
                  <Button size="sm" variant="secondary" className="w-full justify-center text-[11px]"
                    onClick={() => updateWorkflow.mutate({ orderId: selectedOrder.id, workflowStatus: 'IN_TRANSIT' })}
                    disabled={updateWorkflow.isPending || !selectedOrder.assignedRiderId}>
                    <Navigation className="mr-1.5 h-3.5 w-3.5" />En camino
                  </Button>
                  <Button size="sm" variant="secondary" className="w-full justify-center text-[11px]" data-testid="deliveries-delivered-button"
                    onClick={() => updateWorkflow.mutate({ orderId: selectedOrder.id, workflowStatus: 'DELIVERED' })}
                    disabled={updateWorkflow.isPending || !selectedOrder.assignedRiderId}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Entregado
                  </Button>
                  <Button size="sm" variant="secondary" className="w-full justify-center text-[11px] text-red-600" data-testid="deliveries-incident-button"
                    onClick={() => updateWorkflow.mutate({ orderId: selectedOrder.id, workflowStatus: 'ISSUE', issueType: 'ROUTE_INCIDENT', notes: 'Novedad desde panel.' })}
                    disabled={updateWorkflow.isPending}>
                    <TriangleAlert className="mr-1.5 h-3.5 w-3.5" />Novedad
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
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
