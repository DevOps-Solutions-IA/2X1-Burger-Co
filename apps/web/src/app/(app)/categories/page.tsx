'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FilterBar } from '@/components/product/filter-bar';
import { ModuleTabs } from '@/components/product/module-tabs';
import { PageHeader } from '@/components/product/page-header';
import { QueryState } from '@/components/product/query-state';
import { StatusBadge } from '@/components/product/status-badge';
import { apiFetch } from '@/lib/api';
import { matchesSearch } from '@/lib/format';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { focusFirstInvalidField } from '@/lib/form-accessibility';

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
};

const initialForm = {
  name: '',
  description: '',
  isActive: true,
};

const catalogTabs = [
  { id: 'products', label: 'Productos', href: '/products' },
  { id: 'ingredients', label: 'Insumos', href: '/ingredients' },
  { id: 'categories', label: 'Categorías', href: '/categories', active: true },
  { id: 'recipes', label: 'Recetas', href: '/recipes' },
] as const;

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(initialForm);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const formErrors = useMemo(() => {
    const errors: { name?: string; description?: string } = {};
    if (!form.name.trim()) errors.name = 'El nombre es obligatorio.';
    if (form.name.trim().length > 100) errors.name = 'Usa máximo 100 caracteres.';
    if (form.description.length > 300) errors.description = 'Usa máximo 300 caracteres.';
    return errors;
  }, [form]);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });

  const filteredCategories = useMemo(
    () =>
      (categories.data ?? []).filter((category) =>
        matchesSearch([category.name, category.slug, category.description], search),
      ),
    [categories.data, search],
  );

  const saveCategory = useMutation({
    mutationFn: async () => {
      if (Object.keys(formErrors).length > 0) throw new Error('Corrige los campos marcados antes de guardar.');
      if (selectedCategory) {
        return apiFetch(`/categories/${selectedCategory.id}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
      }

      return apiFetch('/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          description: form.description,
        }),
      });
    },
    onSuccess: async () => {
      toast.success(selectedCategory ? 'Categoría actualizada' : 'Categoría creada');
      setSelectedCategory(null);
      setForm(initialForm);
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible guardar la categoría'),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/categories/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast.success('Categoría desactivada');
      setSelectedCategory(null);
      setForm(initialForm);
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No fue posible desactivar la categoría'),
  });

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8" data-testid="categories-page">
      <PageHeader
        eyebrow="Catálogo operativo"
        title="Categorías"
        description="Ordena la carta sin perder la relación histórica de productos, recetas e inventario."
        status={categories.data && !categories.isError
          ? <StatusBadge status="ACTIVE" label={`${categories.data.length} categorías`} />
          : <StatusBadge status="UNKNOWN" label="Categorías sin verificar" tone="neutral" />}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSelectedCategory(null);
              setForm(initialForm);
              setSubmitAttempted(false);
            }}
          >
            Nueva categoría
          </Button>
        }
      />

      <ModuleTabs items={catalogTabs} label="Administración de catálogo" />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden p-0">
          <div className="space-y-4 border-b border-line px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">Categorías registradas</h2>
              <p className="mt-1 text-[13px] leading-5 text-stone-600">Activa o depura la estructura del catálogo sin perder historial.</p>
            </div>
            <FilterBar density="compact" activeCount={Number(Boolean(search.trim()))} search={<div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <Input
                aria-label="Buscar categorías"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar categoría..."
                className="pl-9"
              />
            </div>} actions={<Button type="button" variant="ghost" onClick={() => setSearch('')}>Limpiar</Button>} />
          </div>

          <QueryState
            status={categories.isLoading ? 'loading' : categories.isError ? 'error' : filteredCategories.length === 0 ? 'empty' : 'ready'}
            title={categories.isError ? 'No pudimos cargar las categorías' : 'Sin categorías para mostrar'}
            description={categories.isError ? 'La estructura real del catálogo no está disponible.' : 'Ajusta la búsqueda o crea una categoría autorizada.'}
            onRetry={categories.isError ? () => void categories.refetch() : undefined}
            action={!categories.isError ? <Button type="button" variant="secondary" onClick={() => setSearch('')}>Restablecer búsqueda</Button> : undefined}
            className="m-4"
          >
          <div className="divide-y divide-line">
            {filteredCategories.map((category) => (
              <div key={category.id} className="grid gap-3 px-5 py-3.5 transition hover:bg-stone-50/80 md:grid-cols-[1fr_auto]">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setSelectedCategory(category);
                    setForm({
                      name: category.name,
                      description: category.description ?? '',
                      isActive: category.isActive,
                    });
                  }}
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <p className="text-[15px] font-semibold text-ink">{category.name}</p>
                      <StatusBadge status={category.isActive ? 'ACTIVE' : 'INACTIVE'} label={category.isActive ? 'Activa' : 'Inactiva'} tone={category.isActive ? 'success' : 'neutral'} />
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5 text-stone-600">{category.description || 'Sin descripción operativa.'}</p>
                  </div>
                </button>
                <div className="flex items-start justify-between gap-4 md:justify-end">
                  <div className="md:text-right">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-stone-600">Slug</p>
                    <p className="mt-1 text-[12px] font-medium text-stone-700">{category.slug}</p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={deleteCategory.isPending}
                    onClick={() => setConfirmDelete({ id: category.id, name: category.name })}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Eliminar
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </QueryState>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-900">
              <Tags className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">
                {selectedCategory ? 'Editar categoría' : 'Nueva categoría'}
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                Define nombre visible, descripción y estado de uso en el sistema.
              </p>
            </div>
          </div>

          <form
            className="mt-6 space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitAttempted(true);
              if (Object.keys(formErrors).length > 0) {
                focusFirstInvalidField(event.currentTarget);
                return;
              }
              saveCategory.mutate();
            }}
          >
            <Field label="Nombre" error={submitAttempted ? formErrors.name : null} required>
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej. Hamburguesas premium"
              />
            </Field>
            <Field label="Descripción" error={submitAttempted ? formErrors.description : null}>
              <Input
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Uso comercial y operativo"
              />
            </Field>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-stone-200 bg-stone-50 px-3.5 py-3.5">
              <div>
                <p className="text-[15px] font-medium text-ink">Categoría activa</p>
                <p className="text-[13px] leading-6 text-stone-600">Las categorías inactivas se conservan pero se despriorizan en operación.</p>
              </div>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
              />
            </label>
            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={saveCategory.isPending || (submitAttempted && Object.keys(formErrors).length > 0)}>
                {saveCategory.isPending ? 'Guardando categoría...' : selectedCategory ? 'Guardar cambios de la categoría' : 'Crear categoría'}
              </Button>
              {selectedCategory ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deleteCategory.isPending}
                  onClick={() => setConfirmDelete({ id: selectedCategory.id, name: selectedCategory.name })}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Eliminar
                </Button>
              ) : null}
              {selectedCategory ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSelectedCategory(null);
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
          title="Desactivar categoria"
          message={`¿Desactivar ${confirmDelete.name}? Las categorias desactivadas no apareceran en los catalogos activos.`}
          confirmLabel="Desactivar"
          cancelLabel="Cancelar"
          destructive
          onConfirm={() => {
            deleteCategory.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}
