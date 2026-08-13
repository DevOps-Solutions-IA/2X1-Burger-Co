'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { ChefHat, Search, ShieldAlert, Trash2 } from 'lucide-react';
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

type Ingredient = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  costPrice: number | string;
  currentStock: number | string;
  stockMin: number | string;
  stockMax: number | string | null;
  isActive: boolean;
  unitId: string;
  unit: {
    name: string;
    abbreviation: string;
  };
};

type IngredientForm = {
  code: string;
  name: string;
  unitId: string;
  description: string;
  costPrice: string;
  currentStock: string;
  stockMin: string;
  stockMax: string;
  isActive: boolean;
};

const initialForm: IngredientForm = {
  code: '',
  name: '',
  unitId: '',
  description: '',
  costPrice: '0',
  currentStock: '0',
  stockMin: '0',
  stockMax: '0',
  isActive: true,
};

const catalogTabs = [
  { id: 'products', label: 'Productos', href: '/products' },
  { id: 'ingredients', label: 'Insumos', href: '/ingredients', active: true },
  { id: 'categories', label: 'Categorías', href: '/categories' },
  { id: 'recipes', label: 'Recetas', href: '/recipes' },
] as const;

export default function IngredientsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'NORMAL'>('ALL');
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<IngredientForm>(initialForm);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const editIngredientId = searchParams?.get('edit') ?? null;

  const ingredients = useQuery({
    queryKey: ['ingredients'],
    queryFn: () => apiFetch<Ingredient[]>('/ingredients'),
  });
  const units = useQuery({
    queryKey: ['units'],
    queryFn: () => apiFetch<Array<{ id: string; name: string; abbreviation: string }>>('/units'),
  });

  const filteredIngredients = useMemo(
    () =>
      (ingredients.data ?? []).filter((ingredient) => {
        const lowStock =
          Number(ingredient.stockMin) > 0 &&
          Number(ingredient.currentStock) <= Number(ingredient.stockMin);

        const matchesStock =
          stockFilter === 'ALL' ? true : stockFilter === 'LOW' ? lowStock : !lowStock;

        return (
          matchesSearch(
            [ingredient.name, ingredient.code, ingredient.unit.name, ingredient.description],
            search,
          ) && matchesStock
        );
      }),
    [ingredients.data, search, stockFilter],
  );

  const metrics = useMemo(() => {
    const list = ingredients.data ?? [];
    return {
      active: list.filter((item) => item.isActive).length,
      low: list.filter(
        (item) => Number(item.stockMin) > 0 && Number(item.currentStock) <= Number(item.stockMin),
      ).length,
    };
  }, [ingredients.data]);

  const formErrors = useMemo(() => {
    const errors: Partial<Record<keyof IngredientForm, string>> = {};
    const numericFields: Array<keyof Pick<IngredientForm, 'costPrice' | 'currentStock' | 'stockMin' | 'stockMax'>> = [
      'costPrice', 'currentStock', 'stockMin', 'stockMax',
    ];
    if (!form.code.trim()) errors.code = 'El código es obligatorio.';
    if (!form.name.trim()) errors.name = 'El nombre es obligatorio.';
    if (!form.unitId) errors.unitId = 'Selecciona una unidad.';
    numericFields.forEach((field) => {
      const value = Number(form[field]);
      if (!Number.isFinite(value) || value < 0) errors[field] = 'Ingresa un valor mayor o igual a 0.';
    });
    if (Number(form.stockMax) > 0 && Number(form.stockMax) < Number(form.stockMin)) {
      errors.stockMax = 'El stock máximo no puede ser menor al mínimo.';
    }
    return errors;
  }, [form]);

  const saveIngredient = useMutation({
    mutationFn: async () => {
      if (Object.keys(formErrors).length > 0) throw new Error('Corrige los campos marcados antes de guardar.');
      const payload = {
        ...form,
        costPrice: Number(form.costPrice),
        currentStock: Number(form.currentStock),
        stockMin: Number(form.stockMin),
        stockMax: Number(form.stockMax),
      };

      if (selectedIngredient) {
        return apiFetch(`/ingredients/${selectedIngredient.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      return apiFetch('/ingredients', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      toast.success(selectedIngredient ? 'Insumo actualizado' : 'Insumo creado');
      setSelectedIngredient(null);
      setForm(initialForm);
      await queryClient.invalidateQueries({ queryKey: ['ingredients'] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No fue posible guardar el insumo'),
  });

  const toggleIngredientStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/ingredients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: async (_, variables) => {
      toast.success(variables.isActive ? 'Insumo activado' : 'Insumo desactivado');
      await queryClient.invalidateQueries({ queryKey: ['ingredients'] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No fue posible cambiar el estado del insumo'),
  });

  const deleteIngredient = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/ingredients/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast.success('Insumo eliminado');
      setSelectedIngredient(null);
      setForm(initialForm);
      await queryClient.invalidateQueries({ queryKey: ['ingredients'] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No fue posible eliminar el insumo'),
  });

  useEffect(() => {
    if (!editIngredientId || !(ingredients.data?.length)) {
      return;
    }

    const ingredient = ingredients.data.find((item) => item.id === editIngredientId);
    if (!ingredient) {
      return;
    }

    setSelectedIngredient(ingredient);
    setForm({
      code: ingredient.code,
      name: ingredient.name,
      unitId: ingredient.unitId,
      description: ingredient.description ?? '',
      costPrice: String(Number(ingredient.costPrice ?? 0)),
      currentStock: String(Number(ingredient.currentStock)),
      stockMin: String(Number(ingredient.stockMin)),
      stockMax: String(Number(ingredient.stockMax ?? 0)),
      isActive: ingredient.isActive,
    });
    setSearch(ingredient.name);
    setStockFilter('ALL');
  }, [editIngredientId, ingredients.data]);

  return (
    <main className="space-y-5 p-4 sm:p-6 lg:p-8" data-testid="ingredients-page">
      <PageHeader
        eyebrow="Catálogo operativo"
        title="Insumos"
        description="Controla materia prima, costos y umbrales de stock con señales operativas verificables."
        status={<StatusBadge status={metrics.low ? 'PENDING' : 'ACTIVE'} label={`${metrics.low} en alerta`} />}
        actions={
          <Button type="button" variant="secondary" onClick={() => { setSelectedIngredient(null); setForm(initialForm); setSubmitAttempted(false); }}>
            Nuevo insumo
          </Button>
        }
      />

      <ModuleTabs items={catalogTabs} label="Administración de catálogo" />

      <div className="grid gap-3 md:grid-cols-2">
        <MetricSurface density="compact" label="Activos" value={formatNumber(metrics.active)} context="Disponibles para recetas" icon={<ChefHat className="h-5 w-5" />} unavailable={ingredients.isError} />
        <MetricSurface density="compact" label="Stock en alerta" value={formatNumber(metrics.low)} context="En o bajo el mínimo" icon={<ShieldAlert className="h-5 w-5" />} unavailable={ingredients.isError} status={metrics.low > 0 ? <StatusBadge status="PENDING" label="Atención" /> : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="flex min-h-0 flex-col overflow-hidden p-0">
          <div className="space-y-4 border-b border-line px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Insumos cargados</h2>
              <p className="mt-0.5 text-[12px] text-muted">Busca por código o nombre y detecta riesgo de quiebre.</p>
            </div>
            <FilterBar density="compact" activeCount={Number(Boolean(search.trim())) + Number(stockFilter !== 'ALL')} search={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <Input className="pl-9" aria-label="Buscar insumos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar insumo..." />
              </div>
            } filters={
              <Select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)}>
                <option value="ALL">Todo el stock</option>
                <option value="LOW">Solo alertas</option>
                <option value="NORMAL">Solo normales</option>
              </Select>
            } actions={<Button type="button" variant="ghost" onClick={() => { setSearch(''); setStockFilter('ALL'); }}>Limpiar</Button>} />
          </div>

          <QueryState
            status={ingredients.isLoading ? 'loading' : ingredients.isError ? 'error' : filteredIngredients.length === 0 ? 'empty' : 'ready'}
            title={ingredients.isError ? 'No pudimos cargar los insumos' : 'Sin insumos para mostrar'}
            description={ingredients.isError ? 'La disponibilidad real no está accesible; no se reemplaza con inventario estimado.' : 'Ajusta la búsqueda o el filtro de stock.'}
            onRetry={ingredients.isError ? () => void ingredients.refetch() : undefined}
            action={!ingredients.isError ? <Button type="button" variant="secondary" onClick={() => { setSearch(''); setStockFilter('ALL'); }}>Restablecer filtros</Button> : undefined}
            className="m-4"
          >
          <div className="hide-scrollbar max-h-[32rem] min-h-0 divide-y divide-line overflow-y-auto">
            {filteredIngredients.map((ingredient) => {
              const lowStock =
                Number(ingredient.stockMin) > 0 &&
                Number(ingredient.currentStock) <= Number(ingredient.stockMin);
              const isSelected = selectedIngredient?.id === ingredient.id;

              return (
                <div key={ingredient.id} className={`flex items-center justify-between gap-3 px-5 py-3 ${isSelected ? 'bg-stone-50' : 'hover:bg-stone-50/50'}`}>
                  <button
                    type="button"
                    className={`rounded-xl border px-3 py-2 text-left flex-1 min-w-0 transition ${isSelected ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200 shadow-sm border-l-[3px] border-l-brand-400' : 'border-transparent hover:bg-stone-50/50'}`}
                    onClick={() => { setSelectedIngredient(ingredient); setForm({ code: ingredient.code, name: ingredient.name, unitId: ingredient.unitId, description: ingredient.description ?? '', costPrice: String(Number(ingredient.costPrice ?? 0)), currentStock: String(Number(ingredient.currentStock)), stockMin: String(Number(ingredient.stockMin)), stockMax: String(Number(ingredient.stockMax ?? 0)), isActive: ingredient.isActive }); }}
                    data-testid="ingredient-card"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[14px] font-extrabold text-ink truncate">{ingredient.name}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-bold ${ingredient.isActive ? 'text-emerald-600' : 'text-stone-400'}`}>
                          {ingredient.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                        {lowStock ? <span className="text-[10px] font-bold text-red-600">Stock bajo</span> : null}
                      </div>
                    </div>
                    <p className="mt-0.5 text-[11px] text-stone-500">{ingredient.code} &middot; {ingredient.unit.abbreviation}</p>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-center">
                        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">Stock</p>
                        <p className="mt-0.5 text-[12px] font-extrabold text-ink tabular-nums">{formatNumber(ingredient.currentStock)}</p>
                      </div>
                      <div className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-center">
                        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">Minimo</p>
                        <p className="mt-0.5 text-[12px] font-extrabold text-ink tabular-nums">{formatNumber(ingredient.stockMin)}</p>
                      </div>
                      <div className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-center">
                        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">Costo</p>
                        <p className="mt-0.5 text-[12px] font-extrabold text-ink tabular-nums">{formatCurrency(ingredient.costPrice)}</p>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button type="button" variant="secondary" size="sm" className="text-[11px]"
                      onClick={() => toggleIngredientStatus.mutate({ id: ingredient.id, isActive: !ingredient.isActive })}>
                      {ingredient.isActive ? 'Desactivar' : 'Activar'}
                    </Button>
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      disabled={deleteIngredient.isPending}
                      onClick={() => setConfirmDelete({ id: ingredient.id, name: ingredient.name })} aria-label={`Eliminar ${ingredient.name}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          </QueryState>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <ChefHat className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">{selectedIngredient ? 'Editar insumo' : 'Nuevo insumo'}</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Datos de costo y limites de stock.</p>
            </div>
          </div>

          <form
            className="mt-6 grid gap-4 md:grid-cols-2"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitAttempted(true);
              if (Object.keys(formErrors).length > 0) return;
              saveIngredient.mutate();
            }}
          >
            {units.isError ? (
              <QueryState
                status="error"
                title="No pudimos cargar las unidades"
                description="La unidad real es obligatoria para guardar un insumo."
                onRetry={() => void units.refetch()}
                className="md:col-span-2"
              />
            ) : null}
            <div className="md:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">Datos base</p>
            </div>
            <Field label="Código" error={submitAttempted ? formErrors.code : null} required>
              <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
            </Field>
            <Field label="Nombre" error={submitAttempted ? formErrors.name : null} required>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="Unidad" error={submitAttempted ? formErrors.unitId : null} required>
              <Select value={form.unitId} onChange={(event) => setForm((current) => ({ ...current, unitId: event.target.value }))}>
                <option value="">Selecciona una unidad</option>
                {units.data?.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({unit.abbreviation})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Costo unitario (COP)" error={submitAttempted ? formErrors.costPrice : null} required>
              <Input type="number" value={form.costPrice} onChange={(event) => setForm((current) => ({ ...current, costPrice: event.target.value }))} />
            </Field>
            <div className="md:col-span-2 pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">Inventario</p>
            </div>
            <Field label="Stock actual" error={submitAttempted ? formErrors.currentStock : null} required>
              <Input type="number" value={form.currentStock} onChange={(event) => setForm((current) => ({ ...current, currentStock: event.target.value }))} />
            </Field>
            <Field label="Stock mínimo" error={submitAttempted ? formErrors.stockMin : null} required>
              <Input type="number" value={form.stockMin} onChange={(event) => setForm((current) => ({ ...current, stockMin: event.target.value }))} />
            </Field>
            <Field label="Stock máximo" error={submitAttempted ? formErrors.stockMax : null} required>
              <Input type="number" value={form.stockMax} onChange={(event) => setForm((current) => ({ ...current, stockMax: event.target.value }))} />
            </Field>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-stone-200 bg-stone-50 px-3.5 py-3.5 md:col-span-2">
              <div>
                <p className="text-[15px] font-medium text-ink">Insumo activo</p>
                <p className="text-[13px] leading-6 text-stone-500">Permite excluir temporalmente un insumo del catálogo operativo.</p>
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
              <Button type="submit" className="flex-1" disabled={saveIngredient.isPending || units.isLoading || units.isError || (submitAttempted && Object.keys(formErrors).length > 0)}>
                {saveIngredient.isPending ? 'Guardando insumo...' : selectedIngredient ? 'Guardar cambios del insumo' : 'Crear insumo'}
              </Button>
              {selectedIngredient ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deleteIngredient.isPending}
                  onClick={() => setConfirmDelete({ id: selectedIngredient.id, name: selectedIngredient.name })}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Eliminar
                </Button>
              ) : null}
              {selectedIngredient ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSelectedIngredient(null);
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
          title="Eliminar insumo"
          message={`¿Eliminar ${confirmDelete.name}? Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          destructive
          onConfirm={() => {
            deleteIngredient.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </main>
  );
}
