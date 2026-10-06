'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDot, Filter, ListTodo } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryStateBoundary, StatCard, Pager } from '@/components/sofia';
import { useSofiaCrmTasks } from '@/features/sofia/queries';
import type { SofiaCrmTask } from '@/features/sofia/contracts';
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

function isOverdue(task: SofiaCrmTask): boolean {
  if (!task.dueAt) return false;
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

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

  const pageItems = tasks.data?.data ?? [];
  const overdueOnPage = pageItems.filter(isOverdue).length;
  const openOnPage = pageItems.filter((task) => task.status === 'OPEN').length;
  const completedOnPage = pageItems.filter((task) => task.status === 'COMPLETED').length;

  return (
    <div className="space-y-5" data-testid="sofia-crm-tasks-view">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Tareas totales"
          value={String(tasks.data?.pagination.total ?? 0)}
          icon={<ListTodo className="h-4.5 w-4.5" />}
          accent="brand"
          data-testid="sofia-crm-tasks-stat-total"
        />
        <StatCard
          label="Vencidas en esta página"
          value={String(overdueOnPage)}
          hint="dueAt pasado y sin cerrar"
          icon={<AlertTriangle className="h-4.5 w-4.5" />}
          accent="warning"
          data-testid="sofia-crm-tasks-stat-overdue"
        />
        <StatCard
          label="Abiertas en esta página"
          value={String(openOnPage)}
          icon={<CircleDot className="h-4.5 w-4.5" />}
          accent="ink"
          data-testid="sofia-crm-tasks-stat-open"
        />
        <StatCard
          label="Completadas en esta página"
          value={String(completedOnPage)}
          icon={<CheckCircle2 className="h-4.5 w-4.5" />}
          accent="success"
          data-testid="sofia-crm-tasks-stat-completed"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="min-w-0 space-y-4 lg:col-span-8">
          <Card data-testid="sofia-crm-tasks-filters">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              Filtros
            </div>
            <div className="mt-2.5 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                  description="No hay tareas registradas para estos filtros. Crea la primera desde el formulario."
                  data-testid="sofia-crm-tasks-empty"
                />
              ) : (
                <div className="space-y-3" data-testid="sofia-crm-tasks-rows">
                  {data.data.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}

                  <Pager
                    page={data.pagination.page}
                    limit={data.pagination.limit}
                    total={data.pagination.total}
                    pages={data.pagination.pages}
                    itemsLabel="tarea(s)"
                    onPrev={() => setPage((prev) => Math.max(prev - 1, 1))}
                    onNext={() => setPage((prev) => prev + 1)}
                    data-testid="sofia-crm-tasks-pagination"
                  />
                </div>
              )
            }
          </QueryStateBoundary>
        </div>

        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-4">
            <CreateTaskForm onCreated={() => setPage(1)} />
          </div>
        </div>
      </div>
    </div>
  );
}
