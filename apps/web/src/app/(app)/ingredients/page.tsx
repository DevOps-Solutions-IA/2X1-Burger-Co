'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { ChefHat, Search, ShieldAlert, Trash2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
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

export default function IngredientsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'NORMAL'>('ALL');
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<IngredientForm>(initialForm);
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

  const saveIngredient = useMutation({
    mutationFn: async () => {
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
    <div className="space-y-6 p-6 lg:p-8">
      <SectionTitle
        eyebrow="Materia prima"
        title="Insumos"
        description="Materia prima, costos y limites de stock en un solo lugar."
        status={<Badge tone={metrics.low ? 'warning' : 'info'}>{metrics.low} en alerta</Badge>}
        actions={
          <Button type="button" variant="secondary" size="sm" onClick={() => { setSelectedIngredient(null); setForm(initialForm); }}>
            Nuevo insumo
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard compact label="Activos" value={formatNumber(metrics.active)} hint="Disponibles" icon={<ChefHat className="h-5 w-5" />} />
        <MetricCard compact label="Stock en alerta" value={formatNumber(metrics.low)} hint="Bajo el minimo" icon={<ShieldAlert className="h-5 w-5" />} accent="danger" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="flex min-h-0 flex-col overflow-hidden p-0">
          <div className="space-y-4 border-b border-stone-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Insumos cargados</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Busca por codigo o nombre y detecta riesgo de quiebre.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar insumo..." />
              </div>
              <Select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)}>
                <option value="ALL">Todo el stock</option>
                <option value="LOW">Solo alertas</option>
                <option value="NORMAL">Solo normales</option>
              </Select>
            </div>
          </div>

          <div className="hide-scrollbar max-h-[32rem] min-h-0 overflow-y-auto divide-y divide-stone-100">
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
                    <button type="button" className="text-stone-400 hover:text-red-600 transition"
                      disabled={deleteIngredient.isPending}
                      onClick={() => setConfirmDelete({ id: ingredient.id, name: ingredient.name })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {!filteredIngredients.length ? (
              <div className="p-6">
                <EmptyState
                  title="Sin insumos"
                  description="Ajusta el filtro o crea un insumo."
                />
              </div>
            ) : null}
          </div>
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
            onSubmit={(event) => {
              event.preventDefault();
              saveIngredient.mutate();
            }}
          >
            <div className="md:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">Datos base</p>
            </div>
            <Field label="Código">
              <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
            </Field>
            <Field label="Nombre">
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="Unidad">
              <Select value={form.unitId} onChange={(event) => setForm((current) => ({ ...current, unitId: event.target.value }))}>
                <option value="">Selecciona una unidad</option>
                {units.data?.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({unit.abbreviation})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Costo unitario (COP)">
              <Input type="number" value={form.costPrice} onChange={(event) => setForm((current) => ({ ...current, costPrice: event.target.value }))} />
            </Field>
            <div className="md:col-span-2 pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">Inventario</p>
            </div>
            <Field label="Stock actual">
              <Input type="number" value={form.currentStock} onChange={(event) => setForm((current) => ({ ...current, currentStock: event.target.value }))} />
            </Field>
            <Field label="Stock mínimo">
              <Input type="number" value={form.stockMin} onChange={(event) => setForm((current) => ({ ...current, stockMin: event.target.value }))} />
            </Field>
            <Field label="Stock máximo">
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
              <Button type="submit" className="flex-1" disabled={saveIngredient.isPending}>
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
    </div>
  );
}
