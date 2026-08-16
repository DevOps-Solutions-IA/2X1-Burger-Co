'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useSofiaCrmCreateSegment } from '@/features/sofia/queries';

/** Formulario simple para crear un segmento — sin selector de miembros; la membresía se agrega después. */
export function CreateSegmentForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createSegment = useSofiaCrmCreateSegment();

  const canSubmit = name.trim().length > 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    createSegment.mutate(
      {
        name: name.trim(),
        description: description.trim().length > 0 ? description.trim() : undefined,
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Card data-testid="sofia-crm-segments-create-form">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">Nuevo segmento</h2>
          <p className="mt-0.5 text-[12px] text-stone-600">La membresía de clientes se agrega después, desde Customer 360.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} data-testid="sofia-crm-segments-create-cancel">
          Cancelar
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Nombre</label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej: Clientes frecuentes Maxy Family"
            data-testid="sofia-crm-segments-create-name"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">Descripción (opcional)</label>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Criterio o propósito del segmento…"
            data-testid="sofia-crm-segments-create-description"
          />
        </div>

        {createSegment.isError && (
          <p className="text-[12px] font-semibold text-red-700" role="alert">
            {createSegment.error instanceof ApiError ? createSegment.error.message : 'No se pudo crear el segmento.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="submit" size="sm" disabled={!canSubmit || createSegment.isPending} data-testid="sofia-crm-segments-create-submit">
            {createSegment.isPending ? 'Creando…' : 'Crear segmento'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
