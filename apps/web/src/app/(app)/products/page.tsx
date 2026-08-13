'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Boxes, Package2, Search, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FilterBar } from '@/components/product/filter-bar';
import { MetricSurface } from '@/components/product/metric-surface';
import { ModuleTabs } from '@/components/product/module-tabs';
import { PageHeader } from '@/components/product/page-header';
import { QueryState } from '@/components/product/query-state';
import { StatusBadge } from '@/components/product/status-badge';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatNumber, matchesSearch } from '@/lib/format';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { focusFirstInvalidField } from '@/lib/form-accessibility';

type Product = {
  id: string;
  code: string;
  name: string;
  kind: 'PREPARED' | 'DIRECT_STOCK';
  brand: 'HOUSE' | 'COCA_COLA' | 'OTHER';
  currentStock: number | string;
  stockMin: number | string;
  salePrice: number | string;
  costPrice: number | string;
  isActive: boolean;
  description?: string | null;
  categoryId: string;
  unitId: string;
  category: { name: string };
};

type ProductForm = {
  code: string;
  name: string;
  categoryId: string;
  unitId: string;
  kind: 'PREPARED' | 'DIRECT_STOCK';
  brand: 'HOUSE' | 'COCA_COLA' | 'OTHER';
  description: string;
  salePrice: string;
  costPrice: string;
  currentStock: string;
  stockMin: string;
  isActive: boolean;
};

type ProductBrand = 'ALL' | 'HOUSE' | 'COCA_COLA' | 'OTHER';

const initialForm: ProductForm = {
  code: '',
  name: '',
  categoryId: '',
  unitId: '',
  kind: 'PREPARED',
  brand: 'HOUSE',
  description: '',
  salePrice: '',
  costPrice: '0',
  currentStock: '0',
  stockMin: '0',
  isActive: true,
};

const catalogTabs = [
  { id: 'products', label: 'Productos', href: '/products', active: true },
  { id: 'ingredients', label: 'Insumos', href: '/ingredients' },
  { id: 'categories', label: 'Categorías', href: '/categories' },
  { id: 'recipes', label: 'Recetas', href: '/recipes' },
] as const;

function getProductBrandLabel(brand: Exclude<Product['brand'], never>) {
  switch (brand) {
    case 'HOUSE':
      return 'Casa';
    case 'COCA_COLA':
      return 'Coca-Cola';
    default:
      return 'Otra';
  }
}

function sanitizeCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  return new Intl.NumberFormat('es-CO').format(Number(digits));
}

function parseCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function mapProductToForm(product: Product): ProductForm {
  return {
    code: product.code,
    name: product.name,
    categoryId: product.categoryId,
    unitId: product.unitId,
    kind: product.kind,
    brand: product.brand,
    description: product.description ?? '',
    salePrice: sanitizeCurrencyInput(String(Number(product.salePrice))),
    costPrice: sanitizeCurrencyInput(String(Number(product.costPrice ?? 0))),
    currentStock: String(Number(product.currentStock)),
    stockMin: String(Number(product.stockMin)),
    isActive: product.isActive,
  };
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'ALL' | 'PREPARED' | 'DIRECT_STOCK'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [brandFilter, setBrandFilter] = useState<ProductBrand>('ALL');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<ProductForm>(initialForm);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const editProductId = searchParams?.get('edit') ?? null;

  const formErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const salePrice = parseCurrencyInput(form.salePrice);
    const costPrice = parseCurrencyInput(form.costPrice);
    const stockMin = Number(form.stockMin);
    const currentStock = Number(form.currentStock);
    const validKinds: ProductForm['kind'][] = ['PREPARED', 'DIRECT_STOCK'];
    const validBrands: ProductForm['brand'][] = ['HOUSE', 'COCA_COLA', 'OTHER'];

    if (!form.code?.trim()) errors.code = 'El código es obligatorio.';
    if (!form.name?.trim()) errors.name = 'El nombre es obligatorio.';
    if (!form.categoryId) errors.categoryId = 'La categoría es obligatoria.';
    if (!form.unitId) errors.unitId = 'La unidad es obligatoria.';
    if (!validKinds.includes(form.kind)) errors.kind = 'Selecciona un tipo de producto válido.';
    if (!validBrands.includes(form.brand)) errors.brand = 'Selecciona una marca válida.';
    if (!Number.isFinite(salePrice) || salePrice <= 0) errors.salePrice = 'El precio debe ser mayor a $0.';
    if (!Number.isFinite(costPrice) || costPrice < 0) errors.costPrice = 'El costo no puede ser negativo.';
    if (!Number.isFinite(stockMin) || stockMin < 0) errors.stockMin = 'El stock mínimo no puede ser negativo.';
    if (form.kind === 'DIRECT_STOCK' && (!Number.isFinite(currentStock) || currentStock < 0)) {
      errors.currentStock = 'El stock actual no puede ser negativo.';
    }
    return errors;
  }, [form]);

  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<Product[]>('/products'),
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Array<{ id: string; name: string }>>('/categories'),
  });
  const units = useQuery({
    queryKey: ['units'],
    queryFn: () => apiFetch<Array<{ id: string; name: string; abbreviation: string }>>('/units'),
  });

  const filteredProducts = useMemo(
    () =>
      (products.data ?? []).filter((product) => {
        const matchesTerm = matchesSearch(
          [product.name, product.code, product.category.name, product.kind],
          search,
        );
        const matchesKind = kindFilter === 'ALL' ? true : product.kind === kindFilter;
        const matchesBrand = brandFilter === 'ALL' ? true : product.brand === brandFilter;
        const matchesStatus =
          statusFilter === 'ALL'
            ? true
            : statusFilter === 'ACTIVE'
              ? product.isActive
              : !product.isActive;

        return matchesTerm && matchesKind && matchesBrand && matchesStatus;
      }),
    [products.data, search, kindFilter, brandFilter, statusFilter],
  );

  const metrics = useMemo(() => {
    const list = products.data ?? [];
    return {
      active: list.filter((item) => item.isActive).length,
      prepared: list.filter((item) => item.kind === 'PREPARED').length,
      direct: list.filter((item) => item.kind === 'DIRECT_STOCK').length,
      lowStock: list.filter(
        (item) =>
          item.kind === 'DIRECT_STOCK' &&
          Number(item.stockMin) > 0 &&
          Number(item.currentStock) <= Number(item.stockMin),
      ).length,
    };
  }, [products.data]);

  const saveProduct = useMutation({
    mutationFn: async () => {
      if (Object.keys(formErrors).length > 0) {
        throw new Error('Corrige los campos marcados antes de guardar.');
      }

      const payload = {
        ...form,
        salePrice: parseCurrencyInput(form.salePrice),
        costPrice: parseCurrencyInput(form.costPrice),
        currentStock: Number(form.currentStock),
        stockMin: Number(form.stockMin),
        trackStock: form.kind === 'DIRECT_STOCK',
      };

      if (selectedProduct) {
        return apiFetch<Product>(`/products/${selectedProduct.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      return apiFetch<Product>('/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (response: Product) => {
      toast.success(selectedProduct ? 'Producto actualizado' : 'Producto creado');
      setSelectedProduct(response);
      setForm(mapProductToForm(response));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['products', 'sellable'] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible guardar el producto'),
  });

  const toggleProductStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: async (_, variables) => {
      toast.success(variables.isActive ? 'Producto activado' : 'Producto desactivado');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['products', 'sellable'] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No fue posible cambiar el estado del producto'),
  });

  const deleteProduct = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/products/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast.success('Producto eliminado');
      setSelectedProduct(null);
      setForm(initialForm);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['products', 'sellable'] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No fue posible eliminar el producto'),
  });

  useEffect(() => {
    if (!editProductId || !(products.data?.length)) {
      return;
    }

    const product = products.data.find((item) => item.id === editProductId);
    if (!product) {
      return;
    }

    setSelectedProduct(product);
    setForm(mapProductToForm(product));
    setSearch(product.name);
    setStatusFilter('ALL');
    setBrandFilter('ALL');
    setKindFilter('ALL');
  }, [editProductId, products.data]);

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8" data-testid="products-page">
      <PageHeader
        eyebrow="Catálogo operativo"
        title="Productos — Carta y stock"
        description="Gobierna precios, costos, disponibilidad y trazabilidad sin separar la carta de la operación."
        status={products.isError
          ? <StatusBadge status="UNKNOWN" label={products.data ? 'Catálogo desactualizado' : 'Catálogo sin verificar'} />
          : products.isSuccess
            ? <StatusBadge status="ACTIVE" label={`${metrics.active} activos`} />
            : <StatusBadge status="PENDING" label="Verificando catálogo" />}
        actions={
          <Button type="button" variant="secondary" onClick={() => { setSelectedProduct(null); setForm(initialForm); setSubmitAttempted(false); }}>
            Nuevo producto
          </Button>
        }
      />

      <ModuleTabs items={catalogTabs} label="Administración de catálogo" />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricSurface density="compact" label="Activos" value={formatNumber(metrics.active)} context="En catálogo" icon={<Package2 className="h-5 w-5" />} unavailable={products.isError} />
        <MetricSurface density="compact" label="Preparados" value={formatNumber(metrics.prepared)} context="Gobernados por receta" icon={<Sparkles className="h-5 w-5" />} unavailable={products.isError} />
        <MetricSurface density="compact" label="Stock directo" value={formatNumber(metrics.direct)} context="Con existencia propia" icon={<Boxes className="h-5 w-5" />} unavailable={products.isError} />
        <MetricSurface density="compact" label="Stock bajo" value={formatNumber(metrics.lowStock)} context="Requiere revisión" icon={<Boxes className="h-5 w-5" />} unavailable={products.isError} status={metrics.lowStock > 0 ? <StatusBadge status="PENDING" label="Atención" /> : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="flex min-h-0 flex-col overflow-hidden p-0">
          <div className="space-y-4 border-b border-line px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-extrabold">Carta</h2>
                <p className="mt-0.5 text-[12px] text-stone-500">Busca, filtra y edita en una sola vista.</p>
              </div>
              <StatusBadge status="VISIBLE" label={`${filteredProducts.length} visibles`} />
            </div>
            <FilterBar
              density="compact"
              activeCount={Number(kindFilter !== 'ALL') + Number(brandFilter !== 'ALL') + Number(statusFilter !== 'ACTIVE') + Number(Boolean(search.trim()))}
              search={<Field label="Buscar">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, código o categoría" className="pl-9" />
                </div>
              </Field>}
              filters={<>
              <Field label="Tipo">
                <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
                  <option value="ALL">Todos los tipos</option>
                  <option value="PREPARED">Preparados</option>
                  <option value="DIRECT_STOCK">Stock directo</option>
                </Select>
              </Field>
              <Field label="Marca">
                <Select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value as ProductBrand)}>
                  <option value="ALL">Todas las marcas</option>
                  <option value="HOUSE">Casa</option>
                  <option value="COCA_COLA">Coca-Cola</option>
                  <option value="OTHER">Otras</option>
                </Select>
              </Field>
              <Field label="Estado">
                <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                  <option value="ALL">Todos los estados</option>
                  <option value="ACTIVE">Activos</option>
                  <option value="INACTIVE">Inactivos</option>
                </Select>
              </Field>
              </>}
              actions={<Button type="button" variant="ghost" onClick={() => { setSearch(''); setKindFilter('ALL'); setBrandFilter('ALL'); setStatusFilter('ACTIVE'); }}>Limpiar</Button>}
            />
          </div>

          <QueryState
            status={products.isLoading ? 'loading' : products.isError ? 'error' : filteredProducts.length === 0 ? 'empty' : 'ready'}
            title={products.isError ? 'No pudimos cargar el catálogo' : 'Sin productos para mostrar'}
            description={products.isError ? 'La carta real no está disponible; no mostramos datos estimados.' : 'Ajusta los filtros o crea un producto autorizado.'}
            onRetry={products.isError ? () => void products.refetch() : undefined}
            action={!products.isError ? <Button type="button" variant="secondary" onClick={() => { setSearch(''); setKindFilter('ALL'); setBrandFilter('ALL'); setStatusFilter('ACTIVE'); }}>Restablecer filtros</Button> : undefined}
            className="m-4"
          >
          <div className="hide-scrollbar max-h-[32rem] min-h-0 divide-y divide-line overflow-y-auto">
            {filteredProducts.map((product) => {
              const lowStock =
                product.kind === 'DIRECT_STOCK' &&
                Number(product.stockMin) > 0 &&
                Number(product.currentStock) <= Number(product.stockMin);
              const isSelected = selectedProduct?.id === product.id;
              const productBrand = product.brand;

              return (
                <div
                  key={product.id}
                  className={`grid gap-3 px-5 py-3.5 lg:grid-cols-[1fr_auto] ${isSelected ? 'bg-brand-50/60' : 'hover:bg-stone-50/70'}`}
                >
                  <button
                    type="button"
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${isSelected ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200 shadow-sm border-l-[3px] border-l-brand-400' : 'border-transparent hover:bg-stone-50/50'}`}
                    onClick={() => { setSelectedProduct(product); setForm(mapProductToForm(product)); }}
                    data-testid="product-card"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[14px] font-extrabold text-ink truncate">{product.name}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs font-semibold text-stone-600">{getProductBrandLabel(productBrand)}</span>
                        <span className={`text-xs font-bold uppercase tracking-[0.05em] ${product.kind === 'DIRECT_STOCK' ? 'text-sky-700' : 'text-stone-600'}`}>
                          {product.kind === 'DIRECT_STOCK' ? 'Directo' : 'Preparado'}
                        </span>
                        <span className={`text-xs font-bold ${product.isActive ? 'text-emerald-700' : 'text-stone-600'}`}>
                          {product.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                        {lowStock ? <span className="text-xs font-bold text-red-700">Stock bajo</span> : null}
                      </div>
                    </div>
                    <p className="mt-0.5 text-[11px] text-stone-500">{product.code} &middot; {product.category.name}</p>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-center">
                        <p className="text-xs font-bold uppercase tracking-[0.1em] text-stone-600">Venta</p>
                        <p className="mt-0.5 text-[12px] font-extrabold text-ink tabular-nums">{formatCurrency(product.salePrice)}</p>
                      </div>
                      <div className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-center">
                        <p className="text-xs font-bold uppercase tracking-[0.1em] text-stone-600">Costo</p>
                        <p className="mt-0.5 text-[12px] font-extrabold text-ink tabular-nums">{formatCurrency(product.costPrice)}</p>
                      </div>
                      <div className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-center">
                        <p className="text-xs font-bold uppercase tracking-[0.1em] text-stone-600">Stock</p>
                        <p className={`mt-0.5 text-[12px] font-extrabold tabular-nums ${lowStock ? 'text-red-600' : 'text-ink'}`}>{formatNumber(product.currentStock)}</p>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-start justify-end">
                    <div className="flex items-center gap-1.5">
                      <Button type="button" variant="secondary" size="sm" className="text-[11px]"
                        onClick={() => toggleProductStatus.mutate({ id: product.id, isActive: !product.isActive })}
                      >
                        {product.isActive ? 'Desactivar' : 'Activar'}
                      </Button>
                      <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        onClick={() => setConfirmDelete({ id: product.id, name: product.name })}
                        disabled={deleteProduct.isPending} aria-label={`Eliminar ${product.name}`}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </QueryState>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
              <Package2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold">
                {selectedProduct ? 'Editar producto' : 'Nuevo producto'}
              </h2>
              <p className="mt-1 text-sm text-stone-500">Configura precio, tipo, stock y categoria.</p>
            </div>
          </div>

          <form
            className="mt-6 grid gap-4 md:grid-cols-2"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitAttempted(true);
              if (Object.keys(formErrors).length > 0) {
                focusFirstInvalidField(event.currentTarget);
                return;
              }
              saveProduct.mutate();
            }}
          >
            {categories.isError || units.isError ? (
              <QueryState
                status="error"
                title="Faltan datos de configuración"
                description="Categorías y unidades deben estar disponibles para guardar un producto válido."
                onRetry={() => void Promise.all([categories.refetch(), units.refetch()])}
                className="md:col-span-2"
              />
            ) : null}
            <div className="md:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">Datos base</p>
            </div>
            <Field label="Código" error={submitAttempted ? formErrors.code : null}>
              <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
            </Field>
            <Field label="Nombre" error={submitAttempted ? formErrors.name : null}>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="Categoría" error={submitAttempted ? formErrors.categoryId : null}>
              <Select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}>
                <option value="">Selecciona categoria</option>
                {categories.data?.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unidad" error={submitAttempted ? formErrors.unitId : null}>
              <Select value={form.unitId} onChange={(event) => setForm((current) => ({ ...current, unitId: event.target.value }))}>
                <option value="">Selecciona unidad</option>
                {units.data?.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({unit.abbreviation})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo de producto" error={submitAttempted ? formErrors.kind : null}>
              <Select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as ProductForm['kind'] }))}>
                <option value="PREPARED">Preparado por receta</option>
                <option value="DIRECT_STOCK">Stock directo</option>
              </Select>
            </Field>
            <Field label="Marca" error={submitAttempted ? formErrors.brand : null}>
              <Select value={form.brand} onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value as ProductForm['brand'] }))}>
                <option value="HOUSE">Casa</option>
                <option value="COCA_COLA">Coca-Cola</option>
                <option value="OTHER">Otra</option>
              </Select>
            </Field>
            <div className="md:col-span-2 pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">Precio e inventario</p>
            </div>
            <Field label="Precio de venta (COP)" error={submitAttempted ? formErrors.salePrice : null}>
              <Input
                type="text"
                inputMode="numeric"
                value={form.salePrice}
                onChange={(event) =>
                  setForm((current) => ({ ...current, salePrice: sanitizeCurrencyInput(event.target.value) }))
                }
              />
            </Field>
            <Field label="Costo base (COP)" error={submitAttempted ? formErrors.costPrice : null}>
              <Input
                type="text"
                inputMode="numeric"
                value={form.costPrice}
                onChange={(event) =>
                  setForm((current) => ({ ...current, costPrice: sanitizeCurrencyInput(event.target.value) }))
                }
              />
            </Field>
            <Field label="Stock mínimo" error={submitAttempted ? formErrors.stockMin : null}>
              <Input type="number" value={form.stockMin} onChange={(event) => setForm((current) => ({ ...current, stockMin: event.target.value }))} />
            </Field>
            <Field
              label="Stock actual"
              error={submitAttempted ? formErrors.currentStock : null}
              hint={form.kind === 'PREPARED' ? 'Los preparados descuentan por receta, no por stock propio.' : undefined}
            >
              <Input
                type="number"
                value={form.currentStock}
                disabled={form.kind === 'PREPARED'}
                onChange={(event) => setForm((current) => ({ ...current, currentStock: event.target.value }))}
              />
            </Field>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-stone-200 bg-stone-50 px-3.5 py-3.5 md:col-span-2">
              <div>
                <p className="text-[15px] font-medium text-ink">Producto activo</p>
                <p className="text-[13px] leading-6 text-stone-500">Los inactivos desaparecen de la operación sin perder trazabilidad histórica.</p>
              </div>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
              />
            </label>
            <div className="md:col-span-2">
              <Field label="Descripción">
                <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </Field>
            </div>
            <div className="flex gap-3 md:col-span-2">
              <Button type="submit" className="flex-1" disabled={saveProduct.isPending || categories.isLoading || categories.isError || units.isLoading || units.isError || (submitAttempted && Object.keys(formErrors).length > 0)}>
                {saveProduct.isPending ? 'Guardando...' : selectedProduct ? 'Guardar cambios' : 'Crear producto'}
              </Button>
              {selectedProduct ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deleteProduct.isPending}
                  onClick={() => setConfirmDelete({ id: selectedProduct.id, name: selectedProduct.name })}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Eliminar
                </Button>
              ) : null}
              {selectedProduct ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSelectedProduct(null);
                    setForm(initialForm);
                  }}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>
      {confirmDelete ? (
        <ConfirmDialog
          open
          title="Eliminar producto"
          message={`¿Eliminar ${confirmDelete.name}? Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          destructive
          onConfirm={() => {
            deleteProduct.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}
