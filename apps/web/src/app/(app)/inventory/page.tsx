'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Boxes, ClipboardCheck, PackagePlus, ShieldAlert, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionTitle } from '@/components/ui/section-title';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ConfirmDialog } from '@/components/confirm-dialog';

type StockStatus = 'NORMAL' | 'LOW' | 'CRITICAL' | 'OUT_OF_STOCK';
type InventoryItemType = 'PRODUCT' | 'INGREDIENT';
type StockCountScope = 'CRITICAL' | 'ALL' | 'PRODUCTS' | 'INGREDIENTS';
type InventoryMovementType =
  | 'INITIAL'
  | 'PURCHASE'
  | 'SALE'
  | 'ADJUSTMENT'
  | 'WASTE'
  | 'DAMAGE'
  | 'RETURN'
  | 'INTERNAL_USE'
  | 'RECIPE_CONSUMPTION';

type InventoryStockItem = {
  id: string;
  itemType: InventoryItemType;
  code: string;
  name: string;
  categoryName: string;
  unitName: string;
  unitCode: string;
  currentStock: number;
  stockMin: number | null;
  stockMax: number | null;
  status: StockStatus;
  updatedAt: string;
};

type InventoryStockResponse = {
  metrics: {
    totalItems: number;
    productsCount: number;
    ingredientsCount: number;
    lowStockCount: number;
    criticalStockCount: number;
    outOfStockCount: number;
    adjustmentsToday: number;
  };
  items: InventoryStockItem[];
};

type InventoryMovement = {
  id: string;
  type: InventoryMovementType;
  quantity: number | string;
  balanceAfter: number | string | null;
  referenceType: string | null;
  occurredAt: string;
  product: { name: string } | null;
  ingredient: { name: string } | null;
  performedBy: { fullName: string } | null;
};

type ReorderAlert = {
  id: string;
  itemType: InventoryItemType;
  name: string;
  code: string;
  unitCode: string;
  currentStock: number;
  stockMin: number;
  avgDailyConsumption: number;
  daysOfCoverage: number | null;
  suggestedQuantity: number;
  severity: StockStatus;
  supplier: { id: string; name: string; phone: string | null } | null;
};

type ReorderSuggestionsResponse = {
  alerts: ReorderAlert[];
  groupedBySupplier: Array<{
    supplierId: string | null;
    supplierName: string;
    supplierPhone: string | null;
    items: ReorderAlert[];
  }>;
};

type StockCountPreviewItem = {
  id: string;
  itemType: InventoryItemType;
  code: string;
  name: string;
  unitCode: string;
  expectedStock: number;
  stockMin: number | null;
  status: StockStatus;
};

type StockCountPreviewResponse = {
  scope: StockCountScope;
  items: StockCountPreviewItem[];
};

type StockCountSession = {
  id: string;
  scope: StockCountScope;
  createdAt: string;
  items: Array<{ id: string }>;
};

const quickAdjustments = [
  { label: 'Merma', movementType: 'WASTE', quantity: -1 },
  { label: 'Daño', movementType: 'DAMAGE', quantity: -1 },
  { label: 'Uso interno', movementType: 'INTERNAL_USE', quantity: -1 },
];

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const today = new Date().toISOString().slice(0, 10);
  const [search, setSearch] = useState('');
  const [itemType, setItemType] = useState<'ALL' | InventoryItemType>('ALL');
  const [status, setStatus] = useState<'ALL' | StockStatus>('ALL');
  const [movementSearch, setMovementSearch] = useState('');
  const [movementType, setMovementType] = useState<'ALL' | string>('ALL');
  const [scope, setScope] = useState<StockCountScope>('CRITICAL');
  const [countNotes, setCountNotes] = useState('');
  const [adjustmentItemType, setAdjustmentItemType] = useState<InventoryItemType>('INGREDIENT');
  const [adjustmentItemId, setAdjustmentItemId] = useState('');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('Regularización');
  const [adjustmentNotes, setAdjustmentNotes] = useState('');
  const [countValues, setCountValues] = useState<Record<string, string>>({});
  const [confirmDialog, setConfirmDialog] = useState<{ movementType: string; label: string } | null>(null);
  const editItemId = searchParams?.get('edit') ?? null;
  const editItemType = searchParams?.get('itemType') as InventoryItemType | null;

  const stock = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: () => apiFetch<InventoryStockResponse>('/inventory/stock'),
  });
  const movements = useQuery({
    queryKey: ['inventory-movements', movementSearch, movementType],
    queryFn: () => {
      const params = new URLSearchParams();
      if (movementSearch.trim()) params.set('search', movementSearch.trim());
      if (movementType !== 'ALL') params.set('type', movementType);
      params.set('from', today);
      params.set('to', today);
      params.set('limit', '120');
      return apiFetch<InventoryMovement[]>(`/inventory/movements?${params.toString()}`);
    },
  });
  const reorderSuggestions = useQuery({
    queryKey: ['inventory-reorder-suggestions'],
    queryFn: () => apiFetch<ReorderSuggestionsResponse>('/inventory/reorder-suggestions'),
  });
  const stockCountPreview = useQuery({
    queryKey: ['inventory-stock-count-preview', scope],
    queryFn: () => apiFetch<StockCountPreviewResponse>(`/inventory/stock-counts/preview?scope=${scope}`),
  });
  const stockCounts = useQuery({
    queryKey: ['inventory-stock-counts'],
    queryFn: () => apiFetch<StockCountSession[]>('/inventory/stock-counts'),
  });

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (stock.data?.items ?? []).filter((item) => {
      const matchesSearch = term
        ? [item.name, item.code, item.categoryName].some((value: string) => value.toLowerCase().includes(term))
        : true;
      const matchesType = itemType === 'ALL' ? true : item.itemType === itemType;
      const matchesStatus = status === 'ALL' ? true : item.status === status;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [stock.data?.items, search, itemType, status]);

  const adjustmentOptions = useMemo(
    () => (stock.data?.items ?? []).filter((item) => item.itemType === adjustmentItemType),
    [stock.data?.items, adjustmentItemType],
  );

  const selectedAdjustmentItem = useMemo(
    () => adjustmentOptions.find((item) => item.id === adjustmentItemId) ?? null,
    [adjustmentOptions, adjustmentItemId],
  );
  const adjustmentQuantityNum = Number(adjustmentQuantity);
  const isAdjustmentQuantityValid = !Number.isNaN(adjustmentQuantityNum) && adjustmentQuantityNum > 0;

  const createAdjustment = useMutation<unknown, Error, string>({
    mutationFn: (movementTypeValue = 'ADJUSTMENT') =>
      apiFetch('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          ...(adjustmentItemType === 'PRODUCT' ? { productId: adjustmentItemId } : { ingredientId: adjustmentItemId }),
          quantity: Number(adjustmentQuantity),
          reason: adjustmentReason,
          notes: adjustmentNotes || undefined,
          movementType: movementTypeValue,
        }),
      }),
    onSuccess: async () => {
      toast.success('Inventario actualizado');
      setAdjustmentQuantity('');
      setAdjustmentNotes('');
      await invalidateInventory(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No pudimos actualizar el inventario.'),
  });

  const registerStockCount = useMutation({
    mutationFn: () =>
      apiFetch('/inventory/stock-counts', {
        method: 'POST',
        body: JSON.stringify({
          scope,
          notes: countNotes || undefined,
          items: (stockCountPreview.data?.items ?? []).map((item) => ({
            itemType: item.itemType,
            itemId: item.id,
            countedStock: Number(countValues[item.id] ?? item.expectedStock ?? 0),
            reason: 'Conteo',
          })),
        }),
      }),
    onSuccess: async () => {
      toast.success('Conteo guardado y diferencias aplicadas');
      setCountNotes('');
      setCountValues({});
      await invalidateInventory(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No pudimos guardar el conteo físico.'),
  });

  const criticalAlerts = useMemo(
    () => (reorderSuggestions.data?.alerts ?? []).filter((item) => item.severity === 'CRITICAL' || item.severity === 'OUT_OF_STOCK').slice(0, 4),
    [reorderSuggestions.data?.alerts],
  );
  const pageError =
    stock.error ??
    movements.error ??
    reorderSuggestions.error ??
    stockCountPreview.error ??
    stockCounts.error;

  useEffect(() => {
    if (!editItemId || !editItemType || !(stock.data?.items?.length)) {
      return;
    }

    const validType = editItemType === 'PRODUCT' || editItemType === 'INGREDIENT' ? editItemType : null;
    if (!validType) {
      return;
    }

    const target = (stock.data?.items ?? []).find(
      (item) => item.id === editItemId && item.itemType === validType,
    );

    if (!target) {
      return;
    }

    setAdjustmentItemType(validType);
    setAdjustmentItemId(target.id);
    setSearch(target.name);
    setItemType(validType);
    setStatus('ALL');
  }, [editItemId, editItemType, stock.data?.items]);

  return (
    <div className="space-y-6 p-6 lg:p-8" data-testid="inventory-page">
      <SectionTitle
        eyebrow="Inventario"
        title="Inventario — Lo que entra y sale"
        description="Controlá stock, movimientos y ajustes sin salir del ritmo."
        status={
          <Badge tone={(stock.data?.metrics.criticalStockCount ?? 0) + (stock.data?.metrics.outOfStockCount ?? 0) > 0 ? 'warning' : 'success'}>
            {(stock.data?.metrics.lowStockCount ?? 0) + (stock.data?.metrics.criticalStockCount ?? 0) + (stock.data?.metrics.outOfStockCount ?? 0)} alertas
          </Badge>
        }
      />

      {criticalAlerts.length ? (
        <StatusBanner
          tone="warning"
          title="Tienes productos agotados. Revisa ya."
          description={`${criticalAlerts.length} ítems necesitan reposición inmediata.`}
        />
      ) : null}

      {pageError ? (
        <StatusBanner
          tone="danger"
          title="No pudimos cargar toda la operación de inventario"
          description={pageError instanceof Error ? pageError.message : 'Recarga la página e intenta de nuevo.'}
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard compact label="Ítems con stock" value={formatNumber(stock.data?.metrics.totalItems ?? 0)} hint="Productos e insumos activos" icon={<Boxes className="h-5 w-5" />} />
        <MetricCard compact label="Productos" value={formatNumber(stock.data?.metrics.productsCount ?? 0)} hint="Venta directa con inventario" icon={<PackagePlus className="h-5 w-5" />} accent="ink" />
        <MetricCard compact label="Insumos" value={formatNumber(stock.data?.metrics.ingredientsCount ?? 0)} hint="Materia prima y consumibles" icon={<Boxes className="h-5 w-5" />} accent="brand" />
        <MetricCard compact label="Bajo stock" value={formatNumber(stock.data?.metrics.lowStockCount ?? 0)} hint="Aún operables" icon={<TriangleAlert className="h-5 w-5" />} accent="brand" />
        <MetricCard compact label="Críticos" value={formatNumber(stock.data?.metrics.criticalStockCount ?? 0)} hint="Riesgo inmediato" icon={<ShieldAlert className="h-5 w-5" />} accent="danger" />
        <MetricCard compact label="Ajustes hoy" value={formatNumber(stock.data?.metrics.adjustmentsToday ?? 0)} hint="Movimientos manuales" icon={<ClipboardCheck className="h-5 w-5" />} accent="ink" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.7fr_0.3fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">Ajuste rápido</h2>
              <p className="mt-1 text-[13px] leading-6 text-stone-500">Registra conteos, mermas, daños o regularizaciones con trazabilidad completa.</p>
            </div>
            <Badge tone="default">{selectedAdjustmentItem ? 'Ítem listo' : 'Sin seleccionar'}</Badge>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-[0.72fr_1.18fr_0.68fr_0.9fr]">
            <Field label="Tipo de ítem">
              <Select aria-label="Tipo de ítem para ajustar" value={adjustmentItemType} onChange={(event) => setAdjustmentItemType(event.target.value as InventoryItemType)}>
                <option value="INGREDIENT">Insumo</option>
                <option value="PRODUCT">Producto</option>
              </Select>
            </Field>
            <Field label="Ítem">
              <Select aria-label="Ítem para ajustar" value={adjustmentItemId} onChange={(event) => setAdjustmentItemId(event.target.value)}>
                <option value="">Selecciona</option>
                {adjustmentOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cantidad">
              <Input type="number" value={adjustmentQuantity} onChange={(event) => setAdjustmentQuantity(event.target.value)} />
              {adjustmentQuantity && !isAdjustmentQuantityValid ? (
                <p className="mt-1.5 text-[12px] leading-5 text-red-600">
                  La cantidad debe ser mayor a 0.
                </p>
              ) : null}
            </Field>
            <Field label="Motivo">
              <Input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Observaciones">
              <Textarea value={adjustmentNotes} onChange={(event) => setAdjustmentNotes(event.target.value)} className="min-h-24" />
            </Field>
          </div>
          {selectedAdjustmentItem ? (
            <div className="mt-4 rounded-[1.35rem] border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
              Stock actual: <span className="font-semibold text-ink">{selectedAdjustmentItem.currentStock}</span> · mínimo:{' '}
              <span className="font-semibold text-ink">{selectedAdjustmentItem.stockMin ?? 'N/A'}</span>
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {quickAdjustments.map((quick) => (
                <Button
                  key={quick.label}
                  variant="secondary"
                  disabled={!adjustmentItemId || createAdjustment.isPending}
                  onClick={() => {
                    setConfirmDialog({ movementType: quick.movementType, label: quick.label });
                  }}
                >
                  {quick.label}
                </Button>
              ))}
            </div>
            <Button disabled={!adjustmentItemId || !isAdjustmentQuantityValid || createAdjustment.isPending} onClick={() => createAdjustment.mutate('ADJUSTMENT')}>
              Aplicar ajuste
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold lg:text-[1.12rem]">¡Atención! Stock crítico</h2>
          <div className="mt-4 space-y-2">
            {criticalAlerts.length ? criticalAlerts.map((item) => (
              <Link
                key={`${item.itemType}-${item.id}`}
                href={`/inventory?edit=${item.id}&itemType=${item.itemType ?? 'PRODUCT'}`}
                className="block rounded-2xl border transition hover:shadow-soft hover:-translate-y-0.5"
                style={{
                  borderLeftWidth: '4px',
                  borderLeftColor: item.severity === 'OUT_OF_STOCK' ? '#dc2626' : '#f59e0b',
                }}
              >
                <div className="flex items-center justify-between gap-2 rounded-2xl bg-stone-50 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink">{item.name}</p>
                    <p className="mt-0.5 truncate text-[12px] text-stone-500">
                      Stock: {item.currentStock} {item.unitCode ?? ''} · {item.daysOfCoverage ? `${item.daysOfCoverage.toFixed(1)} días` : 'sin dato'}
                    </p>
                  </div>
                  <Badge tone={item.severity === 'OUT_OF_STOCK' ? 'danger' : 'warning'} className="shrink-0">
                    {translateStockStatus(item.severity)}
                  </Badge>
                </div>
              </Link>
            )) : <EmptyState title="Nada crítico hoy" description="No hay productos agotados ni en nivel crítico. Todo en orden." />}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold lg:text-[1.12rem]">Resumen de stock</h2>
            <p className="mt-1 text-[13px] leading-6 text-stone-500">Click en cualquier ítem para ir directo a ajustarlo.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ítem" />
            <Select aria-label="Filtrar resumen por tipo de ítem" value={itemType} onChange={(event) => setItemType(event.target.value as typeof itemType)}>
              <option value="ALL">Todos</option>
              <option value="PRODUCT">Productos</option>
              <option value="INGREDIENT">Insumos</option>
            </Select>
            <Select aria-label="Filtrar resumen por estado de stock" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="ALL">Todos los estados</option>
              <option value="LOW">Bajo</option>
              <option value="CRITICAL">Crítico</option>
              <option value="OUT_OF_STOCK">Agotado</option>
            </Select>
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded-[1.35rem] border border-stone-200">
          <div className="hidden border-b border-stone-200 bg-stone-50 px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-stone-500 md:grid md:grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_0.6fr] md:gap-3">
            <span>Ítem</span>
            <span>Tipo</span>
            <span className="text-right">Stock</span>
            <span className="text-right">Mínimo</span>
            <span className="text-right">Estado</span>
          </div>
          <div
            className="hide-scrollbar list-scroll-5-rows"
            role="region"
            aria-label="Resumen de existencias"
            tabIndex={0}
          >
            {stock.isLoading ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="m-3 h-16 rounded-2xl" />) : null}
            {!stock.isLoading && !filteredItems.length ? (
              <EmptyState title="Nada con ese filtro" description="Probá con otra búsqueda o ajustá los filtros." />
            ) : null}
            {!stock.isLoading && filteredItems.length ? filteredItems.map((item) => (
              <div key={item.id} className="border-b border-stone-100 px-4 py-4 text-sm">
                {/* Mobile: card layout */}
                <div className="md:hidden space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{item.name}</p>
                      <p className="text-[12px] text-stone-500">{item.code} · {item.categoryName}</p>
                    </div>
                    <Badge tone={item.status === 'OUT_OF_STOCK' ? 'danger' : item.status === 'CRITICAL' ? 'warning' : 'neutral'}>{translateStockStatus(item.status)}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-[13px]">
                    <span className="text-stone-500">{item.itemType === 'PRODUCT' ? 'Producto' : 'Insumo'}</span>
                    <span className="font-medium text-ink">Stock: {item.currentStock}</span>
                    <span className="text-stone-500">Mín: {item.stockMin ?? '—'}</span>
                  </div>
                </div>
                {/* Desktop: grid layout */}
                <div className="hidden md:grid md:grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_0.6fr] md:gap-3 md:items-center">
                  <div>
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-[12px] text-stone-500">{item.code} · {item.categoryName}</p>
                  </div>
                  <div className="text-stone-600">{item.itemType === 'PRODUCT' ? 'Producto' : 'Insumo'}</div>
                  <div className="text-right font-medium text-ink">{item.currentStock}</div>
                  <div className="text-right text-stone-600">{item.stockMin ?? '—'}</div>
                  <div className="text-right"><Badge tone={item.status === 'OUT_OF_STOCK' ? 'danger' : item.status === 'CRITICAL' ? 'warning' : 'neutral'}>{translateStockStatus(item.status)}</Badge></div>
                </div>
              </div>
            )) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">Conteo rápido</h2>
              <p className="mt-1 text-[13px] leading-6 text-stone-500">Contá y ajustá el stock real contra el sistema.</p>
            </div>
            <Select aria-label="Alcance del conteo de inventario" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
              <option value="CRITICAL">Críticos</option>
              <option value="ALL">Todo</option>
              <option value="PRODUCTS">Solo productos</option>
              <option value="INGREDIENTS">Solo insumos</option>
            </Select>
          </div>
          <div className="mt-4">
            <Field label="Notas del conteo">
              <Input value={countNotes} onChange={(event) => setCountNotes(event.target.value)} placeholder="Turno, responsable, novedad..." />
            </Field>
          </div>
          <div className="hide-scrollbar list-scroll-5-cards mt-4 space-y-3 pr-1">
            {stockCountPreview.isLoading ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />) : null}
            {(stockCountPreview.data?.items ?? []).map((item) => (
              <div key={item.id} className="grid gap-3 rounded-[1.35rem] border border-stone-200 bg-stone-50 px-4 py-4 md:grid-cols-[1fr_0.5fr_0.5fr]">
                <div>
                  <p className="font-medium text-ink">{item.name}</p>
                  <p className="text-[12px] text-stone-500">{item.code} · esperado {item.expectedStock} {item.unitCode}</p>
                </div>
                <div className="text-sm text-stone-600">
                  <p className="text-[12px] uppercase tracking-[0.14em] text-stone-500">Estado</p>
                  <p className="mt-1">{translateStockStatus(item.status)}</p>
                </div>
                <Input
                  type="number"
                  value={countValues[item.id] ?? String(item.expectedStock)}
                  onChange={(event) => setCountValues((current) => ({ ...current, [item.id]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button disabled={registerStockCount.isPending || !(stockCountPreview.data?.items ?? []).length} onClick={() => registerStockCount.mutate()}>
              {registerStockCount.isPending ? 'Aplicando...' : 'Guardar conteo'}
            </Button>
          </div>
        </Card>

        <Card className="h-full overflow-hidden p-0">
          <div className="border-b border-stone-100 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold lg:text-[1.12rem]">Historial</h2>
                <p className="mt-1 text-[13px] leading-6 text-stone-500">Conteos anteriores y sus resultados.</p>
              </div>
              <Badge tone="default">{stockCounts.data?.length ?? 0}</Badge>
            </div>
          </div>
          <div
            className="hide-scrollbar list-scroll-5-compact space-y-3 px-4 py-4 pr-3"
            role="region"
            aria-label="Historial de conteos de inventario"
            tabIndex={0}
          >
            {stockCounts.isLoading ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />) : null}
            {!stockCounts.isLoading && stockCounts.data?.length ? stockCounts.data.map((session) => (
              <div key={session.id} className="rounded-[1.35rem] border border-stone-200 bg-stone-50 px-4 py-4">
                <p className="font-medium text-ink">{translateScope(session.scope)}</p>
                <p className="mt-1 text-[12px] text-stone-500">
                  {session.items.length} líneas · {formatDateTime(session.createdAt)}
                </p>
              </div>
            )) : <EmptyState title="Sin conteos" description="Cuando registres un conteo, lo vas a ver acá." />}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">Movimientos</h2>
              <p className="mt-1 text-[13px] leading-6 text-stone-500">Entradas, salidas y ajustes del día con trazabilidad de responsable y saldo.</p>
            </div>
            <Badge tone="default">{movements.data?.length ?? 0}</Badge>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <Input value={movementSearch} onChange={(event) => setMovementSearch(event.target.value)} placeholder="Buscar movimiento" />
            <Select aria-label="Filtrar movimientos por tipo" value={movementType} onChange={(event) => setMovementType(event.target.value)}>
              <option value="ALL">Todos</option>
              <option value="PURCHASE">Compra</option>
              <option value="SALE">Venta</option>
              <option value="ADJUSTMENT">Ajuste</option>
              <option value="WASTE">Merma</option>
              <option value="DAMAGE">Daño</option>
              <option value="INTERNAL_USE">Uso interno</option>
            </Select>
          </div>
          <div
            className="hide-scrollbar list-scroll-5-rows mt-4 overflow-auto rounded-[1.35rem] border border-stone-200"
            role="region"
            aria-label="Movimientos de inventario"
            tabIndex={0}
          >
            <div className="hidden min-w-[760px] grid-cols-[1.2fr_0.7fr_0.7fr_0.8fr] gap-4 border-b border-stone-100 bg-stone-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 md:grid">
              <span>Item</span>
              <span>Cantidad / saldo</span>
              <span>Responsable</span>
              <span className="text-right">Fecha</span>
            </div>
            <div className="divide-y divide-stone-100">
              {movements.isLoading ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="m-4 h-20 rounded-2xl" />) : null}
              {!movements.isLoading && (movements.data ?? []).map((movement) => {
                const movementTone = getMovementTone(movement.type);
                return (
                <div key={movement.id} className={`border-l-[3px] px-4 py-4 text-sm ${movementTone.border}`}>
                  <div className="md:hidden">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{movement.product?.name ?? movement.ingredient?.name}</p>
                        <p className="mt-1 text-[12px] text-stone-500">{movement.referenceType || movement.type}</p>
                      </div>
                      <Badge tone={movementTone.tone}>{Number(movement.quantity)}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 rounded-2xl bg-stone-50 p-3 text-[12px] text-stone-600">
                      <div className="flex items-center justify-between gap-3">
                        <span>Saldo</span>
                        <span className="font-semibold text-ink">{movement.balanceAfter ?? '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Responsable</span>
                        <span className="text-right font-semibold text-ink">{movement.performedBy?.fullName ?? 'Sistema'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Fecha</span>
                        <span className="text-right font-semibold text-ink">{formatDateTime(movement.occurredAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="hidden grid-cols-[1.2fr_0.7fr_0.7fr_0.8fr] gap-4 md:grid">
                    <div>
                      <p className="font-medium text-ink">{movement.product?.name ?? movement.ingredient?.name}</p>
                      <p className="text-[12px] text-stone-500">{movement.referenceType || movement.type}</p>
                    </div>
                    <div><Badge tone={movementTone.tone}>{Number(movement.quantity)} / saldo {movement.balanceAfter ?? '—'}</Badge></div>
                    <div className="text-stone-600">{movement.performedBy?.fullName ?? 'Sistema'}</div>
                    <div className="text-right text-stone-500">{formatDateTime(movement.occurredAt)}</div>
                  </div>
                </div>
                );
              })}
              {!movements.isLoading && !(movements.data ?? []).length ? (
                <div className="p-6">
                  <EmptyState title="Sin movimientos todavía" description="Cuando haya entradas o salidas de stock, las vas a ver acá." />
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className="h-full overflow-hidden p-0">
          <div className="border-b border-stone-100 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold lg:text-[1.12rem]">Compra sugerida</h2>
                <p className="mt-1 text-[13px] leading-6 text-stone-500">Basado en tu consumo real. Lo que necesitás reponer.</p>
              </div>
              <Badge tone="default">{reorderSuggestions.data?.alerts?.length ?? 0}</Badge>
            </div>
          </div>
          <div
            className="hide-scrollbar list-scroll-5-compact space-y-2 px-4 py-4 pr-3"
            role="region"
            aria-label="Compra sugerida de inventario"
            tabIndex={0}
          >
            {reorderSuggestions.isLoading ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />) : null}
            {(reorderSuggestions.data?.alerts ?? []).map((item) => (
              <Link
                key={`${item.itemType}-${item.id}`}
                href={`/inventory?edit=${item.id}&itemType=${item.itemType ?? 'PRODUCT'}`}
                className="block rounded-2xl border transition hover:shadow-soft hover:-translate-y-0.5"
                style={{
                  borderLeftWidth: '4px',
                  borderLeftColor: item.severity === 'OUT_OF_STOCK' ? '#dc2626' : item.severity === 'CRITICAL' ? '#f59e0b' : '#d4d4d4',
                }}
              >
                <div className="rounded-2xl bg-stone-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-ink">{item.name}</p>
                      <p className="mt-1 text-[12px] text-stone-500">
                        Stock {item.currentStock} · sugerido {item.suggestedQuantity} {item.unitCode} · {item.daysOfCoverage ? `${item.daysOfCoverage.toFixed(0)}d` : '—'}
                      </p>
                    </div>
                    <Badge tone={item.severity === 'OUT_OF_STOCK' ? 'danger' : item.severity === 'CRITICAL' ? 'warning' : 'neutral'} className="shrink-0">
                      {translateStockStatus(item.severity)}
                  </Badge>
                </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
      {confirmDialog ? (
        <ConfirmDialog
          open
          title={confirmDialog.label}
          message={`Se va a registrar un ajuste negativo (${confirmDialog.label.toLowerCase()}) para ${selectedAdjustmentItem?.name ?? 'el item seleccionado'}. Esta accion reduce el inventario y queda registrada en la trazabilidad.`}
          confirmLabel="Confirmar ajuste"
          cancelLabel="Cancelar"
          destructive
          onConfirm={() => {
            createAdjustment.mutate(confirmDialog.movementType);
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      ) : null}
    </div>
  );
}

function translateStockStatus(status: string) {
  const labels: Record<string, string> = {
    NORMAL: 'Normal',
    LOW: 'Bajo',
    CRITICAL: 'Crítico',
    OUT_OF_STOCK: 'Agotado',
  };
  return labels[status] ?? status;
}

function translateScope(scope: string) {
  const labels: Record<string, string> = {
    CRITICAL: 'Crítico',
    ALL: 'General',
    PRODUCTS: 'Productos',
    INGREDIENTS: 'Insumos',
  };
  return labels[scope] ?? scope;
}

async function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['inventory-stock'] }),
    queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
    queryClient.invalidateQueries({ queryKey: ['inventory-reorder-suggestions'] }),
    queryClient.invalidateQueries({ queryKey: ['inventory-stock-count-preview'] }),
    queryClient.invalidateQueries({ queryKey: ['inventory-stock-counts'] }),
    queryClient.invalidateQueries({ queryKey: ['reports-operational'] }),
  ]);
}

function getMovementTone(type: InventoryMovementType): { tone: 'success' | 'danger' | 'warning' | 'neutral'; border: string } {
  switch (type) {
    case 'PURCHASE':
    case 'INITIAL':
    case 'RETURN':
      return { tone: 'success', border: 'border-l-emerald-400' };
    case 'SALE':
    case 'RECIPE_CONSUMPTION':
      return { tone: 'danger', border: 'border-l-red-400' };
    case 'ADJUSTMENT':
    case 'WASTE':
    case 'DAMAGE':
    case 'INTERNAL_USE':
      return { tone: 'warning', border: 'border-l-amber-400' };
    default:
      return { tone: 'neutral', border: 'border-l-stone-300' };
  }
}
