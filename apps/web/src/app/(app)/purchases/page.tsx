'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, Search, Trash2, Truck } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate, matchesSearch } from '@/lib/format';

type PurchaseItemState = {
  targetType: 'ingredient' | 'product';
  targetId: string;
  quantity: string;
  unitCost: string;
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
    queryFn: () => apiFetch<any[]>('/purchases'),
  });
  const purchaseDetail = useQuery({
    queryKey: ['purchase-detail', selectedPurchaseId],
    queryFn: () => apiFetch<any>(`/purchases/${selectedPurchaseId}`),
    enabled: Boolean(selectedPurchaseId),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<any[]>('/suppliers'),
  });
  const activeSuppliers = useMemo(
    () => (suppliers.data ?? []).filter((supplier) => supplier.isActive),
    [suppliers.data],
  );
  const ingredients = useQuery({
    queryKey: ['ingredients'],
    queryFn: () => apiFetch<any[]>('/ingredients'),
  });
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<any[]>('/products'),
  });
  const paymentMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => apiFetch<any[]>('/payment-methods'),
  });

  useEffect(() => {
    if (!selectedPurchaseId && purchases.data?.length) {
      setSelectedPurchaseId(purchases.data[0].id);
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
    mutationFn: () =>
      apiFetch('/purchases', {
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
      }),
    onSuccess: async (purchase: any) => {
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

    if (providerMissing || hasLineErrors) {
      toast.error('Completa proveedor, cantidades, costos y líneas antes de confirmar.');
      return;
    }

    createPurchase.mutate();
  };

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <SectionTitle
        eyebrow="Abastecimiento"
        title="Compras"
        description="Registra cada compra y repon stock al instante."
        status={<Badge tone="info">{purchases.data?.length ?? 0} registradas</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard compact label="Registradas" value={String((purchases.data ?? []).length)} hint="Historial" icon={<Truck className="h-5 w-5" />} accent="ink" />
        <MetricCard compact label="En edicion" value={String(items.length)} hint="Lineas activas" icon={<Boxes className="h-5 w-5" />} accent="success" />
        <MetricCard compact label="Total" value={formatCurrency(computedTotal)} hint={supplierId || (useTempProvider && tempProviderName.trim()) ? 'Proveedor listo' : 'Falta proveedor'} icon={<Plus className="h-5 w-5" />} accent={computedTotal > 0 ? 'warning' : 'ink'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <div className="space-y-5">
          <Card data-testid="purchase-form">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Nueva compra</h2>
                <p className="mt-0.5 text-[12px] text-stone-500">Cada linea genera un movimiento de inventario al confirmar.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" data-testid="purchase-add-row" onClick={() => setItems((current) => [...current, createEmptyLine()])}>
                <Plus className="mr-1.5 h-4 w-4" />
                Agregar linea
              </Button>
            </div>

            <form className="mt-5 space-y-5" onSubmit={(event) => { event.preventDefault(); submitPurchase(); }}>
              {/* Section A: Datos de compra */}
              <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 mb-3">Datos de compra</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Proveedor" error={formErrors.supplierId} required>
                    {!useTempProvider ? (
                      <div className="space-y-2">
                        <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} data-testid="purchase-supplier">
                          <option value="">Selecciona proveedor guardado</option>
                          {activeSuppliers.map((supplier) => (<option key={supplier.id} value={supplier.id}>{supplier.name}</option>))}
                        </Select>
                        <button type="button" className="text-[11px] font-semibold text-stone-500 hover:text-ink underline underline-offset-2" onClick={() => { setUseTempProvider(true); setSupplierId(''); }} data-testid="purchase-temp-provider-toggle">
                          Usar proveedor no registrado
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input value={tempProviderName} onChange={(event) => setTempProviderName(event.target.value)} placeholder="Ej. Don Carlos - Carnes del Valle" data-testid="purchase-temp-provider-name" />
                        <div className="flex items-center gap-2">
                          <button type="button" className="text-[11px] font-semibold text-stone-500 hover:text-ink underline underline-offset-2" onClick={() => { setUseTempProvider(false); setTempProviderName(''); }}>
                            Usar proveedor guardado
                          </button>
                          <span className="text-[10px] text-stone-400">Solo para esta compra</span>
                        </div>
                      </div>
                    )}
                  </Field>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 mb-2">{items.length} linea{items.length !== 1 ? 's' : ''}</p>
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const lineSubtotal = Number(item.quantity || 0) * Number(item.unitCost || 0);
                    return (
                    <div key={`${index}-${item.targetType}`} className={`rounded-xl border ${lineErrors[index] ? 'border-red-300 bg-red-50/70' : 'border-stone-200 bg-white'}`} data-testid="purchase-line-card">
                      {/* Header bar */}
                      <div className={`flex items-center justify-between gap-3 px-3.5 py-2 ${lineErrors[index] ? 'border-b border-red-200' : 'border-b border-stone-100'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-extrabold text-stone-500 uppercase tracking-[0.08em]">Linea {index + 1}</span>
                          <span className="text-[10px] font-semibold text-stone-400">{item.targetType === 'ingredient' ? 'Insumo' : 'Producto'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {lineErrors[index] ? <span className="text-[10px] font-bold text-red-600">Incompleta</span> : null}
                          {items.length > 1 ? (
                            <button type="button" className="text-stone-400 hover:text-red-600 transition" onClick={() => setItems((c) => c.filter((_, i) => i !== index))}>
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
                              {(item.targetType === 'ingredient' ? ingredients.data : products.data)?.map((t: any) => (<option key={t.id} value={t.id}>{t.name}</option>))}
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
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Subtotal</span>
                          <span className="text-[13px] font-extrabold text-ink tabular-nums">{formatCurrency(lineSubtotal)}</span>
                        </div>
                        <span className="text-[10px] font-semibold text-stone-500">{item.targetType === 'ingredient' ? 'Aumenta insumo' : 'Aumenta producto'}</span>
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
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Total proyectado</p>
                    <p className="mt-1 text-[1.5rem] font-black leading-none text-ink tabular-nums">{formatCurrency(computedTotal)}</p>
                    <p className="mt-1 text-[11px] font-semibold text-stone-600">{items.length} lineas &middot; {supplierId ? activeSuppliers.find((s: any) => s.id === supplierId)?.name ?? 'Proveedor' : useTempProvider && tempProviderName.trim() ? tempProviderName.trim() : 'Proveedor pendiente'}</p>
                  </div>
                  <Button data-testid="purchase-submit" type="submit" disabled={createPurchase.isPending} className="shrink-0">
                    {createPurchase.isPending ? 'Registrando...' : 'Guardar compra'}
                  </Button>
                </div>
              </div>
            </form>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="space-y-3 border-b border-stone-100 px-5 py-4">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Historial</h2>
                <p className="mt-0.5 text-[12px] text-stone-500">Selecciona una compra para ver su detalle.</p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Busca por número, factura o proveedor"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="hide-scrollbar list-scroll-5-rows divide-y divide-stone-100">
              {purchases.isLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="px-5 py-4">
                      <Skeleton className="h-20 rounded-2xl" />
                    </div>
                  ))
                : null}

              {!purchases.isLoading &&
                filteredPurchases.map((purchase) => (
                  <button
                    key={purchase.id}
                    type="button"
                    className={`grid w-full gap-3 border px-4 py-3 text-left transition md:grid-cols-[0.7fr_1fr_0.4fr_0.55fr] rounded-xl ${selectedPurchaseId === purchase.id ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200 shadow-sm border-l-[3px] border-l-brand-400' : 'border-transparent hover:bg-stone-50/50'}`}
                    onClick={() => setSelectedPurchaseId(purchase.id)}
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{formatDate(purchase.purchasedAt)}</p>
                      <p className="text-[12px] text-stone-500">{purchase.number}</p>
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{purchase.supplier.name}</p>
                      <p className="text-[12px] text-stone-500">
                        {purchase.invoiceNumber || 'Sin factura'} · {purchase.paymentMethod?.name ?? 'Sin método'}
                      </p>
                    </div>
                    <div className="text-[12px] text-stone-600">{purchase.items.length} ítems</div>
                    <div className="numeric-tabular whitespace-nowrap text-right text-[13px] font-semibold text-ink">{formatCurrency(purchase.total)}</div>
                  </button>
                ))}

              {!purchases.isLoading && !filteredPurchases.length ? (
                <div className="p-6">
                  <EmptyState
                    title="Sin compras visibles"
                    description="Registra la primera compra para empezar."
                  />
                </div>
              ) : null}
            </div>
          </Card>
        </div>

          <Card className="xl:sticky xl:top-24 xl:self-start">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Detalle de compra</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Vista rapida del historial.</p>
            </div>
            {purchaseDetail.data ? <Badge tone="success">{purchaseDetail.data.items.length} lineas</Badge> : null}
          </div>

          {purchaseDetail.isLoading ? (
            <div className="mt-5 space-y-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : purchaseDetail.data ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5">
                <p className="text-[13px] font-extrabold text-ink">{purchaseDetail.data.supplier.name}</p>
                <p className="mt-0.5 text-[11px] text-stone-500">{purchaseDetail.data.number} &middot; {formatDate(purchaseDetail.data.purchasedAt)} &middot; {purchaseDetail.data.paymentMethod?.name ?? 'Sin método'}</p>
                <p className="mt-2 text-[12px] text-stone-600">
                  {purchaseDetail.data.notes || 'Sin notas registradas.'}
                </p>
              </div>
              {purchaseDetail.data.items.map((item: any) => (
                <div key={item.id} className="rounded-[1.2rem] border border-stone-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-ink">{item.ingredient?.name ?? item.product?.name}</p>
                      <p className="text-[12px] text-stone-500">
                        {item.ingredient ? 'Insumo' : 'Producto'} · {item.lotNumber || 'Sin lote'}
                      </p>
                    </div>
                    <div className="numeric-tabular text-right text-[12px]">
                      <p className="whitespace-nowrap font-semibold text-ink">{formatCurrency(item.totalCost)}</p>
                      <p className="text-stone-500">
                        {item.quantity} x {formatCurrency(item.unitCost)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              <div className="rounded-[1.55rem] border border-brand-200 bg-brand-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">Total de la compra</p>
                <p className="numeric-tabular mt-2 whitespace-nowrap text-[1.58rem] font-bold leading-none text-ink">{formatCurrency(purchaseDetail.data.total)}</p>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState
                title="Selecciona una compra"
                description="Aquí verás proveedor, ítems y total."
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
