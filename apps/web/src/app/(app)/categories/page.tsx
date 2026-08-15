'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/section-title';
import { apiFetch } from '@/lib/api';
import { matchesSearch } from '@/lib/format';
import { ConfirmDialog } from '@/components/confirm-dialog';

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

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(initialForm);

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
    <div className="space-y-6 p-6 lg:p-8">
      <SectionTitle
        eyebrow="Catálogo"
        title="Categorías"
        description="Organizá productos e insumos para mantener la carta ordenada."
        status={<Badge tone="info">{categories.data?.length ?? 0} categorías</Badge>}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSelectedCategory(null);
              setForm(initialForm);
            }}
          >
            Nueva categoría
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-3.5 border-b border-stone-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">Categorías registradas</h2>
              <p className="mt-1 text-[13px] leading-5 text-stone-500">Activa o depura la estructura del catálogo sin perder historial.</p>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar categoría..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="divide-y divide-stone-100">
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
                      <Badge tone={category.isActive ? 'success' : 'danger'}>
                        {category.isActive ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5 text-stone-500">{category.description || 'Sin descripción operativa.'}</p>
                  </div>
                </button>
                <div className="flex items-start justify-between gap-4 md:justify-end">
                  <div className="md:text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">Slug</p>
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
            {!filteredCategories.length ? (
              <div className="p-6">
                <EmptyState
                  title="Sin categorías para mostrar"
                  description="Ajusta la búsqueda o crea una categoría nueva."
                />
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
              <Tags className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold lg:text-[1.12rem]">
                {selectedCategory ? 'Editar categoría' : 'Nueva categoría'}
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                Define nombre visible, descripción y estado de uso en el sistema.
              </p>
            </div>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveCategory.mutate();
            }}
          >
            <Field label="Nombre">
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej. Hamburguesas premium"
              />
            </Field>
            <Field label="Descripción">
              <Input
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Uso comercial y operativo"
              />
            </Field>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-stone-200 bg-stone-50 px-3.5 py-3.5">
              <div>
                <p className="text-[15px] font-medium text-ink">Categoría activa</p>
                <p className="text-[13px] leading-6 text-stone-500">Las categorías inactivas se conservan pero se despriorizan en operación.</p>
              </div>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
              />
            </label>
            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={saveCategory.isPending}>
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
