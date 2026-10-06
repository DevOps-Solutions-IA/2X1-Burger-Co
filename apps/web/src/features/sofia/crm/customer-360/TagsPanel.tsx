'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Tag as TagIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useSofiaCrmAssignTag, useSofiaCrmCreateTag, useSofiaCrmTags } from '@/features/sofia/queries';
import type { SofiaCrmCustomerDetail } from '@/features/sofia/contracts';
import { formatDate } from '@/lib/format';

const GLOBAL_TAGS_LIMIT = 100;

export function TagsPanel({ customer }: { customer: SofiaCrmCustomerDetail }) {
  const [selectedTagId, setSelectedTagId] = useState('');
  const [newTagName, setNewTagName] = useState('');

  const allTags = useSofiaCrmTags(1, GLOBAL_TAGS_LIMIT);
  const assignTag = useSofiaCrmAssignTag();
  const createTag = useSofiaCrmCreateTag();

  const assignedTagIds = useMemo(() => new Set(customer.tags.map((tag) => tag.id)), [customer.tags]);
  const assignableTags = useMemo(
    () => (allTags.data?.data ?? []).filter((tag) => !assignedTagIds.has(tag.id)),
    [allTags.data, assignedTagIds],
  );

  function handleAssignExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTagId) return;
    assignTag.mutate(
      { customerId: customer.id, tagId: selectedTagId },
      {
        onSuccess: () => {
          toast.success('Tag asignado');
          setSelectedTagId('');
        },
        onError: (error) => toast.error(error instanceof ApiError ? error.message : 'No se pudo asignar el tag.'),
      },
    );
  }

  function handleCreateAndAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    createTag.mutate(trimmed, {
      onSuccess: (tag) => {
        assignTag.mutate(
          { customerId: customer.id, tagId: tag.id },
          {
            onSuccess: () => {
              toast.success('Tag creado y asignado');
              setNewTagName('');
            },
            onError: (error) => toast.error(error instanceof ApiError ? error.message : 'El tag se creó pero no se pudo asignar.'),
          },
        );
      },
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'No se pudo crear el tag.'),
    });
  }

  const isAssigning = assignTag.isPending || createTag.isPending;

  return (
    <div className="space-y-3" data-testid="sofia-customer360-tags-panel">
      <Card>
        <h3 className="text-[13.5px] font-extrabold text-ink">Tags del cliente</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">Etiquetas asignadas a este cliente en el CRM.</p>

        {customer.tags.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={<TagIcon className="h-5 w-5" aria-hidden="true" />} title="Sin tags" description="Este cliente no tiene tags asignados todavía." />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {customer.tags.map((tag) => (
              <li key={tag.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                <Badge tone="neutral">{tag.name}</Badge>
                <span className="text-[11px] text-stone-600">Asignado {formatDate(tag.assignedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="sofia-customer360-tags-assign">
        <h3 className="text-[13.5px] font-extrabold text-ink">Asignar un tag existente</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">Elige un tag ya creado en el CRM para asignarlo a este cliente.</p>
        <form onSubmit={handleAssignExisting} className="mt-3 flex flex-col gap-2.5 sm:flex-row">
          <Select
            value={selectedTagId}
            onChange={(event) => setSelectedTagId(event.target.value)}
            disabled={allTags.isLoading || assignableTags.length === 0}
            data-testid="sofia-customer360-tags-select"
          >
            <option value="">
              {allTags.isLoading ? 'Cargando tags…' : assignableTags.length === 0 ? 'No hay más tags disponibles' : 'Selecciona un tag…'}
            </option>
            {assignableTags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={!selectedTagId || isAssigning} data-testid="sofia-customer360-tags-assign-submit">
            {assignTag.isPending ? 'Asignando…' : 'Asignar'}
          </Button>
        </form>
      </Card>

      <Card data-testid="sofia-customer360-tags-create">
        <h3 className="text-[13.5px] font-extrabold text-ink">Crear un tag nuevo</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">Crea un tag nuevo en el CRM y lo asigna a este cliente de una vez.</p>
        <form onSubmit={handleCreateAndAssign} className="mt-3 flex flex-col gap-2.5 sm:flex-row">
          <Input
            value={newTagName}
            onChange={(event) => setNewTagName(event.target.value)}
            placeholder="Ej: cliente-frecuente"
            data-testid="sofia-customer360-tags-create-input"
          />
          <Button type="submit" size="sm" disabled={!newTagName.trim() || isAssigning} data-testid="sofia-customer360-tags-create-submit">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {createTag.isPending ? 'Creando…' : 'Crear y asignar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
