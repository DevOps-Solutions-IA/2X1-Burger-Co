'use client';

import { useState, type FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { useSofiaCrmCreateCampaign, useSofiaCrmSegments } from '@/features/sofia/queries';
import { ApiError } from '@/lib/api';

/** Crea una campaña en estado borrador. Nunca envía WhatsApp real — el envío queda siempre bloqueado por diseño. */
export function CreateCampaignForm({ onCreated }: { onCreated?: () => void }) {
  const segments = useSofiaCrmSegments(1, 100);
  const createCampaign = useSofiaCrmCreateCampaign();

  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!name.trim() || !messageTemplate.trim()) {
      setFormError('Nombre y plantilla de mensaje son obligatorios.');
      return;
    }

    createCampaign.mutate(
      {
        name: name.trim(),
        segmentId: segmentId || undefined,
        messageTemplate: messageTemplate.trim(),
      },
      {
        onSuccess: () => {
          setName('');
          setSegmentId('');
          setMessageTemplate('');
          onCreated?.();
        },
      },
    );
  }

  return (
    <Card data-testid="sofia-crm-campaigns-create-form">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700" aria-hidden="true">
          <Sparkles className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">Nueva campaña</p>
          <h2 className="text-[1.05rem] font-bold leading-tight text-ink">Crear campaña de WhatsApp</h2>
        </div>
      </div>
      <p className="mt-2.5 text-[12.5px] leading-5.5 text-stone-600">
        La campaña se crea en estado borrador. El envío real de WhatsApp está siempre bloqueado por diseño en todo el sistema.
      </p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
        <Field label="Nombre de la campaña" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej. Reactivación clientes inactivos"
            data-testid="sofia-crm-campaigns-input-name"
          />
        </Field>

        <Field label="Segmento" hint="Opcional. Si no seleccionas uno, la campaña queda sin segmento asociado.">
          <Select
            value={segmentId}
            onChange={(event) => setSegmentId(event.target.value)}
            data-testid="sofia-crm-campaigns-select-segment"
          >
            <option value="">Sin segmento</option>
            {segments.data?.data.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Plantilla de mensaje" required hint="Este texto queda registrado como intento de envío; nunca se despacha realmente.">
          <Textarea
            value={messageTemplate}
            onChange={(event) => setMessageTemplate(event.target.value)}
            placeholder="Ej. Hola {{nombre}}, tenemos una promoción especial para ti…"
            rows={4}
            data-testid="sofia-crm-campaigns-textarea-template"
          />
        </Field>

        {formError ? (
          <div data-testid="sofia-crm-campaigns-form-error">
            <StatusBanner tone="danger" title="Revisa el formulario" description={formError} />
          </div>
        ) : null}

        {createCampaign.isError ? (
          <div data-testid="sofia-crm-campaigns-create-error">
            <StatusBanner
              tone="danger"
              title="No se pudo crear la campaña"
              description={createCampaign.error instanceof ApiError ? createCampaign.error.message : 'Ocurrió un error inesperado.'}
            />
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={createCampaign.isPending} data-testid="sofia-crm-campaigns-submit">
            {createCampaign.isPending ? 'Creando…' : 'Crear campaña'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
