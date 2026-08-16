'use client';

import { useState } from 'react';
import { ListTodo } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryStateBoundary } from '@/components/sofia';
import { useSofiaCrmTasks } from '@/features/sofia/queries';
import { CreateTaskForm } from './CreateTaskForm';
import { TaskRow } from './TaskRow';

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'OPEN', label: 'Abierta' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'TASK', label: 'Tarea' },
  { value: 'FOLLOW_UP', label: 'Seguimiento' },
];

export function TasksView() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [assignedToId, setAssignedToId] = useState('');

  const tasks = useSofiaCrmTasks({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    type: type || undefined,
    assignedToId: assignedToId.trim() || undefined,
  });

  function resetPageAnd<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div className="space-y-4" data-testid="sofia-crm-tasks-view">
      <CreateTaskForm onCreated={() => setPage(1)} />

      <Card data-testid="sofia-crm-tasks-filters">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Estado">
            <Select
              value={status}
              onChange={(event) => resetPageAnd(setStatus)(event.target.value)}
              data-testid="sofia-crm-tasks-filter-status"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tipo">
            <Select value={type} onChange={(event) => resetPageAnd(setType)(event.target.value)} data-testid="sofia-crm-tasks-filter-type">
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Asignada a (ID)" hint="Opcional.">
            <Input
              value={assignedToId}
              onChange={(event) => resetPageAnd(setAssignedToId)(event.target.value)}
              placeholder="Ej. usr_1234"
              data-testid="sofia-crm-tasks-filter-assigned-to"
            />
          </Field>
        </div>
      </Card>

      <QueryStateBoundary
        isLoading={tasks.isLoading}
        isError={tasks.isError}
        error={tasks.error}
        data={tasks.data}
        loadingLabel="Cargando tareas…"
        errorTitle="No se pudieron cargar las tareas"
        data-testid="sofia-crm-tasks-list"
      >
        {(data) =>
          data.data.length === 0 ? (
            <EmptyState
              icon={<ListTodo className="h-5 w-5" />}
              title="Sin tareas"
              description="No hay tareas registradas para estos filtros. Crea una arriba."
              data-testid="sofia-crm-tasks-empty"
            />
          ) : (
            <div className="space-y-3" data-testid="sofia-crm-tasks-rows">
              {data.data.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}

              <div className="flex items-center justify-between pt-1" data-testid="sofia-crm-tasks-pagination">
                <p className="text-[11.5px] text-stone-500">
                  Página {data.pagination.page} de {Math.max(data.pagination.pages, 1)} · {data.pagination.total} tarea(s)
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                    data-testid="sofia-crm-tasks-page-prev"
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page >= data.pagination.pages}
                    onClick={() => setPage((prev) => prev + 1)}
                    data-testid="sofia-crm-tasks-page-next"
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </div>
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
