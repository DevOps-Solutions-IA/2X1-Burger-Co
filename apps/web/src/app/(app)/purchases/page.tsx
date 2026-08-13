'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, Search, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import { FilterBar, MetricSurface, PageHeader, QueryState, StatusBadge } from '@/components/product';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate, matchesSearch } from '@/lib/format';

type PurchaseItemState = {
  targetType: 'ingredient' | 'product';
  targetId: string;
  quantity: string;
  unitCost: string;
};

type PurchaseCatalogItem = {
  id: string;
  name: string;
};

type Supplier = PurchaseCatalogItem & {
  isActive: boolean;
};

type PaymentMethod = PurchaseCatalogItem;

type PurchaseLine = {
  id: string;
  quantity: number | string;
  unitCost: number | string;
  totalCost: number | string;
  lotNumber: string | null;
  ingredient: PurchaseCatalogItem | null;
  product: PurchaseCatalogItem | null;
};

type Purchase = {
  id: string;
  number: string;
  purchasedAt: string;
  invoiceNumber: string | null;
  notes: string | null;
  total: number | string;
  supplier: Supplier;
  paymentMethod: PaymentMethod | null;
  items: PurchaseLine[];
};

function createEmptyLine(): PurchaseItemState {
  return { targetType: 'ingredient', targetId: '', quantity: '1', unitCost: '0' };
}

function getPurchaseLineError(item: PurchaseItemState) {
  if (!item.targetId) {
    return 'Selecciona el ítem de la línea.';
  }

  if (Number(item.quantity) <= 0) {
    return 'La cantidad debe ser mayor a cero.';
  }

  if (Number(item.unitCost) <= 0) {
    return 'El costo unitario debe ser mayor a cero.';
  }

  return null;
}

export default function PurchasesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [useTempProvider, setUseTempProvider] = useState(false);
  const [tempProviderName, setTempProviderName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseItemState[]>([createEmptyLine()]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [focusedNumFields, setFocusedNumFields] = useState<Set<string>>(new Set());

  const purchases = useQuery({
    queryKey: ['purchases'],
    queryFn: () => apiFetch<Purchase[]>('/purchases'),
  });
  const purchaseDetail = useQuery({
    queryKey: ['purchase-detail', selectedPurchaseId],
    queryFn: () => apiFetch<Purchase>(`/purchases/${selectedPurchaseId}`),
    enabled: Boolean(selectedPurchaseId),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<Supplier[]>('/suppliers'),
  });
  const activeSuppliers = useMemo(
    () => (suppliers.data ?? []).filter((supplier) => supplier.isActive),
    [suppliers.data],
  );
  const ingredients = useQuery({
    queryKey: ['ingredients'],
    queryFn: () => apiFetch<PurchaseCatalogItem[]>('/ingredients'),
  });
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<PurchaseCatalogItem[]>('/products'),
  });
  const paymentMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => apiFetch<PaymentMethod[]>('/payment-methods'),
  });
  const purchaseSourcesReady =
    suppliers.isSuccess && ingredients.isSuccess && products.isSuccess && paymentMethods.isSuccess;
  const dependencyError = suppliers.error ?? ingredients.error ?? products.error ?? paymentMethods.error;

  useEffect(() => {
    const firstPurchase = purchases.data?.[0];
    if (!selectedPurchaseId && firstPurchase) {
      setSelectedPurchaseId(firstPurchase.id);
    }
  }, [purchases.data, selectedPurchaseId]);

  const filteredPurchases = useMemo(
    () =>
      (purchases.data ?? []).filter((purchase) =>
        matchesSearch([purchase.number, purchase.invoiceNumber, purchase.supplier?.name], search),
      ),
    [purchases.data, search],
  );

  const computedTotal = items.reduce(
    (acc, item) => acc + Number(item.quantity || 0) * Number(item.unitCost || 0),
    0,
  );

  const lineErrors = useMemo(
    () =>
      items.map((item) => {
        if (!submitAttempted) {
          return null;
        }

        return getPurchaseLineError(item);
      }),
    [items, submitAttempted],
  );

  const providerMissing = submitAttempted && !supplierId && !(useTempProvider && tempProviderName.trim());
  const formErrors = {
    supplierId: providerMissing ? 'Selecciona o ingresa un proveedor.' : null,
    lines:
      submitAttempted && lineErrors.some(Boolean)
        ? 'Corrige las líneas marcadas antes de confirmar.'
        : null,
  };

  const createPurchase = useMutation({
    mutationFn: () => {
      if (!purchaseSourcesReady) {
        return Promise.reject(new Error('No se puede registrar la compra sin verificar los catálogos requeridos.'));
      }

      return apiFetch<Purchase>('/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: useTempProvider ? undefined : supplierId,
          tempProviderName: useTempProvider ? tempProviderName.trim() : undefined,
          invoiceNumber,
          paymentMethodId: paymentMethodId || undefined,
          notes,
          items: items.map((item) => ({
            quantity: Number(item.quantity),
            unitCost: Number(item.unitCost),
            ...(item.targetType === 'ingredient'
              ? { ingredientId: item.targetId }
              : { productId: item.targetId }),
          })),
        }),
      });
    },
    onSuccess: async (purchase) => {
      toast.success('Compra registrada y stock actualizado');
      setSupplierId('');
      setUseTempProvider(false);
      setTempProviderName('');
      setInvoiceNumber('');
      setPaymentMethodId('');
      setNotes('');
      setItems([createEmptyLine()]);
      setSubmitAttempted(false);
      setSelectedPurchaseId(purchase.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchases'] }),
        queryClient.invalidateQueries({ queryKey: ['ingredients'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-report'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-daily-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['reports-operational'] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos registrar la compra. Revisa los datos e intenta de nuevo.'),
  });

  const submitPurchase = () => {
    setSubmitAttempted(true);
    const hasLineErrors = items.some((item) => Boolean(getPurchaseLineError(item)));

    if (!purchaseSourcesReady) {
      toast.error('Reintenta los catálogos requeridos antes de registrar la compra.');
      return;
    }

    if (providerMissing || hasLineErrors) {
      toast.error('Completa proveedor, cantidades, costos y líneas antes de confirmar.');
      return;
    }

    createPurchase.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Abastecimiento"
        title="Compras"
        description="Registra compras verificadas, su impacto en inventario y la evidencia comercial asociada."
        status={purchases.data
          ? <StatusBadge status="COMPLETED" label={`${purchases.data.length} registradas`} tone="info" />
          : <StatusBadge status="UNKNOWN" label="Historial sin verificar" />}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricSurface density="compact" label="Registradas" value={purchases.data ? String(purchases.data.length) : undefined} context="Historial disponible" icon={<Truck className="h-5 w-5" />} unavailable={!purchases.data} />
        <MetricSurface density="compact" label="Líneas en edición" value={String(items.length)} context="Borrador local actual" icon={<Boxes className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Total proyectado" value={formatCurrency(computedTotal)} context={supplierId || (useTempProvider && tempProviderName.trim()) ? 'Proveedor listo' : 'Proveedor pendiente'} icon={<Plus className="h-5 w-5" />} />
      </div>

      {dependencyError ? (
        <StatusBanner
          tone="danger"
          title="El formulario de compra no tiene todos sus catálogos disponibles"
          description="Proveedores, productos, insumos o métodos de pago no pudieron verificarse. No se habilitan valores estimados."
          action={<Button type="button" variant="secondary" onClick={() => { void Promise.all([suppliers.refetch(), ingredients.refetch(), products.refetch(), paymentMethods.refetch()]); }}>Reintentar catálogos</Button>}
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <div className="space-y-5">
          <Card data-testid="purchase-form">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Nueva compra</h2>
                <p className="mt-0.5 text-[12px] text-stone-600">Cada linea genera un movimiento de inventario al confirmar.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" data-testid="purchase-add-row" onClick={() => setItems((current) => [...current, createEmptyLine()])}>
                <Plus className="mr-1.5 h-4 w-4" />
                Agregar linea
              </Button>
            </div>

            <form className="mt-5 space-y-5" onSubmit={(event) => { event.preventDefault(); submitPurchase(); }}>
              {/* Section A: Datos de compra */}
              <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
                <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.12em] text-stone-600">Datos de compra</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {!useTempProvider ? (
                    <div className="space-y-2">
                      <Field label="Proveedor" error={formErrors.supplierId} required>
                        <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} data-testid="purchase-supplier">
                          <option value="">Selecciona proveedor guardado</option>
                          {activeSuppliers.map((supplier) => (<option key={supplier.id} value={supplier.id}>{supplier.name}</option>))}
                        </Select>
                      </Field>
                      <button type="button" className="inline-flex min-h-11 min-w-11 items-center rounded-lg px-2 text-[12px] font-semibold text-stone-600 underline underline-offset-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={() => { setUseTempProvider(true); setSupplierId(''); }} data-testid="purchase-temp-provider-toggle">
                        Usar proveedor no registrado
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Field label="Proveedor" error={formErrors.supplierId} required>
                        <Input value={tempProviderName} onChange={(event) => setTempProviderName(event.target.value)} placeholder="Ej. Don Carlos - Carnes del Valle" data-testid="purchase-temp-provider-name" />
                      </Field>
                      <div className="flex items-center gap-2">
                        <button type="button" className="inline-flex min-h-11 min-w-11 items-center rounded-lg px-2 text-[12px] font-semibold text-stone-600 underline underline-offset-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={() => { setUseTempProvider(false); setTempProviderName(''); }} data-testid="purchase-saved-provider-toggle">
                          Usar proveedor guardado
                        </button>
                        <span className="text-[12px] text-stone-600">Solo para esta compra</span>
                      </div>
                    </div>
                  )}
                  <Field label="Factura / referencia" hint="Opcional">
                    <Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Ej. FAC-2026-031" data-testid="purchase-invoice" />
                  </Field>
                  <Field label="Método de pago" hint="Clasifica caja física o recaudo digital">
                    <Select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)} data-testid="purchase-payment-method">
                      <option value="">Sin método por ahora</option>
                      {paymentMethods.data?.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>

              {/* Section B: Lineas */}
              <div>
                <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-stone-600">{items.length} linea{items.length !== 1 ? 's' : ''}</p>
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const lineSubtotal = Number(item.quantity || 0) * Number(item.unitCost || 0);
                    return (
                    <div key={`${index}-${item.targetType}`} className={`rounded-xl border ${lineErrors[index] ? 'border-red-300 bg-red-50/70' : 'border-stone-200 bg-white'}`} data-testid="purchase-line-card">
                      {/* Header bar */}
                      <div className={`flex items-center justify-between gap-3 px-3.5 py-2 ${lineErrors[index] ? 'border-b border-red-200' : 'border-b border-stone-100'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-stone-600">Linea {index + 1}</span>
                          <span className="text-[12px] font-semibold text-stone-600">{item.targetType === 'ingredient' ? 'Insumo' : 'Producto'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {lineErrors[index] ? <span className="text-[12px] font-bold text-red-700">Incompleta</span> : null}
                          {items.length > 1 ? (
                            <button type="button" aria-label={`Eliminar línea ${index + 1}`} className="flex h-11 w-11 items-center justify-center rounded-xl text-stone-600 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={() => setItems((c) => c.filter((_, i) => i !== index))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {/* Fields — single 4-col grid, full width */}
                      <div className="p-3.5">
                        <div className="grid gap-3 lg:grid-cols-[minmax(104px,0.8fr)_minmax(220px,2.2fr)_minmax(96px,0.7fr)_minmax(140px,1fr)]">
                          <Field label="Tipo">
                            <Select value={item.targetType} onChange={(event) => setItems((c) => c.map((e, i) => i === index ? { ...e, targetType: event.target.value as PurchaseItemState['targetType'], targetId: '' } : e))}>
                              <option value="ingredient">Insumo</option>
                              <option value="product">Producto</option>
                            </Select>
                          </Field>
                          <Field label="Item" error={lineErrors[index]} required>
                            <Select value={item.targetId} onChange={(event) => setItems((c) => c.map((e, i) => i === index ? { ...e, targetId: event.target.value } : e))}>
                              <option value="">Selecciona</option>
                              {(item.targetType === 'ingredient' ? ingredients.data : products.data)?.map((target) => (<option key={target.id} value={target.id}>{target.name}</option>))}
                            </Select>
                          </Field>
                          <Field label="Cant.">
                            <Input type="number" data-nolz="true" value={focusedNumFields.has(`qty-${index}`) ? '' : (Number(item.quantity) || 0).toString()} onFocus={() => { setFocusedNumFields((s) => { const n = new Set(s); n.add(`qty-${index}`); return n; }); }} onBlur={(event) => { setFocusedNumFields((s) => { const n = new Set(s); n.delete(`qty-${index}`); return n; }); setItems((c) => c.map((e, i) => i === index ? { ...e, quantity: event.target.value || '0' } : e)); }} onChange={(event) => { const v = event.target.value.replace(/^0+(?=\d)/, ''); setItems((c) => c.map((e, i) => i === index ? { ...e, quantity: v } : e)); }} data-testid="purchase-line-quantity-input" />
                          </Field>
                          <Field label="Costo unit.">
                            <Input type="number" data-nolz="true" value={focusedNumFields.has(`cost-${index}`) ? '' : (Number(item.unitCost) || 0).toString()} onFocus={() => { setFocusedNumFields((s) => { const n = new Set(s); n.add(`cost-${index}`); return n; }); }} onBlur={(event) => { setFocusedNumFields((s) => { const n = new Set(s); n.delete(`cost-${index}`); return n; }); setItems((c) => c.map((e, i) => i === index ? { ...e, unitCost: event.target.value || '0' } : e)); }} onChange={(event) => { const v = event.target.value.replace(/^0+(?=\d)/, ''); setItems((c) => c.map((e, i) => i === index ? { ...e, unitCost: v } : e)); }} data-testid="purchase-line-unit-cost-input" />
                          </Field>
                        </div>
                      </div>

                      {/* Summary bar */}
                      <div className={`flex items-center justify-between gap-3 rounded-b-xl px-3.5 py-2 ${lineErrors[index] ? 'bg-red-100/40' : 'bg-stone-100/60'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-stone-600">Subtotal</span>
                          <span className="text-[13px] font-extrabold text-ink tabular-nums">{formatCurrency(lineSubtotal)}</span>
                        </div>
                        <span className="text-[12px] font-semibold text-stone-600">{item.targetType === 'ingredient' ? 'Aumenta insumo' : 'Aumenta producto'}</span>
                      </div>
                    </div>
                    );
                  })}
                </div>
                {formErrors.lines ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">{formErrors.lines}</p>
                ) : null}
              </div>

              {/* Section C: Observaciones */}
              <Field label="Observaciones" hint="Opcional.">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-[5rem]" placeholder="Novedades de entrega, soporte o diferencias." />
              </Field>

              {/* Section D: Total + Save */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-stone-600">Total proyectado</p>
                    <p className="mt-1 text-[1.5rem] font-black leading-none text-ink tabular-nums">{formatCurrency(computedTotal)}</p>
                    <p className="mt-1 text-[12px] font-semibold text-stone-600">{items.length} lineas &middot; {supplierId ? activeSuppliers.find((supplier) => supplier.id === supplierId)?.name ?? 'Proveedor' : useTempProvider && tempProviderName.trim() ? tempProviderName.trim() : 'Proveedor pendiente'}</p>
                  </div>
                  <Button data-testid="purchase-submit" type="submit" disabled={createPurchase.isPending || !purchaseSourcesReady} className="shrink-0">
                    {createPurchase.isPending ? 'Registrando...' : 'Guardar compra'}
                  </Button>
                </div>
              </div>
            </form>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="space-y-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Historial</h2>
                <p className="mt-0.5 text-[12px] text-stone-600">Selecciona una compra para ver su detalle.</p>
              </div>
              <FilterBar
                density="compact"
                activeCount={Number(Boolean(search.trim()))}
                search={<div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" /><Input aria-label="Buscar compras" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Número, factura o proveedor" className="pl-9" /></div>}
              />
            </div>
            <div className="hide-scrollbar list-scroll-5-rows divide-y divide-stone-100">
              <QueryState
                status={purchases.isLoading ? 'loading' : purchases.isError ? 'error' : filteredPurchases.length ? 'ready' : 'empty'}
                title={purchases.isError ? 'No se pudo cargar el historial' : 'Sin compras para esta búsqueda'}
                description={purchases.isError ? 'No se mostraron compras estimadas ni datos locales como reemplazo.' : 'Registra la primera compra o ajusta la búsqueda.'}
                onRetry={purchases.isError ? () => void purchases.refetch() : undefined}
                className="m-4"
              >
              {filteredPurchases.map((purchase) => (
                  <button
                    key={purchase.id}
                    type="button"
                    className={`grid w-full gap-3 border px-4 py-3 text-left transition md:grid-cols-[0.7fr_1fr_0.4fr_0.55fr] rounded-xl ${selectedPurchaseId === purchase.id ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200 shadow-sm border-l-[3px] border-l-brand-400' : 'border-transparent hover:bg-stone-50/50'}`}
                    onClick={() => setSelectedPurchaseId(purchase.id)}
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{formatDate(purchase.purchasedAt)}</p>
                      <p className="text-[12px] text-stone-600">{purchase.number}</p>
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{purchase.supplier.name}</p>
                      <p className="text-[12px] text-stone-600">
                        {purchase.invoiceNumber || 'Sin factura'} · {purchase.paymentMethod?.name ?? 'Sin método'}
                      </p>
                    </div>
                    <div className="text-[12px] text-stone-600">{purchase.items.length} ítems</div>
                    <div className="numeric-tabular whitespace-nowrap text-right text-[13px] font-semibold text-ink">{formatCurrency(purchase.total)}</div>
                  </button>
                ))}
              </QueryState>
            </div>
          </Card>
        </div>

          <Card className="xl:sticky xl:top-24 xl:self-start">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Detalle de compra</h2>
              <p className="mt-0.5 text-[12px] text-stone-600">Vista rapida del historial.</p>
            </div>
            {purchaseDetail.data ? <Badge tone="success">{purchaseDetail.data.items.length} lineas</Badge> : null}
          </div>

          <QueryState
            status={purchaseDetail.isLoading ? 'loading' : purchaseDetail.isError ? 'error' : purchaseDetail.data ? 'ready' : 'empty'}
            title={purchaseDetail.isError ? 'No se pudo cargar el detalle' : 'Selecciona una compra'}
            description={purchaseDetail.isError ? 'La compra no está disponible en este momento.' : 'Aquí verás proveedor, ítems y total.'}
            onRetry={purchaseDetail.isError ? () => void purchaseDetail.refetch() : undefined}
            className="mt-5"
          >
          {purchaseDetail.data ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5">
                <p className="text-[13px] font-extrabold text-ink">{purchaseDetail.data.supplier.name}</p>
                <p className="mt-0.5 text-[12px] text-stone-600">{purchaseDetail.data.number} &middot; {formatDate(purchaseDetail.data.purchasedAt)} &middot; {purchaseDetail.data.paymentMethod?.name ?? 'Sin método'}</p>
                <p className="mt-2 text-[12px] text-stone-600">
                  {purchaseDetail.data.notes || 'Sin notas registradas.'}
                </p>
              </div>
              {purchaseDetail.data.items.map((item) => (
                <div key={item.id} className="rounded-[1.2rem] border border-stone-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-ink">{item.ingredient?.name ?? item.product?.name}</p>
                      <p className="text-[12px] text-stone-600">
                        {item.ingredient ? 'Insumo' : 'Producto'} · {item.lotNumber || 'Sin lote'}
                      </p>
                    </div>
                    <div className="numeric-tabular text-right text-[12px]">
                      <p className="whitespace-nowrap font-semibold text-ink">{formatCurrency(item.totalCost)}</p>
                      <p className="text-stone-600">
                        {item.quantity} x {formatCurrency(item.unitCost)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              <div className="rounded-[1.55rem] border border-brand-200 bg-brand-50 p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-900">Total de la compra</p>
                <p className="numeric-tabular mt-2 whitespace-nowrap text-[1.58rem] font-bold leading-none text-ink">{formatCurrency(purchaseDetail.data.total)}</p>
              </div>
            </div>
          ) : null}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
