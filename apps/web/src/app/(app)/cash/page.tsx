'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  CircleDollarSign,
  Eye,
  FileDown,
  History,
  ScrollText,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { DetailDialog, MetricSurface, PageHeader, QueryState } from '@/components/product';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, apiFetchBlob } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { formatReceiptNumber } from '@/lib/receipt-number';
import { useAuth } from '@/features/auth/auth-provider';
import { canPerformAction } from '@/features/auth/access-control';

const denominations = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];
const manualMovementOptions = [
  { value: 'OTHER_INCOME', label: 'Ingreso manual' },
  { value: 'OTHER_EXPENSE', label: 'Egreso manual' },
];
const manualMovementClasses = [
  'Cambio inicial',
  'Retiro de caja',
  'Pago menor',
  'Ingreso extraordinario',
  'Corrección administrativa',
];

function createBreakdownState() {
  return Object.fromEntries(denominations.map((value) => [String(value), '0'])) as Record<string, string>;
}

function createBreakdownStateFromAmount(amount: number) {
  let remainder = Math.max(0, Math.round(amount));
  const next = createBreakdownState();

  for (const denomination of denominations) {
    const count = Math.floor(remainder / denomination);
    next[String(denomination)] = String(count);
    remainder -= count * denomination;
  }

  return next;
}

function sumBreakdown(breakdown: Record<string, string>) {
  return Object.entries(breakdown).reduce((sum, [denomination, count]) => {
    return sum + Number(denomination) * Number(count || 0);
  }, 0);
}

function serializeBreakdown(breakdown: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(breakdown)
      .filter(([, count]) => Number(count) > 0)
      .map(([denomination, count]) => [denomination, Number(count)]),
  );
}

type SaleListItem = {
  id: string;
  number: string;
  status?: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  soldAt: string;
  channel: 'MOSTRADOR' | 'PARA_LLEVAR' | 'MESA' | 'DOMICILIO';
  tableLabel: string | null;
  deliveryReference: string | null;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  total: number | string;
  subtotal: number | string;
  deliveryFee?: number | string | null;
  items: Array<{
    quantity: number | string;
    unitPrice: number | string;
    totalPrice: number | string;
    product: {
      name: string;
    };
  }>;
  conversion?: {
    orderTicket: {
      id: string;
      number: string;
      status: 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
    };
  } | null;
};

type DiningTable = {
  id: string;
  label: string;
  area: string | null;
  status: 'FREE' | 'OCCUPIED' | 'RESERVED' | 'PAYMENT_PENDING' | 'OUT_OF_SERVICE';
  isActive: boolean;
};

type CloseChecklist = {
  hasSession: boolean;
  canClose: boolean;
  blockers: string[];
  warnings?: string[];
  session: {
    id: string;
    openedAt: string;
    openedBy: {
      fullName: string;
      email: string;
    } | null;
    openingAmount: number;
    expectedAmount: number;
  } | null;
  actualAmount: number | null;
  expectedAmount: number;
  difference: number | null;
  summary?: {
    salesTotal: number;
    purchasesTotal: number;
    expensesTotal: number;
    adjustedSalesCount: number;
    manualMovementsCount: number;
  };
  activeOrdersCount: number;
  paymentMismatchCount: number;
  uncategorizedExpensesCount: number;
  paymentMismatches: Array<{
    id: string;
    number: string;
    total: number;
    paymentTotal: number;
    difference: number;
  }>;
  uncategorizedExpenses: Array<{
    id: string;
    concept: string;
    classification: string | null;
    amount: number;
    spentAt: string;
    paymentMethod: string | null;
    createdBy: string | null;
  }>;
};

type CashSession = {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  updatedAt: string;
  openingAmount: number | string;
  closingAmount: number | string | null;
  difference: number | string | null;
  reopenedFromSessionId: string | null;
  openedBy: {
    fullName: string;
  } | null;
};

type OperationalReport = {
  cash?: {
    expectedAmount?: number | string;
  };
  sales?: {
    total?: number | string;
  };
  metrics?: {
    netProfit?: number | string;
  };
  operations?: {
    activeOrdersCount?: number;
  };
};

type CashDailySummary = {
  expectedPhysicalCash?: number | string;
  methodLabels?: Record<string, string>;
  salesByMethod?: Record<string, number>;
  expensesByMethod?: Record<string, number>;
  purchasesByMethod?: Record<string, number>;
  cashRevenue?: number | string;
  digitalRevenue?: number | string;
  totalRevenue?: number | string;
  totalExpenses?: number | string;
  operationalResult?: number | string;
};

type CashOperationalLog = {
  items: Array<{
    id: string;
    title: string;
    detail: string;
    type: string;
    amount: number | string;
    at: string;
  }>;
};

type CloseCashResponse = {
  notifications?: {
    whatsapp?: {
      success: boolean;
      skipped?: boolean;
      reason?: string;
    } | null;
  };
};

export default function CashPage() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openingAmount, setOpeningAmount] = useState('50000');
  const [openingNotes, setOpeningNotes] = useState('');
  const [openingBreakdown, setOpeningBreakdown] = useState<Record<string, string>>(createBreakdownState());
  const [closingBreakdown, setClosingBreakdown] = useState<Record<string, string>>(createBreakdownState());
  const [closingNotes, setClosingNotes] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [manualType, setManualType] = useState<'OTHER_INCOME' | 'OTHER_EXPENSE'>('OTHER_EXPENSE');
  const [manualAmount, setManualAmount] = useState('');
  const [manualClassification, setManualClassification] = useState(manualMovementClasses[0] ?? 'Retiro de caja');
  const [manualDescription, setManualDescription] = useState('');
  const [confirmedClosingAmount, setConfirmedClosingAmount] = useState<number | null>(null);
  const [confirmedCriticalReview, setConfirmedCriticalReview] = useState(false);
  const [closingConfirmationText, setClosingConfirmationText] = useState('');
  const [selectedSale, setSelectedSale] = useState<SaleListItem | null>(null);
  const [convertOrderType, setConvertOrderType] = useState<'COUNTER' | 'DINE_IN' | 'DELIVERY'>('DINE_IN');
  const [convertTableId, setConvertTableId] = useState('');
  const [convertReason, setConvertReason] = useState('');
  const canOpenCash = canPerformAction(user?.permissions, 'cash.open', user?.roles, ['admin', 'cashier', 'supervisor']);
  const canCloseCash = canPerformAction(user?.permissions, 'cash.close', user?.roles, ['admin', 'cashier', 'supervisor']);
  const canReopenCash = canPerformAction(user?.permissions, 'cash.close', user?.roles, ['admin', 'supervisor']);
  const canRecordManualCash = canPerformAction(user?.permissions, 'cash.close', user?.roles, ['admin', 'cashier', 'supervisor']);
  const canRecoverSale = canPerformAction(user?.permissions, 'sales.create', user?.roles, ['admin', 'cashier', 'supervisor']);

  const currentCash = useQuery({
    queryKey: ['cash-current'],
    queryFn: () => apiFetch<CashSession | null>('/cash-register/current'),
  });
  const history = useQuery({
    queryKey: ['cash-history'],
    queryFn: () => apiFetch<CashSession[]>('/cash-register/history'),
  });
  const dailySummary = useQuery({
    queryKey: ['reports-operational'],
    queryFn: () => apiFetch<OperationalReport>('/reports/operational'),
  });
  const closingAmount = sumBreakdown(closingBreakdown);
  const cashDailySummary = useQuery({
    queryKey: ['cash-daily-summary', currentCash.data?.id ?? 'no-session', closingAmount],
    queryFn: () => apiFetch<CashDailySummary>(`/cash-register/daily-summary?actualAmount=${encodeURIComponent(String(closingAmount))}`),
    enabled: Boolean(currentCash.data),
  });
  const operationalLog = useQuery({
    queryKey: ['cash-operational-log'],
    queryFn: () => apiFetch<CashOperationalLog>('/cash-register/operational-log'),
  });
  const sales = useQuery({
    queryKey: ['sales'],
    queryFn: () => apiFetch<SaleListItem[]>('/sales'),
  });
  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: () => apiFetch<DiningTable[]>('/tables'),
  });
  const expectedAmount = Number(cashDailySummary.data?.expectedPhysicalCash ?? dailySummary.data?.cash?.expectedAmount ?? 0);
  const closeChecklist = useQuery({
    queryKey: [
      'cash-close-checklist',
      currentCash.data?.id ?? 'no-session',
      currentCash.data?.updatedAt ?? 'no-update',
      dailySummary.data?.cash?.expectedAmount ?? 'no-expected',
      sales.data?.length ?? 0,
      operationalLog.data?.items?.length ?? 0,
      closingAmount,
    ],
    queryFn: () =>
      apiFetch<CloseChecklist>(`/cash-register/close-checklist?actualAmount=${encodeURIComponent(String(closingAmount))}`),
    enabled: Boolean(currentCash.data),
  });
  const difference = closingAmount - expectedAmount;
  const financialMetricsUnavailable =
    dailySummary.isError ||
    dailySummary.isLoading ||
    (Boolean(currentCash.data) && (cashDailySummary.isError || cashDailySummary.isLoading));
  const financialSummaryError = dailySummary.error ?? cashDailySummary.error;
  const financialSummaryAvailable = Boolean(dailySummary.data) && Boolean(cashDailySummary.data) && !financialSummaryError;
  const closeChecklistAvailable = Boolean(closeChecklist.data) && !closeChecklist.error;
  const financialSummaryLoading =
    dailySummary.isLoading || currentCash.isLoading || (Boolean(currentCash.data) && cashDailySummary.isLoading);
  const latestClosedSession = history.data?.find((session) => session.status === 'CLOSED') ?? null;
  const enterpriseMethodLabels = cashDailySummary.data?.methodLabels ?? {};
  const salesByMethod = cashDailySummary.data?.salesByMethod ?? {};
  const expensesByMethod = cashDailySummary.data?.expensesByMethod ?? {};
  const purchasesByMethod = cashDailySummary.data?.purchasesByMethod ?? {};
  const cashRevenue = Number(cashDailySummary.data?.cashRevenue ?? 0);
  const digitalRevenue = Number(cashDailySummary.data?.digitalRevenue ?? 0);
  const totalRevenue = Number(cashDailySummary.data?.totalRevenue ?? dailySummary.data?.sales?.total ?? 0);
  const totalExpenses = Number(cashDailySummary.data?.totalExpenses ?? 0);
  const operationalResult = Number(cashDailySummary.data?.operationalResult ?? dailySummary.data?.metrics?.netProfit ?? 0);
  const cashExpenses = Number(expensesByMethod.cash ?? 0);
  const cashPurchases = Number(purchasesByMethod.cash ?? 0);
  const digitalExpenses = ['nequi', 'daviplata', 'transfer', 'card', 'other'].reduce(
    (sum, method) => sum + Number(expensesByMethod[method] ?? 0),
    0,
  );
  const digitalPurchases = ['nequi', 'daviplata', 'transfer', 'card', 'other'].reduce(
    (sum, method) => sum + Number(purchasesByMethod[method] ?? 0),
    0,
  );
  const paymentBreakdown = Object.entries(salesByMethod).map(([method, total]) => ({
    paymentMethod: enterpriseMethodLabels[method] ?? method,
    total: Number(total ?? 0),
  }));
  const rankedPaymentMethods = [...paymentBreakdown]
    .map((item) => ({ ...item, totalValue: Number(item.total ?? 0) }))
    .sort((left, right) => right.totalValue - left.totalValue);
  const activeOrdersCount = Number(dailySummary.data?.operations?.activeOrdersCount ?? 0);
  const availableConversionTables = (tables.data ?? []).filter(
    (table) => table.isActive && table.status !== 'OUT_OF_SERVICE' && table.status !== 'OCCUPIED',
  );
  // Solo la sesión de caja bloquea la operación completa.
  // Resúmenes y bitácoras degradan localmente para no tumbar la jornada.
  const pageError = currentCash.error;
  const operationalLogError = operationalLog.error;

  const openCash = useMutation({
    mutationFn: () => {
      if (!canOpenCash) throw new Error('No tienes permiso para abrir caja.');
      return apiFetch('/cash-register/open', {
        method: 'POST',
        body: JSON.stringify({
          openingAmount: Number(openingAmount),
          notes: openingNotes || undefined,
          openingBreakdown: serializeBreakdown(openingBreakdown),
        }),
      });
    },
    onSuccess: async () => {
      toast.success('Caja abierta y lista para operar');
      setOpeningNotes('');
      setOpeningBreakdown(createBreakdownState());
      await invalidateCash(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No pudimos abrir la caja.'),
  });

  const closeCash = useMutation({
    mutationFn: () => {
      if (!canCloseCash) throw new Error('No tienes permiso para cerrar caja.');
      return apiFetch<CloseCashResponse>('/cash-register/close', {
        method: 'POST',
        body: JSON.stringify({
          actualAmount: closingAmount,
          notes: closingNotes || undefined,
          closingBreakdown: serializeBreakdown(closingBreakdown),
        }),
      });
    },
    onSuccess: async (response) => {
      const whatsappNotification = response?.notifications?.whatsapp;
      if (whatsappNotification?.success) {
        toast.success('Caja cerrada, snapshot guardado y cierre enviado por WhatsApp');
      } else if (whatsappNotification?.skipped) {
        toast.success('Caja cerrada y snapshot del día guardado');
        if (whatsappNotification?.reason) {
          toast.warning(whatsappNotification.reason);
        }
      } else if (whatsappNotification?.reason) {
        toast.warning(`Caja cerrada, pero el envío automático falló: ${whatsappNotification.reason}`);
      } else {
        toast.success('Caja cerrada y snapshot del día guardado');
      }
      setClosingNotes('');
      setClosingBreakdown(createBreakdownState());
      setConfirmedClosingAmount(null);
      setConfirmedCriticalReview(false);
      setClosingConfirmationText('');
      queryClient.setQueryData(['cash-current'], null);
      await invalidateCash(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No pudimos cerrar la caja.'),
  });

  const reopenCash = useMutation({
    mutationFn: () => {
      if (!canReopenCash) throw new Error('No tienes permiso para reabrir caja.');
      return apiFetch('/cash-register/reopen', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: latestClosedSession?.id,
          reason: reopenReason,
        }),
      });
    },
    onSuccess: async () => {
      toast.success('Caja reabierta de forma controlada');
      setReopenReason('');
      await invalidateCash(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No pudimos reabrir la caja.'),
  });

  const createManualMovement = useMutation({
    mutationFn: () => {
      if (!canRecordManualCash) throw new Error('No tienes permiso para registrar movimientos manuales.');
      return apiFetch('/cash-register/movements/manual', {
        method: 'POST',
        body: JSON.stringify({
          type: manualType,
          amount: Number(manualAmount),
          classification: manualClassification,
          description: manualDescription || undefined,
        }),
      });
    },
    onSuccess: async () => {
      toast.success('Movimiento manual registrado');
      setManualAmount('');
      setManualDescription('');
      await invalidateCash(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No pudimos registrar el movimiento.'),
  });

  const convertSaleToOrder = useMutation({
    mutationFn: () => {
      if (!canRecoverSale) throw new Error('No tienes permiso para recuperar ventas.');
      if (!selectedSale) {
        throw new Error('Selecciona primero una venta.');
      }

      return apiFetch<{ success: boolean; orderTicket: { id: string; number: string } }>(
        `/sales/${selectedSale.id}/convert-to-order`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: convertOrderType,
            tableId: convertOrderType === 'DINE_IN' ? convertTableId : undefined,
            customerName: selectedSale.customerName ?? undefined,
            deliveryReference: selectedSale.deliveryReference ?? undefined,
            notes: selectedSale.notes ?? undefined,
            reason: convertReason,
          }),
        },
      );
    },
    onSuccess: async (response) => {
      toast.success(`Pedido recuperado como ${response.orderTicket.number}`);
      setSelectedSale(null);
      setConvertOrderType('DINE_IN');
      setConvertTableId('');
      setConvertReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['orders-active'] }),
        queryClient.invalidateQueries({ queryKey: ['reports-operational'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-operational-log'] }),
      ]);
      router.push(`/pos?orderId=${response.orderTicket.id}`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos recuperar esta venta como comanda.'),
  });

  const reopenConvertedOrder = useMutation({
    mutationFn: () => {
      if (!canRecoverSale) throw new Error('No tienes permiso para reabrir comandas convertidas.');
      if (!selectedSale?.conversion) {
        throw new Error('Esta venta no tiene una comanda vinculada.');
      }

      return apiFetch<{ success: boolean; orderTicket: { id: string; number: string } }>(
        `/sales/${selectedSale.id}/reopen-converted-order`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: convertReason,
          }),
        },
      );
    },
    onSuccess: async (response) => {
      toast.success(`Comanda ${response.orderTicket.number} reabierta correctamente`);
      setSelectedSale(null);
      setConvertReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['tables'] }),
        queryClient.invalidateQueries({ queryKey: ['orders-active'] }),
        queryClient.invalidateQueries({ queryKey: ['reports-operational'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-operational-log'] }),
      ]);
      router.push(`/pos?orderId=${response.orderTicket.id}`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos reabrir esta comanda.'),
  });

  const openReceiptPdf = async (saleId: string) => {
    try {
      const blob = await apiFetchBlob(`/sales/${saleId}/receipt-pdf`);
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No pudimos abrir el comprobante.');
    }
  };

  const openConvertedOrder = (orderTicketId: string) => {
    setSelectedSale(null);
    router.push(`/pos?orderId=${orderTicketId}`);
  };

  const openingAmountNum = Number(openingAmount);
  const canOpen = canOpenCash && openingAmountNum > 0 && !openCash.isPending;
  const canClose =
    closingAmount >= 0 &&
    confirmedClosingAmount === closingAmount &&
    confirmedCriticalReview &&
    closingConfirmationText.trim().toUpperCase() === 'CERRAR' &&
    closeChecklist.data?.canClose === true &&
    !closeChecklist.isLoading &&
    !closeCash.isPending && canCloseCash;
  const canReopen = canReopenCash && Boolean(reopenReason.trim()) && !reopenCash.isPending;
  const canManualMove = canRecordManualCash && Number(manualAmount) > 0 && !createManualMovement.isPending;
  const canConvertSelectedSale =
    Boolean(selectedSale) &&
    selectedSale?.status !== 'CANCELLED' &&
    !selectedSale?.conversion &&
    convertReason.trim().length >= 8 &&
    (convertOrderType !== 'DINE_IN' || Boolean(convertTableId)) &&
    !convertSaleToOrder.isPending && canRecoverSale;
  const canReopenSelectedOrder =
    Boolean(selectedSale?.conversion) &&
    selectedSale?.conversion?.orderTicket.status === 'PAID' &&
    convertReason.trim().length >= 8 &&
    !reopenConvertedOrder.isPending && canRecoverSale;

  useEffect(() => {
    setConfirmedClosingAmount(null);
  }, [closingAmount]);

  useEffect(() => {
    setConfirmedCriticalReview(false);
    setClosingConfirmationText('');
  }, [currentCash.data?.id]);

  return (
    <div data-testid="cash-page" className="space-y-6">
      <PageHeader
        eyebrow="Control financiero operativo"
        title="Caja en vivo"
        description="Apertura, arqueo, cierre y trazabilidad del dinero de la jornada."
        status={
          currentCash.data || currentCash.isSuccess ? (
            <Badge tone={currentCash.data ? 'success' : 'warning'}>
              {currentCash.data ? 'Caja abierta' : 'Caja cerrada'}
            </Badge>
          ) : undefined
        }
      />

      {!canOpenCash && !canCloseCash && !canRecordManualCash && !canRecoverSale ? (
        <QueryState status="permission_denied" title="Modo consulta" description="Puedes revisar caja y ventas, pero no abrir, cerrar, registrar movimientos ni recuperar comandas." />
      ) : null}

      {activeOrdersCount > 0 ? (
        <StatusBanner
          tone="warning"
          title="Hay comandas pendientes por cobrar"
          description={`Debes cobrar o cancelar ${activeOrdersCount} comanda${activeOrdersCount === 1 ? '' : 's'} antes del cierre.`}
        />
      ) : null}

      {pageError ? (
        <div data-testid="cash-global-error" className="space-y-3" role="alert">
          <StatusBanner
            tone="danger"
            title="No pudimos cargar toda la operación de caja"
            description={pageError instanceof Error ? pageError.message : 'Recarga la página e intenta de nuevo.'}
          />
          <Button type="button" variant="secondary" onClick={() => void currentCash.refetch()}>
            Reintentar estado de caja
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricSurface density="compact" label="Total recaudado" value={formatCurrency(totalRevenue)} context="Efectivo + recaudo digital" unavailable={financialMetricsUnavailable} icon={<CircleDollarSign className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Caja física esperada" value={formatCurrency(expectedAmount)} context="Solo efectivo del cajón" unavailable={financialMetricsUnavailable} icon={<Wallet className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Efectivo contado" value={formatCurrency(closingAmount)} context="Conteo físico por denominación" icon={<ShieldAlert className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Diferencia efectivo" value={formatCurrency(difference)} context="Contado vs caja física esperada" unavailable={financialMetricsUnavailable} icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)]">
        <div className="space-y-6">
          {currentCash.isLoading && !currentCash.data ? (
            <Card data-testid="cash-current-status" className="h-full overflow-hidden">
              <div className="space-y-4">
                <Skeleton className="h-6 w-32 rounded-full" />
                <Skeleton className="h-11 rounded-2xl" />
                <Skeleton className="h-11 rounded-2xl" />
                <Skeleton className="h-40 rounded-[1.45rem]" />
                <Skeleton className="h-11 w-32 rounded-2xl" />
              </div>
            </Card>
          ) : currentCash.isError ? (
            <div data-testid="cash-current-status">
              <QueryState
                status="error"
                title="No es seguro operar la caja"
                description="No pudimos verificar si existe una sesión abierta. Reintenta antes de abrir, cerrar o registrar movimientos."
                onRetry={() => void currentCash.refetch()}
              />
            </div>
          ) : !currentCash.data ? (
            <Card data-testid="cash-current-status" className="h-full overflow-hidden">
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold lg:text-[1.12rem]">Abrir caja — Empezá tu jornada</h2>
                  <p className="mt-1 text-[13px] leading-6 text-stone-500">Registra el monto inicial y, si aplica, una composición básica del efectivo recibido.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Caja inicial (COP)" required>
                    <Input data-testid="cash-open-amount" type="number" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} />
                    {openingAmountNum <= 0 ? (
                      <p className="mt-1.5 text-[12px] leading-5 text-red-600">
                        El monto de apertura debe ser mayor a $0.
                      </p>
                    ) : null}
                  </Field>
                  <Field label="Notas de apertura">
                    <Input value={openingNotes} onChange={(event) => setOpeningNotes(event.target.value)} placeholder="Cambio entregado, novedades..." />
                  </Field>
                </div>
                <DenominationGrid breakdown={openingBreakdown} onChange={setOpeningBreakdown} title="Arqueo inicial opcional" />
                <Button data-testid="cash-open-submit" disabled={!canOpen} onClick={() => openCash.mutate()}>
                  {openCash.isPending ? 'Abriendo caja...' : 'Abrir caja'}
                </Button>

                {latestClosedSession ? (
                  <div className="rounded-[1.45rem] border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-amber-900">Reapertura controlada</p>
                        <p className="mt-1 text-[13px] leading-6 text-amber-800">
                          Último cierre: {formatDateTime(latestClosedSession.closedAt)} · {formatCurrency(latestClosedSession.closingAmount)}
                        </p>
                      </div>
                      <Badge tone="warning">Supervisor</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                      <Input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Motivo de reapertura controlada" />
                      <Button variant="secondary" disabled={!canReopen} onClick={() => reopenCash.mutate()}>
                        {reopenCash.isPending ? 'Reabriendo...' : 'Reabrir'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : (
            <>
              <Card data-testid="cash-current-status" className="min-h-[220px] overflow-hidden">
                <div className="rounded-[1.55rem] border border-emerald-100 bg-emerald-50/60 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold lg:text-[1.12rem]">Caja operativa</h2>
                    <p className="mt-1 text-[13px] leading-6 text-stone-500">
                      Abierta {formatDateTime(currentCash.data.openedAt)} · por {currentCash.data.openedBy?.fullName ?? 'Sin responsable'}
                    </p>
                  </div>
                  <Badge tone="success">Activa</Badge>
                </div>

                <div className="mt-5 rounded-[1.35rem] border border-white/80 bg-white/85 p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Caja física esperada</p>
                  <p
                    className="numeric-tabular mt-2 text-[2rem] font-black leading-none tracking-tight text-ink"
                    data-testid="cash-expected-amount"
                  >
                    {financialMetricsUnavailable ? 'No disponible' : formatCurrency(expectedAmount)}
                  </p>
                  <p className="mt-2 text-[13px] leading-6 text-stone-600">
                    Solo efectivo físico: dinero inicial + ventas en efectivo - egresos en efectivo.
                  </p>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <SummaryItem label="Dinero inicial" value={formatCurrency(currentCash.data.openingAmount)} tone="brand" />
                  <SummaryItem label="Apertura registrada" value={formatDateTime(currentCash.data.openedAt)} tone="success" />
                </div>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div>
                  <h2 className="text-lg font-semibold lg:text-[1.12rem]">Arqueo — Contá tu caja</h2>
                  <p className="mt-1 text-[13px] leading-6 text-stone-500">
                    Cuenta el efectivo, compara contra la caja esperada y registra el cierre de la jornada.
                  </p>
                </div>

                <div className="mt-5">
                  <DenominationGrid breakdown={closingBreakdown} onChange={setClosingBreakdown} title="Arqueo — Contá tu caja" />
                </div>

                <div className="mt-4 flex justify-end">
                  <Button
                    data-testid="cash-use-expected"
                    variant="secondary"
                    disabled={financialMetricsUnavailable}
                    onClick={() => setClosingBreakdown(createBreakdownStateFromAmount(expectedAmount))}
                  >
                    Usar valor esperado
                  </Button>
                </div>

                {financialMetricsUnavailable ? (
                  <div
                    className="mt-4 rounded-[1.45rem] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900"
                    data-testid="cash-reconciliation-unavailable"
                    role="status"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Resultado del arqueo</p>
                    <p className="mt-1.5 text-sm font-semibold">Comparación no disponible</p>
                    <p className="mt-2 text-[13px] leading-6">No calculamos diferencias hasta verificar la caja física esperada.</p>
                  </div>
                ) : (
                  <div className={`mt-4 rounded-[1.45rem] border px-4 py-4 ${difference === 0 ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Resultado del arqueo</p>
                        <p className="mt-1.5 numeric-tabular text-[1.35rem] font-bold leading-none">{formatCurrency(difference)}</p>
                      </div>
                      <Badge tone={difference === 0 ? 'success' : 'warning'}>{difference === 0 ? 'Cuadrado' : 'Revisar'}</Badge>
                    </div>
                    <p className="mt-2 text-[13px] leading-6">{difference === 0 ? 'Cuadre exacto entre efectivo contado y caja esperada.' : 'Revisa pagos, gastos y movimientos manuales antes de cerrar.'}</p>
                  </div>
                )}

                {closeChecklist.error ? (
                  <div className="mt-4 rounded-[1.2rem] border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] leading-6 text-danger">
                    No pudimos cargar el checklist de cierre. Reintenta en unos segundos antes de cerrar.
                  </div>
                ) : null}

                <div className="mt-4 rounded-[1.45rem] border border-stone-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Checklist de cierre</p>
                      <p className="mt-1 text-[13px] leading-6 text-stone-600">
                        Verificación automática antes de cerrar. Corrige lo bloqueante y confirma la lectura final.
                      </p>
                    </div>
                    <Badge tone={!closeChecklistAvailable ? 'default' : closeChecklist.data?.canClose ? 'success' : 'warning'}>
                      {closeChecklist.isLoading ? 'Analizando' : !closeChecklistAvailable ? 'Sin verificar' : closeChecklist.data?.canClose ? 'Listo' : 'Revisar'}
                    </Badge>
                  </div>

                  {closeChecklistAvailable ? (
                  <div data-testid="cash-close-checklist-values">
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <ChecklistChip
                      label="Comandas abiertas"
                      value={closeChecklist.data?.activeOrdersCount ?? 0}
                      tone={(closeChecklist.data?.activeOrdersCount ?? 0) === 0 ? 'success' : 'danger'}
                      description={(closeChecklist.data?.activeOrdersCount ?? 0) === 0 ? 'Sin pendientes por cobrar.' : 'Bloquea el cierre hasta resolverlas.'}
                    />
                    <ChecklistChip
                      label="Pagos descuadrados"
                      value={closeChecklist.data?.paymentMismatchCount ?? 0}
                      tone={(closeChecklist.data?.paymentMismatchCount ?? 0) === 0 ? 'success' : 'danger'}
                      description={(closeChecklist.data?.paymentMismatchCount ?? 0) === 0 ? 'Los cobros cuadran con las ventas.' : 'Hay ventas pagadas con diferencia.'}
                    />
                    <ChecklistChip
                      label="Gastos sin clasificar"
                      value={closeChecklist.data?.uncategorizedExpensesCount ?? 0}
                      tone={(closeChecklist.data?.uncategorizedExpensesCount ?? 0) === 0 ? 'success' : 'danger'}
                      description={(closeChecklist.data?.uncategorizedExpensesCount ?? 0) === 0 ? 'Todos los egresos tienen clasificación.' : 'Clasifica los gastos antes de cerrar.'}
                    />
                    <ChecklistChip
                      label="Diferencia arqueo"
                      value={formatCurrency(closeChecklist.data?.difference ?? difference)}
                      tone={Number(closeChecklist.data?.difference ?? difference) === 0 ? 'success' : 'warning'}
                      description={Number(closeChecklist.data?.difference ?? difference) === 0 ? 'No hay descuadre en el efectivo.' : 'Revisa el efectivo contado antes de cerrar.'}
                    />
                  </div>

                  {closeChecklist.data?.summary ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <SummaryItem label="Ventas cobradas" value={formatCurrency(closeChecklist.data.summary.salesTotal)} tone="success" />
                      <SummaryItem label="Compras del tramo" value={formatCurrency(closeChecklist.data.summary.purchasesTotal)} tone="brand" />
                      <SummaryItem label="Gastos del tramo" value={formatCurrency(closeChecklist.data.summary.expensesTotal)} tone="warning" />
                      <SummaryItem
                        label="Ajustes / movimientos"
                        value={`${closeChecklist.data.summary.adjustedSalesCount} ventas · ${closeChecklist.data.summary.manualMovementsCount} movimientos`}
                      />
                    </div>
                  ) : null}

                  {closeChecklist.data?.blockers?.length ? (
                    <div className="mt-4 rounded-[1.15rem] border border-amber-200 bg-amber-50 px-3.5 py-3">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-amber-900">Bloqueos activos</p>
                      <div className="mt-2 space-y-1.5">
                        {closeChecklist.data.blockers.map((blocker) => (
                          <p key={blocker} className="text-[12px] leading-5 text-amber-900">
                            {blocker}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  </div>
                  ) : (
                    <div className="mt-4" data-testid="cash-close-checklist-unavailable">
                      <QueryState
                        status={closeChecklist.isLoading ? 'loading' : 'error'}
                        title={closeChecklist.isLoading ? 'Verificando el cierre' : 'Checklist de cierre no disponible'}
                        description={closeChecklist.isLoading ? undefined : 'No mostramos ceros ni aprobaciones hasta validar la evidencia de cierre.'}
                        onRetry={closeChecklist.error ? () => void closeChecklist.refetch() : undefined}
                        skeletonRows={2}
                      />
                    </div>
                  )}

                  {closeChecklist.data?.warnings?.length ? (
                    <div className="mt-4 rounded-[1.15rem] border border-stone-200 bg-stone-50 px-3.5 py-3">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-700">Notas importantes</p>
                      <div className="mt-2 space-y-1.5">
                        {closeChecklist.data.warnings.map((warning) => (
                          <p key={warning} className="text-[12px] leading-5 text-stone-700">
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {closeChecklist.data?.paymentMismatches?.length ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-500">Ventas con diferencia</p>
                      {closeChecklist.data.paymentMismatches.slice(0, 3).map((sale) => (
                        <div key={sale.id} className="flex items-center justify-between gap-3 rounded-[1rem] border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[12px] text-stone-600">
                          <span>{sale.number}</span>
                          <span className="numeric-tabular font-semibold text-ink">{formatCurrency(sale.difference)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {closeChecklist.data?.uncategorizedExpenses?.length ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-500">Gastos sin clasificar</p>
                      {closeChecklist.data.uncategorizedExpenses.slice(0, 3).map((expense) => (
                        <div key={expense.id} className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[12px] text-stone-600">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-ink">{expense.concept}</span>
                            <span className="numeric-tabular font-semibold text-ink">{formatCurrency(expense.amount)}</span>
                          </div>
                          <p className="mt-1 text-stone-500">Clasificación pendiente · {expense.paymentMethod ?? 'Sin método'}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <label className="mt-4 flex items-start gap-3 rounded-[1.15rem] border border-stone-200 bg-stone-50 px-3.5 py-3">
                    <input
                      type="checkbox"
                      checked={confirmedClosingAmount === closingAmount}
                      onChange={(event) =>
                        setConfirmedClosingAmount(event.target.checked ? closingAmount : null)
                      }
                      className="mt-1 h-4.5 w-4.5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-[13px] leading-6 text-stone-700">
                      Confirmo que revisé el arqueo, los bloqueos y el resumen antes de cerrar esta caja.
                    </span>
                  </label>

                  <label className="mt-3 flex items-start gap-3 rounded-[1.15rem] border border-stone-200 bg-stone-50 px-3.5 py-3">
                    <input
                      type="checkbox"
                      checked={confirmedCriticalReview}
                      onChange={(event) => setConfirmedCriticalReview(event.target.checked)}
                      className="mt-1 h-4.5 w-4.5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-[13px] leading-6 text-stone-700">
                      Confirmo que resolví o revisé explícitamente comandas abiertas, pagos descuadrados y gastos sin clasificar antes del cierre.
                    </span>
                  </label>

                  <div className="mt-3">
                    <Field
                      label="Confirmación final"
                      hint="Escribe CERRAR para ejecutar el cierre asistido."
                    >
                      <Input
                        value={closingConfirmationText}
                        onChange={(event) => setClosingConfirmationText(event.target.value.toUpperCase())}
                        placeholder="CERRAR"
                      />
                    </Field>
                  </div>

                  {difference !== 0 ? (
                    <div className="mt-3 rounded-[1.1rem] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] leading-5 text-amber-900">
                      El cierre puede hacerse con diferencia, pero este sistema te lo deja visible para decisión operativa.
                    </div>
                  ) : null}
                </div>

                <div className="mt-4">
                  <Field label="Observaciones de cierre">
                    <Textarea value={closingNotes} onChange={(event) => setClosingNotes(event.target.value)} className="min-h-24" />
                  </Field>
                </div>

                <Button className="mt-4" data-testid="cash-close-submit" disabled={!canClose} onClick={() => closeCash.mutate()}>
                  {closeCash.isPending ? 'Cerrando caja...' : 'Cerrar caja y guardar el día'}
                </Button>
              </Card>
            </>
          )}

          <Card className="h-full overflow-hidden p-0">
            <div className="border-b border-stone-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-brand-700" />
                <div>
                  <h2 className="text-lg font-semibold lg:text-[1.12rem]">Historial de caja</h2>
                  <p className="mt-1 text-sm text-stone-500">Aperturas, cierres y reaperturas controladas recientes.</p>
                </div>
              </div>
            </div>
            <div
              className="hide-scrollbar list-scroll-5-rows divide-y divide-stone-100"
              role="region"
              aria-label="Historial de jornadas de caja"
              tabIndex={0}
            >
              {history.isError ? (
                <div className="p-6">
                  <QueryState
                    status="error"
                    title="Historial de caja no disponible"
                    description="No interpretamos el fallo financiero como un historial vacío."
                    onRetry={() => void history.refetch()}
                  />
                </div>
              ) : history.isLoading ? Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="px-5 py-4"><Skeleton className="h-16 rounded-2xl" /></div>
              )) : null}
              {!history.isError && !history.isLoading && history.data?.length ? history.data.map((session) => (
                <div key={session.id} className="grid gap-4 px-5 py-4 md:grid-cols-[0.95fr_0.7fr_0.7fr_0.7fr]">
                  <div>
                    <p className="font-medium text-ink">{formatDate(session.openedAt)}</p>
                    <p className="text-sm text-stone-500">{translateSessionStatus(session.status)}{session.reopenedFromSessionId ? ' · Reapertura' : ''}</p>
                  </div>
                  <div className="text-sm">
                    <p className="text-stone-500">Apertura</p>
                    <p className="mt-1 font-medium text-ink">{formatCurrency(session.openingAmount)}</p>
                  </div>
                  <div className="text-sm">
                    <p className="text-stone-500">Cierre</p>
                    <p className="mt-1 font-medium text-ink">{formatCurrency(session.closingAmount)}</p>
                  </div>
                  <div className="text-sm">
                    <p className="text-stone-500">Diferencia</p>
                    <p className="mt-1 font-medium text-ink">{formatCurrency(session.difference)}</p>
                  </div>
                </div>
              )) : !history.isError && !history.isLoading ? <div className="p-6"><EmptyState title="Tu historial de caja va a aparecer acá." description="Aquí aparecerá el histórico de caja." /></div> : null}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card data-testid="cash-daily-summary-card" className="min-h-[220px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold lg:text-[1.12rem]">El día hasta ahora</h2>
                <p className="mt-1 text-[13px] leading-6 text-stone-500">Ventas, compras, gastos y recaudo por medio de pago.</p>
              </div>
              <Badge tone="default">{paymentBreakdown.length} medios</Badge>
            </div>
            {financialSummaryError ? (
              <div data-testid="cash-daily-summary-error" className="mt-4">
                <StatusBanner
                  tone="warning"
                  title="Resumen del día no disponible"
                  description={
                    financialSummaryError instanceof Error
                      ? financialSummaryError.message
                      : 'La caja sigue operable; vuelve a intentar cargar el resumen en unos segundos.'
                  }
                />
              </div>
            ) : null}
            {financialSummaryAvailable ? (
              <div data-testid="cash-daily-summary-values">
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <SummaryItem label="Caja física esperada" value={formatCurrency(expectedAmount)} tone="success" />
                  <SummaryItem label="Recaudo digital" value={formatCurrency(digitalRevenue)} tone="brand" />
                  <SummaryItem label="Total recaudado" value={formatCurrency(totalRevenue)} tone="success" />
                  <SummaryItem label="Resultado operativo" value={formatCurrency(operationalResult)} tone="ink" emphasis />
                  <SummaryItem label="Ventas efectivo" value={formatCurrency(cashRevenue)} />
                  <SummaryItem label="Egresos efectivo" value={formatCurrency(cashExpenses + cashPurchases)} tone="warning" />
                  <SummaryItem label="Egresos digitales" value={formatCurrency(digitalExpenses + digitalPurchases)} tone="warning" />
                  <SummaryItem label="Total egresos" value={formatCurrency(totalExpenses)} tone="danger" />
                </div>
                <div
                  className="hide-scrollbar list-scroll-5-compact mt-5 space-y-2.5 pr-1"
                  role="region"
                  aria-label="Desglose por medio de pago"
                  tabIndex={0}
                >
                  {paymentBreakdown.length ? paymentBreakdown.map((item) => (
                    <div key={item.paymentMethod} className={`flex items-center justify-between gap-4 rounded-[1.15rem] border px-4 py-3 ${getPaymentMethodClass(item, rankedPaymentMethods)}`}>
                      <span className="min-w-0 truncate text-[13px] font-semibold">{translatePaymentMethod(item.paymentMethod)}</span>
                      <span className="numeric-tabular shrink-0 text-[13px] font-bold">{formatCurrency(item.total)}</span>
                    </div>
                  )) : <EmptyState title="El recaudo aparecerá cuando empiecen las ventas." description="Aquí verás la distribución por medio de pago." />}
                </div>
              </div>
            ) : financialSummaryError ? null : financialSummaryLoading ? (
              <p className="mt-5 text-sm text-muted" role="status">Verificando fuentes financieras…</p>
            ) : (
              <p className="mt-5 text-sm text-muted" role="status" data-testid="cash-daily-summary-unavailable">
                El desglose financiero no está disponible sin una sesión de caja activa verificada.
              </p>
            )}
          </Card>

          <Card className="min-h-[220px]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold lg:text-[1.12rem]">Movimiento manual</h2>
                <p className="text-[13px] leading-6 text-stone-500">Registra retiros, ingresos extraordinarios o correcciones con clasificación explícita.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Tipo">
                <Select value={manualType} onChange={(event) => setManualType(event.target.value as typeof manualType)}>
                  {manualMovementOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Clasificación">
                <Select value={manualClassification} onChange={(event) => setManualClassification(event.target.value)}>
                  {manualMovementClasses.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Valor (COP)">
                <Input type="number" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} />
              </Field>
              <Field label="Descripción">
                <Input value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="Soporte o detalle del movimiento" />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button disabled={!canManualMove || !currentCash.data} onClick={() => createManualMovement.mutate()}>
                {createManualMovement.isPending ? 'Registrando...' : 'Registrar movimiento'}
              </Button>
            </div>
          </Card>

          <div>
            <Card className="overflow-hidden p-0">
              <div className="border-b border-stone-100 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold lg:text-[1.12rem]">Ventas de la jornada</h2>
                    <p className="mt-1 text-sm text-stone-500">
                      Revisa lo vendido, abre el comprobante y consulta su trazabilidad.
                    </p>
                  </div>
                  <Badge tone="default">{sales.isError ? 'No disponible' : `${sales.data?.length ?? 0} ventas`}</Badge>
                </div>
              </div>
              <div
                className="hide-scrollbar list-scroll-5-rows divide-y divide-stone-100"
                role="region"
                aria-label="Ventas de la jornada"
                tabIndex={0}
              >
                {sales.isLoading
                  ? Array.from({ length: 5 }).map((_, index) => (
                      <div key={index} className="px-5 py-4">
                        <Skeleton className="h-24 rounded-2xl" />
                      </div>
                    ))
                  : null}
                {!sales.isLoading && sales.data?.length
                  ? sales.data.map((sale) => (
                      <div key={sale.id} className="grid gap-4 px-5 py-4 transition hover:bg-brand-50/35 xl:grid-cols-[1.05fr_0.95fr]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-ink">{formatReceiptNumber(sale.number)}</p>
                            <Badge tone="info">{translateSaleChannel(sale.channel)}</Badge>
                            {sale.conversion ? (
                              <Badge tone="warning">Convertida a {sale.conversion.orderTicket.number}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-sm font-medium text-stone-700">
                            {sale.tableLabel ?? sale.customerName ?? sale.deliveryReference ?? 'Venta mostrador'}
                          </p>
                          <p className="mt-1 text-[12px] text-stone-500">{formatDateTime(sale.soldAt)}</p>
                          {sale.channel === 'DOMICILIO' ? (
                            <p
                              data-testid={`cash-sale-delivery-fee-${sale.id}`}
                              className="mt-1 numeric-tabular text-[12px] font-semibold text-emerald-700"
                            >
                              Domicilio {formatCurrency(sale.deliveryFee ?? 0)}
                            </p>
                          ) : null}
                          <div className="mt-3 space-y-1.5">
                            {sale.items.slice(0, 3).map((item, index) => (
                              <p key={`${sale.id}-${index}`} className="truncate text-[13px] text-stone-600">
                                {Number(item.quantity)} x {item.product.name}
                              </p>
                            ))}
                            {sale.items.length > 3 ? (
                              <p className="text-[12px] font-medium text-stone-500">
                                +{sale.items.length - 3} producto{sale.items.length - 3 === 1 ? '' : 's'}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-col items-start gap-3 xl:items-end">
                          <p className="numeric-tabular text-xl font-black leading-none text-ink">{formatCurrency(sale.total)}</p>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              title="Ver detalle de la venta"
                              aria-label="Ver detalle de la venta"
                              className="h-11 w-11 min-w-0 rounded-full p-0"
                              onClick={() => setSelectedSale(sale)}
                            >
                              <Eye className="h-4.5 w-4.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              title="Abrir comprobante"
                              aria-label="Abrir comprobante"
                              className="h-11 w-11 min-w-0 rounded-full p-0"
                              onClick={() => openReceiptPdf(sale.id)}
                            >
                              <FileDown className="h-4.5 w-4.5" />
                            </Button>
                            {sale.conversion ? (
                              <Button
                                type="button"
                                variant="secondary"
                                title={
                                  sale.conversion.orderTicket.status === 'PAID'
                                    ? 'Reabrir comanda convertida'
                                    : 'Abrir comanda convertida'
                                }
                                aria-label={
                                  sale.conversion.orderTicket.status === 'PAID'
                                    ? 'Reabrir comanda convertida'
                                    : 'Abrir comanda convertida'
                                }
                                className="min-h-11 min-w-0 rounded-full px-3 text-[11px]"
                                onClick={() =>
                                  sale.conversion?.orderTicket.status === 'PAID'
                                    ? setSelectedSale(sale)
                                    : openConvertedOrder(sale.conversion!.orderTicket.id)
                                }
                              >
                                {sale.conversion.orderTicket.status === 'PAID' ? 'Reabrir' : 'Abrir'}
                              </Button>
                            ) : null}
                            {!sale.conversion && sale.status !== 'CANCELLED' ? (
                              <Button
                                type="button"
                                variant="secondary"
                                title="Recuperar como comanda"
                                aria-label="Recuperar como comanda"
                                className="min-h-11 min-w-0 rounded-full px-3 text-[11px]"
                                onClick={() => setSelectedSale(sale)}
                              >
                                Recuperar
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))
                  : null}
                {sales.isError ? (
                  <div className="p-6" data-testid="cash-sales-error">
                    <QueryState
                      status="error"
                      title="Ventas no disponibles"
                      description="No mostramos una jornada vacía cuando la fuente de ventas no responde."
                      onRetry={() => void sales.refetch()}
                    />
                  </div>
                ) : null}
                {sales.isSuccess && sales.data.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="Sin ventas registradas"
                      description="Aquí aparecerán con su comprobante listo para consulta o reenvío."
                    />
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
          <Card data-testid="cash-operational-log-card" className="h-full overflow-hidden p-0">
          <div className="border-b border-stone-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <ScrollText className="h-5 w-5 text-brand-700" />
              <div>
                <h2 className="text-lg font-semibold lg:text-[1.12rem]">Bitácora operativa del día</h2>
                <p className="mt-1 text-sm text-stone-500">Caja, compras, gastos, inventario y cierres ordenados por hora.</p>
              </div>
            </div>
          </div>
          {operationalLogError ? (
            <div data-testid="cash-operational-log-error" className="border-b border-amber-100 px-5 py-4">
              <StatusBanner
                tone="warning"
                title="Bitácora temporalmente no disponible"
                description={
                  operationalLogError instanceof Error
                    ? operationalLogError.message
                    : 'La operación de caja continúa disponible; la bitácora puede reintentarse después.'
                }
              />
            </div>
          ) : null}
          <div
            className="hide-scrollbar list-scroll-5-rows divide-y divide-stone-100"
            role="region"
            aria-label="Bitacora operativa de caja"
            tabIndex={0}
          >
            {operationalLog.isLoading ? Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="px-5 py-4"><Skeleton className="h-16 rounded-2xl" /></div>
            )) : null}
            {!operationalLog.isLoading && operationalLog.data?.items?.length ? operationalLog.data.items.map((item) => (
              <div key={item.id} className="grid gap-3 px-5 py-4 md:grid-cols-[0.9fr_0.7fr_0.7fr]">
                <div>
                  <p className="font-medium text-ink">{item.title}</p>
                  <p className="text-sm text-stone-500">{item.detail}</p>
                </div>
                <div className="text-sm text-stone-600">{item.type.replaceAll('_', ' ')}</div>
                <div className="text-right text-sm">
                  <p className="font-medium text-ink">{item.amount ? formatCurrency(item.amount) : 'Sin valor'}</p>
                  <p className="text-stone-500">{formatDateTime(item.at)}</p>
                </div>
              </div>
            )) : null}
          </div>
          </Card>
        </div>
      </div>

      {selectedSale ? (
        <DetailDialog
          open
          onClose={() => setSelectedSale(null)}
          title={formatReceiptNumber(selectedSale.number)}
          description={`Venta cerrada · ${formatDateTime(selectedSale.soldAt)}`}
          mode="dialog"
          closeLabel="Cerrar detalle de venta"
          footer={(
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button type="button" variant="secondary" onClick={() => openReceiptPdf(selectedSale.id)}>
                <FileDown className="h-4 w-4" aria-hidden="true" />
                Abrir comprobante
              </Button>
              <Button type="button" variant="secondary" className="w-full" onClick={() => setSelectedSale(null)}>
                Cerrar
              </Button>
            </div>
          )}
        >
          <div className="space-y-4">
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">Detalle de la venta</p>
                      <p className="mt-1 text-[13px] leading-6 text-stone-500">
                        {selectedSale.tableLabel ?? selectedSale.customerName ?? selectedSale.deliveryReference ?? 'Pedido de mostrador'}
                      </p>
                    </div>
                    <Badge tone="success">{formatCurrency(selectedSale.total)}</Badge>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    {selectedSale.items.map((item, index) => (
                      <div key={`${selectedSale.id}-detail-${index}`} className="flex items-center justify-between rounded-2xl bg-stone-50 px-3.5 py-3 text-sm">
                        <div>
                          <p className="font-medium text-ink">{item.product.name}</p>
                          <p className="text-[12px] text-stone-500">
                            {Number(item.quantity)} x {formatCurrency(item.unitPrice)}
                          </p>
                        </div>
                        <p className="font-semibold text-ink">{formatCurrency(item.totalPrice)}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">Recuperar pedido como comanda</p>
                      <p className="mt-1 text-[13px] leading-6 text-stone-500">
                        Úsalo solo para ventas históricas que debieron seguir abiertas como pedido. El flujo normal del POS ahora nace siempre desde una comanda.
                      </p>
                    </div>
                    {selectedSale.conversion ? (
                      <Badge tone="warning">
                        {selectedSale.conversion.orderTicket.status === 'PAID'
                          ? `Convertida y cobrada como ${selectedSale.conversion.orderTicket.number}`
                          : `Ya convertida a ${selectedSale.conversion.orderTicket.number}`}
                      </Badge>
                    ) : null}
                  </div>
                  {selectedSale.conversion ? (
                    <div className="mt-4 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 p-4">
                      {selectedSale.conversion.orderTicket.status === 'PAID' ? (
                        <>
                          <p className="text-sm font-semibold text-emerald-900">
                            Esta venta ya fue convertida y esa comanda se cobró después como {selectedSale.conversion.orderTicket.number}.
                          </p>
                          <p className="mt-1 text-[13px] leading-6 text-emerald-800">
                            Si necesitas volver a dejarla abierta, el sistema reversa esa venta cobrada y reabre la comanda restaurando los productos de esta venta original.
                          </p>
                          <div className="mt-4">
                            <Field label="Motivo de reapertura" required hint="Queda registrado en auditoría. Mínimo 8 caracteres.">
                              <Textarea
                                value={convertReason}
                                onChange={(event) => setConvertReason(event.target.value)}
                                placeholder="Ejemplo: la comanda se cerró antes de tiempo y debe seguir abierta."
                              />
                            </Field>
                          </div>
                          <div className="mt-4 flex justify-end">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={!canReopenSelectedOrder}
                              onClick={() => reopenConvertedOrder.mutate()}
                            >
                              {reopenConvertedOrder.isPending ? 'Reabriendo...' : 'Reabrir comanda'}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-emerald-900">
                            Esta venta ya quedó abierta otra vez como {selectedSale.conversion.orderTicket.number}.
                          </p>
                          <p className="mt-1 text-[13px] leading-6 text-emerald-800">
                            Puedes retomarla en punto de venta para seguir editándola o cobrarla después.
                          </p>
                          <div className="mt-4 flex justify-end">
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => openConvertedOrder(selectedSale.conversion!.orderTicket.id)}
                            >
                              Abrir comanda
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-3.5">
                          <Field label="Tipo de atención recuperado" required>
                            <Select value={convertOrderType} onChange={(event) => setConvertOrderType(event.target.value as typeof convertOrderType)}>
                              <option value="DINE_IN">Mesa</option>
                              <option value="COUNTER">Venta directa</option>
                              <option value="DELIVERY">Domicilio</option>
                            </Select>
                          </Field>
                        </div>
                        {convertOrderType === 'DINE_IN' ? (
                          <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50 p-3.5">
                            <Field label="Mesa" required>
                              <Select value={convertTableId} onChange={(event) => setConvertTableId(event.target.value)}>
                                <option value="">Selecciona mesa</option>
                                {availableConversionTables.map((table) => (
                                  <option key={table.id} value={table.id}>
                                    {table.area ? `${table.label} · ${table.area}` : table.label}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          </div>
                        ) : null}
                        <div className="sm:col-span-2">
                          <Field label="Motivo" required hint="Queda registrado en auditoría. Mínimo 8 caracteres.">
                            <Textarea
                              value={convertReason}
                              onChange={(event) => setConvertReason(event.target.value)}
                              placeholder="Ejemplo: el pedido se cerró por error y debía seguir abierto."
                            />
                          </Field>
                        </div>
                      </div>
                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!canConvertSelectedSale}
                          onClick={() => convertSaleToOrder.mutate()}
                        >
                          {convertSaleToOrder.isPending ? 'Recuperando...' : 'Recuperar como comanda'}
                        </Button>
                      </div>
                    </>
                  )}
                </Card>

                <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3" data-testid="cash-whatsapp-retired">
                  <p className="text-[12px] font-bold text-amber-900">Envío directo por WhatsApp no disponible</p>
                  <p className="mt-1 text-[11px] leading-5 text-amber-800">
                    El transporte legado fue retirado. El comprobante permanece disponible para consulta e impresión.
                  </p>
                </div>
          </div>
        </DetailDialog>
      ) : null}
    </div>
  );
}

function DenominationGrid({
  breakdown,
  onChange,
  title,
}: {
  breakdown: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  title: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-line bg-canvas p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-bold text-stone-700">{title}</p>
        <p className="numeric-tabular text-base font-black text-ink">{formatCurrency(sumBreakdown(breakdown))}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {denominations.map((value) => (
          <label key={value} className="rounded-2xl border border-stone-200 bg-white px-3 py-3 shadow-sm transition focus-within:border-brand-300 focus-within:shadow-soft">
            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              {formatCurrency(value)}
            </span>
            <Input
              className="mt-2"
              type="number"
              min="0"
              value={breakdown[String(value)] ?? '0'}
              onChange={(event) =>
                onChange({
                  ...breakdown,
                  [String(value)]: event.target.value,
                })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone = 'neutral',
  emphasis = false,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'ink';
  emphasis?: boolean;
}) {
  const palette = {
    neutral: 'border-stone-200 bg-stone-50 text-stone-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    brand: 'border-brand-200 bg-brand-50 text-brand-900',
    ink: 'border-stone-900 bg-stone-950 text-white',
  };

  return (
    <div className={`rounded-[1.35rem] border px-4 py-3.5 ${palette[tone]} ${emphasis ? 'shadow-soft' : ''}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${tone === 'ink' ? 'text-white/70' : ''}`}>{label}</p>
      <p className={`numeric-tabular mt-2 font-bold leading-none ${emphasis ? 'text-[1.25rem]' : 'text-[1rem]'} ${tone === 'ink' ? 'text-white' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function getPaymentMethodClass(item: { paymentMethod: string; total: number | string }, rankedPaymentMethods: Array<{ paymentMethod: string; totalValue: number }>) {
  const total = Number(item.total ?? 0);
  if (total <= 0) {
    return 'border-stone-200 bg-stone-50 text-stone-500';
  }

  const rank = rankedPaymentMethods.findIndex((ranked) => ranked.paymentMethod === item.paymentMethod && ranked.totalValue > 0);
  if (rank === 0) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  if (rank === 1) {
    return 'border-brand-200 bg-brand-50 text-brand-900';
  }
  if (rank === 2) {
    return 'border-sky-200 bg-sky-50 text-sky-900';
  }

  return 'border-stone-200 bg-white text-stone-700';
}

function translatePaymentMethod(method: string) {
  const labels: Record<string, string> = {
    CASH: 'Efectivo',
    NEQUI: 'Nequi',
    DAVIPLATA: 'Daviplata',
    TRANSFER: 'Transferencia',
    BANK_TRANSFER: 'Transferencia',
    CARD: 'Tarjeta',
    CREDIT_CARD: 'Tarjeta',
    DEBIT_CARD: 'Tarjeta',
  };
  return labels[method] ?? method;
}

function ChecklistChip({
  label,
  value,
  tone,
  description,
}: {
  label: string;
  value: string | number;
  tone: 'success' | 'warning' | 'danger';
  description: string;
}) {
  const palette =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-red-200 bg-red-50 text-red-900';

  return (
    <div className={`rounded-[1.15rem] border px-3.5 py-3 ${palette}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</p>
      <p className="numeric-tabular mt-1 text-[1.05rem] font-bold leading-none">{value}</p>
      <p className="mt-1.5 text-[12px] leading-5 opacity-80">{description}</p>
    </div>
  );
}

function translateSessionStatus(status: string) {
  const labels: Record<string, string> = {
    OPEN: 'Abierta',
    CLOSED: 'Cerrada',
    CANCELLED: 'Cancelada',
  };
  return labels[status] ?? status;
}

function translateSaleChannel(channel: string) {
  const labels: Record<string, string> = {
    MOSTRADOR: 'Mostrador',
    PARA_LLEVAR: 'Mostrador',
    MESA: 'Mesa',
    DOMICILIO: 'Domicilio',
  };
  return labels[channel] ?? channel;
}

async function invalidateCash(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['cash-current'] }),
    queryClient.invalidateQueries({ queryKey: ['cash-history'] }),
    queryClient.invalidateQueries({ queryKey: ['cash-daily-summary'] }),
    queryClient.invalidateQueries({ queryKey: ['cash-operational-log'] }),
    queryClient.invalidateQueries({ queryKey: ['reports-operational'] }),
    queryClient.invalidateQueries({ queryKey: ['daily-closures'] }),
  ]);
}
