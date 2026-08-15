'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/section-title';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';

type RecipeRow = { ingredientId: string; quantity: string };

type Product = {
  id: string;
  name: string;
  kind: 'PREPARED' | 'DIRECT_STOCK';
};

type Ingredient = {
  id: string;
  name: string;
  unit: { name: string };
};

type Recipe = {
  id: string;
  items: Array<{
    id: string;
    ingredientId: string;
    quantity: number | string;
    ingredient: Ingredient;
  }>;
};

export default function RecipesPage() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<RecipeRow[]>([{ ingredientId: '', quantity: '1' }]);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const formErrors = useMemo(() => {
    const errors: { productId?: string; rows?: Record<number, { ingredientId?: string; quantity?: string }> } = {};
    if (!productId) errors.productId = 'Selecciona un producto preparado.';
    const rowErrors: Record<number, { ingredientId?: string; quantity?: string }> = {};
    const selectedIngredients = new Set<string>();
    rows.forEach((row, i) => {
      const re: { ingredientId?: string; quantity?: string } = {};
      const quantity = Number(row.quantity);
      if (!row.ingredientId) {
        re.ingredientId = 'Selecciona un insumo.';
      } else if (selectedIngredients.has(row.ingredientId)) {
        re.ingredientId = 'Este insumo ya está en la receta.';
      } else {
        selectedIngredients.add(row.ingredientId);
      }
      if (!row.quantity || !Number.isFinite(quantity) || quantity <= 0) {
        re.quantity = 'La cantidad debe ser mayor a 0.';
      }
      if (Object.keys(re).length > 0) rowErrors[i] = re;
    });
    if (Object.keys(rowErrors).length > 0) errors.rows = rowErrors;
    return errors;
  }, [productId, rows]);

  const isFormValid = !formErrors.productId && !formErrors.rows;

  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<Product[]>('/products'),
  });
  const ingredients = useQuery({
    queryKey: ['ingredients'],
    queryFn: () => apiFetch<Ingredient[]>('/ingredients'),
  });
  const recipe = useQuery({
    queryKey: ['recipe', productId],
    queryFn: () => apiFetch<Recipe | null>(`/recipes/${productId}`),
    enabled: Boolean(productId),
  });

  useEffect(() => {
    if (recipe.data?.items?.length) {
      setRows(
        recipe.data.items.map((item) => ({
          ingredientId: item.ingredientId,
          quantity: String(Number(item.quantity)),
        })),
      );
      return;
    }

    setRows([{ ingredientId: '', quantity: '1' }]);
  }, [recipe.data]);

  const saveRecipe = useMutation({
    mutationFn: () =>
      apiFetch<Recipe>(`/recipes/${productId}`, {
        method: 'PUT',
        body: JSON.stringify({
          items: rows.map((row) => ({
            ingredientId: row.ingredientId,
            quantity: Number(row.quantity),
          })),
        }),
      }),
    onSuccess: async () => {
      toast.success('Receta guardada');
      await queryClient.invalidateQueries({ queryKey: ['recipe', productId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible guardar la receta'),
  });

  const preparedProducts = (products.data ?? []).filter((product) => product.kind === 'PREPARED');
  const catalogLoading = products.isLoading || ingredients.isLoading;

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <SectionTitle
        eyebrow="Producción"
        title="Recetas — El secreto de cada plato"
        description="Define qué insumos lleva cada producto preparado."
        status={<Badge tone="info">{preparedProducts.length} configurables</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <div className="rounded-[1.5rem] border border-brand-100 bg-brand-50/45 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700">Producto base</p>
            <p className="mt-2 text-[13px] leading-6 text-stone-600">Selecciona un producto preparado y define exactamente qué insumos consume por venta.</p>
          </div>

          <div className="mt-5">
            <Field label="Producto preparado" error={submitAttempted ? formErrors.productId : null} required>
              <Select value={productId} disabled={products.isLoading} onChange={(event) => { setProductId(event.target.value); setSubmitAttempted(false); }}>
                <option value="">Selecciona producto</option>
                {preparedProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {productId ? (
            <form
              className="mt-6 space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitAttempted(true);
                if (!isFormValid) return;
                saveRecipe.mutate();
              }}
            >
              {rows.map((row, index) => (
                <div key={`${index}-${row.ingredientId}`} className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Badge tone="default">Insumo {index + 1}</Badge>
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 text-[13px] font-medium text-danger"
                        onClick={() => setRows((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar línea
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                    <Field label="Insumo" error={submitAttempted && formErrors.rows?.[index]?.ingredientId ? formErrors.rows[index].ingredientId : null} required>
                      <Select
                        value={row.ingredientId}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, ingredientId: event.target.value } : entry,
                            ),
                          )
                        }
                      >
                        <option value="">Selecciona insumo</option>
                        {ingredients.data?.map((ingredient) => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Cantidad" error={submitAttempted && formErrors.rows?.[index]?.quantity ? formErrors.rows[index].quantity : null} required>
                      <Input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={row.quantity}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, quantity: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                </div>
              ))}

              <div className="flex gap-3">
                <Button type="button" variant="secondary" disabled={ingredients.isLoading} onClick={() => setRows((current) => [...current, { ingredientId: '', quantity: '1' }])}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar insumo
                </Button>
                <Button type="submit" className="flex-1" disabled={catalogLoading || saveRecipe.isPending || (submitAttempted && !isFormValid)}>
                  {saveRecipe.isPending ? 'Guardando receta...' : 'Guardar receta'}
                </Button>
              </div>
            </form>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold lg:text-[1.12rem]">Resumen actual</h2>
          <p className="mt-1 text-sm text-stone-500">Lectura clara de la receta activa del producto seleccionado.</p>

          <div className="mt-6 space-y-3">
            {recipe.isLoading || (productId && recipe.isFetching) ? Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            )) : null}
            {!recipe.isLoading && !recipe.isFetching && recipe.data?.items?.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-2xl bg-stone-50 px-4 py-3">
                  <div>
                    <p className="font-semibold">{item.ingredient.name}</p>
                    <p className="text-[13px] text-stone-500">{item.ingredient.unit.name}</p>
                  </div>
                  <p className="text-[13px] font-medium">{Number(item.quantity).toLocaleString('es-CO')}</p>
                </div>
            ))}
            {!recipe.isLoading && !recipe.isFetching && !recipe.data?.items?.length ? (
              <EmptyState
                title={productId ? 'Sin receta registrada' : 'Selecciona un producto preparado'}
                description={productId ? 'Agrega insumos y cantidades para activar el consumo automático.' : 'Aquí podrás crear o ajustar su receta.'}
              />
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
