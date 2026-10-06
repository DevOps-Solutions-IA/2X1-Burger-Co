'use client';

import { useState, type FormEvent } from 'react';
import { ListPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { useSofiaCrmCreateTask } from '@/features/sofia/queries';
import { ApiError } from '@/lib/api';

const TYPE_OPTIONS: { value: 'TASK' | 'FOLLOW_UP'; label: string }[] = [
  { value: 'TASK', label: 'Tarea' },
  { value: 'FOLLOW_UP', label: 'Seguimiento' },
];

const PRIORITY_OPTIONS: { value: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; label: string }[] = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'URGENT', label: 'Urgente' },
];

export function CreateTaskForm({ onCreated }: { onCreated?: () => void }) {
  const createTask = useSofiaCrmCreateTask();

  const [customerId, setCustomerId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [type, setType] = useState<'TASK' | 'FOLLOW_UP'>('TASK');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!customerId.trim() || !title.trim()) {
      setFormError('El ID del cliente y el título son obligatorios.');
      return;
    }

    createTask.mutate(
      {
        customerId: customerId.trim(),
        leadId: leadId.trim() || undefined,
        source: 'sofia_crm_manual',
        sourceReference: `crm-ui-${Date.now()}`,
        type,
        priority,
        title: title.trim(),
        description: description.trim() || undefined,
        assignedToId: assignedToId.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          setCustomerId('');
          setLeadId('');
          setType('TASK');
          setPriority('MEDIUM');
          setTitle('');
          setDescription('');
          setAssignedToId('');
          setDueAt('');
          onCreated?.();
        },
      },
    );
  }

  return (
    <Card data-testid="sofia-crm-tasks-create-form">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700" aria-hidden="true">
          <ListPlus className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">Nueva tarea</p>
          <h2 className="text-[1.05rem] font-bold leading-tight text-ink">Crear tarea o seguimiento</h2>
        </div>
      </div>
      <p className="mt-2.5 text-[12.5px] leading-5.5 text-stone-600">
        Necesitas el ID real de un cliente existente — consulta el directorio de clientes si no lo tienes a mano.
      </p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ID del cliente" required hint="ID exacto del cliente en el sistema.">
            <Input
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              placeholder="Ej. cst_a1b2c3"
              data-testid="sofia-crm-tasks-input-customer-id"
            />
          </Field>

          <Field label="ID del lead" hint="Opcional. Vincula la tarea a un lead del pipeline.">
            <Input
              value={leadId}
              onChange={(event) => setLeadId(event.target.value)}
              placeholder="Ej. lead_x9y8z7"
              data-testid="sofia-crm-tasks-input-lead-id"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={type} onChange={(event) => setType(event.target.value as 'TASK' | 'FOLLOW_UP')} data-testid="sofia-crm-tasks-select-type">
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Prioridad">
            <Select
              value={priority}
              onChange={(event) => setPriority(event.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')}
              data-testid="sofia-crm-tasks-select-priority"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Título" required>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej. Confirmar dirección de entrega"
            data-testid="sofia-crm-tasks-input-title"
          />
        </Field>

        <Field label="Descripción" hint="Opcional.">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Detalle interno del seguimiento…"
            rows={3}
            data-testid="sofia-crm-tasks-textarea-description"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Asignar a (ID)" hint="Opcional. ID del usuario responsable.">
            <Input
              value={assignedToId}
              onChange={(event) => setAssignedToId(event.target.value)}
              placeholder="Ej. usr_1234"
              data-testid="sofia-crm-tasks-input-assigned-to"
            />
          </Field>

          <Field label="Vence" hint="Opcional.">
            <Input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              data-testid="sofia-crm-tasks-input-due-at"
            />
          </Field>
        </div>

        {formError ? (
          <div data-testid="sofia-crm-tasks-form-error">
            <StatusBanner tone="danger" title="Revisa el formulario" description={formError} />
          </div>
        ) : null}

        {createTask.isError ? (
          <div data-testid="sofia-crm-tasks-create-error">
            <StatusBanner
              tone="danger"
              title="No se pudo crear la tarea"
              description={createTask.error instanceof ApiError ? createTask.error.message : 'Ocurrió un error inesperado.'}
            />
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={createTask.isPending} data-testid="sofia-crm-tasks-submit">
            {createTask.isPending ? 'Creando…' : 'Crear tarea'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
