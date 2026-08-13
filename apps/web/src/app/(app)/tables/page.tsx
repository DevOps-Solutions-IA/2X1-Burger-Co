'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Armchair, CheckCircle2, CircleDashed, MapPinned, Plus, ReceiptText, ShieldAlert, Trash2, Users, UtensilsCrossed } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetricSurface, PageHeader, QueryState } from '@/components/product';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/format';
import { getOperationalOrderDisplayCode } from '@/lib/order-display';
import { visiblePolling } from '@/lib/query-policy';

type TableStatus = 'FREE' | 'OCCUPIED' | 'RESERVED' | 'PAYMENT_PENDING' | 'OUT_OF_SERVICE';

type DiningTable = {
  id: string;
  label: string;
  area: string | null;
  groupId?: string | null;
  group?: {
    id: string;
    name: string;
    area: string | null;
    color: string | null;
    isActive: boolean;
  } | null;
  capacity: number;
  status: TableStatus;
  isActive: boolean;
  notes: string | null;
  orderTickets: Array<{
    id: string;
    number: string;
    status: string;
    type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER';
    customerName: string | null;
    waiterNameSnapshot?: string | null;
    waiterAccessNameSnapshot?: string | null;
    assignedWaiter?: {
      id: string;
      fullName: string;
      accessName?: string | null;
    } | null;
    subtotal: number | string;
    items: Array<{
      id: string;
      quantity: number | string;
      product: {
        name: string;
      };
    }>;
  }>;
};

type TableForm = {
  label: string;
  area: string;
  groupId: string;
  capacity: string;
  status: 'FREE' | 'RESERVED' | 'OUT_OF_SERVICE';
  notes: string;
};

type TableGroup = {
  id: string;
  name: string;
  description: string | null;
  area: string | null;
  color: string | null;
  isActive: boolean;
  tables: Array<{ id: string; label: string; isActive: boolean; status: TableStatus }>;
  assignments: Array<{
    id: string;
    waiter: { id: string; fullName: string; accessName: string | null; isActive: boolean };
  }>;
};

type WaiterAssignment = {
  id: string;
  scope: 'GROUP' | 'TABLE';
  waiterId: string;
  tableGroupId?: string | null;
  tableId?: string | null;
  isActive: boolean;
  waiter: { id: string; fullName: string; accessName: string | null; isActive: boolean };
  table?: { id: string; label: string } | null;
  tableGroup?: { id: string; name: string } | null;
};

type UserSummary = {
  id: string;
  fullName: string;
  isActive: boolean;
  roles: Array<{ id: string; name: string }>;
};

const defaultForm: TableForm = {
  label: '',
  area: '',
  groupId: '',
  capacity: '4',
  status: 'FREE',
  notes: '',
};

const defaultGroupForm = {
  name: '',
  area: '',
  description: '',
  waiterId: '',
};

const defaultGroupEditForm = {
  name: '',
  area: '',
  description: '',
  color: '',
  waiterId: '',
  isActive: true,
};

export default function TablesPage() {
  const queryClient = useQueryClient();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [form, setForm] = useState<TableForm>(defaultForm);
  const [groupForm, setGroupForm] = useState(defaultGroupForm);
  const [groupEditForm, setGroupEditForm] = useState(defaultGroupEditForm);
  const [groupEditTableIds, setGroupEditTableIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: () => apiFetch<DiningTable[]>('/tables'),
    refetchInterval: visiblePolling(4_000),
    refetchIntervalInBackground: false,
  });
  const tableGroups = useQuery({
    queryKey: ['table-groups'],
    queryFn: () => apiFetch<TableGroup[]>('/table-groups'),
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<UserSummary[]>('/users'),
  });
  const waiterAssignments = useQuery({
    queryKey: ['waiter-assignments'],
    queryFn: () => apiFetch<WaiterAssignment[]>('/waiter-assignments'),
  });

  const metrics = useMemo(() => {
    const data = tables.data ?? [];
    return {
      total: data.length,
      free: data.filter((table) => table.status === 'FREE' && table.isActive).length,
      occupied: data.filter((table) => ['OCCUPIED', 'PAYMENT_PENDING'].includes(table.status)).length,
      unavailable: data.filter((table) => !table.isActive || table.status === 'OUT_OF_SERVICE').length,
    };
  }, [tables.data]);

  const selectedTable = useMemo(
    () => (tables.data ?? []).find((table) => table.id === selectedTableId) ?? null,
    [tables.data, selectedTableId],
  );

  const orderedTables = useMemo(() => {
    const data = [...(tables.data ?? [])];
    return data.sort(compareTablesForMap);
  }, [tables.data]);

  const upsertTable = useMutation({
    mutationFn: () =>
      apiFetch(selectedTable ? `/tables/${selectedTable.id}` : '/tables', {
        method: selectedTable ? 'PATCH' : 'POST',
        body: JSON.stringify({
          label: form.label,
          area: form.area,
          groupId: form.groupId || undefined,
          capacity: Number(form.capacity),
          status: form.status,
          notes: form.notes,
          isActive: true,
        }),
      }),
    onSuccess: async () => {
      toast.success(selectedTable ? 'Mesa actualizada correctamente' : 'Mesa creada correctamente');
      setSelectedTableId(null);
      setForm(defaultForm);
      await queryClient.invalidateQueries({ queryKey: ['tables'] });
      await queryClient.invalidateQueries({ queryKey: ['table-groups'] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos guardar la mesa. Revisa los datos e intenta de nuevo.'),
  });

  const startEdit = (table: DiningTable) => {
    setSelectedTableId(table.id);
    setForm({
      label: table.label,
      area: table.area ?? '',
      groupId: table.groupId ?? '',
      capacity: String(table.capacity),
      status:
        table.status === 'OCCUPIED' || table.status === 'PAYMENT_PENDING'
          ? 'FREE'
          : table.status,
      notes: table.notes ?? '',
    });
  };

  const activeGroups = useMemo(
    () => (tableGroups.data ?? []).filter((group) => group.isActive),
    [tableGroups.data],
  );

  const waiters = useMemo(
    () =>
      (users.data ?? []).filter(
        (user) => user.isActive && user.roles.some((role) => role.name === 'waiter'),
      ),
    [users.data],
  );

  const selectedGroup = useMemo(
    () => activeGroups.find((group) => group.id === selectedGroupId) ?? activeGroups[0] ?? null,
    [activeGroups, selectedGroupId],
  );

  useEffect(() => {
    if (!selectedGroup) {
      setGroupEditForm(defaultGroupEditForm);
      setGroupEditTableIds([]);
      return;
    }

    setGroupEditForm({
      name: selectedGroup.name,
      area: selectedGroup.area ?? '',
      description: selectedGroup.description ?? '',
      color: selectedGroup.color ?? '',
      waiterId: selectedGroup.assignments[0]?.waiter.id ?? '',
      isActive: selectedGroup.isActive,
    });
    setGroupEditTableIds(selectedGroup.tables.map((table) => table.id));
  }, [selectedGroup]);

  const activeTables = useMemo(
    () => (tables.data ?? []).filter((table) => table.isActive && table.status !== 'OUT_OF_SERVICE'),
    [tables.data],
  );

  const activeDirectAssignmentsByTableId = useMemo(() => {
    const map = new Map<string, WaiterAssignment>();
    for (const assignment of waiterAssignments.data ?? []) {
      if (assignment.scope === 'TABLE' && assignment.isActive && assignment.tableId) {
        map.set(assignment.tableId, assignment);
      }
    }
    return map;
  }, [waiterAssignments.data]);

  const invalidateTableAssignmentData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['table-groups'] }),
      queryClient.invalidateQueries({ queryKey: ['waiter-assignments'] }),
      queryClient.invalidateQueries({ queryKey: ['waiter-tables'] }),
      queryClient.invalidateQueries({ queryKey: ['active-orders'] }),
    ]);
  };

  const deleteSelectedTable = useMutation({
    mutationFn: async () => {
      if (!selectedTable) {
        throw new Error('Selecciona una mesa para eliminar.');
      }
      if (
        !window.confirm(
          `¿Eliminar ${selectedTable.label}? La mesa se eliminará de forma definitiva aunque tenga historial cerrado. Las comandas y ventas históricas se conservan sin mesa asociada.`,
        )
      ) {
        return { success: false };
      }
      return apiFetch(`/tables/${selectedTable.id}`, { method: 'DELETE' });
    },
    onSuccess: async (result) => {
      if (result && typeof result === 'object' && 'success' in result && !result.success) {
        return;
      }
      toast.success('Mesa eliminada correctamente');
      setSelectedTableId(null);
      setForm(defaultForm);
      await invalidateTableAssignmentData();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos eliminar la mesa.'),
  });

  const deleteSelectedGroup = useMutation({
    mutationFn: async () => {
      if (!selectedGroup) {
        throw new Error('Selecciona un grupo para eliminar.');
      }
      if (
        !window.confirm(
          `¿Eliminar ${selectedGroup.name}? El grupo se eliminará de forma definitiva. Las mesas no se borran; quedarán sin grupo asignado.`,
        )
      ) {
        return { success: false };
      }
      return apiFetch(`/table-groups/${selectedGroup.id}`, { method: 'DELETE' });
    },
    onSuccess: async (result) => {
      if (result && typeof result === 'object' && 'success' in result && !result.success) {
        return;
      }
      toast.success('Grupo eliminado de la operación');
      setSelectedGroupId('');
      setGroupEditForm(defaultGroupEditForm);
      setGroupEditTableIds([]);
      await invalidateTableAssignmentData();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos eliminar el grupo.'),
  });

  const createGroup = useMutation({
    mutationFn: () =>
      apiFetch<TableGroup>('/table-groups', {
        method: 'POST',
        body: JSON.stringify({
          name: groupForm.name,
          area: groupForm.area || undefined,
          description: groupForm.description || undefined,
        }),
      }),
    onSuccess: async (group) => {
      toast.success('Grupo de mesas creado correctamente');
      setGroupForm((current) => ({ ...current, name: '', area: '', description: '' }));
      setSelectedGroupId(group.id);
      await invalidateTableAssignmentData();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos crear el grupo de mesas.'),
  });

  const assignWaiterToGroup = useMutation({
    mutationFn: () =>
      apiFetch('/waiter-assignments', {
        method: 'POST',
        body: JSON.stringify({
          waiterId: groupForm.waiterId,
          scope: 'GROUP',
          tableGroupId: selectedGroup?.id,
        }),
      }),
    onSuccess: async () => {
      toast.success('Mesero asignado al grupo');
      setGroupForm((current) => ({ ...current, waiterId: '' }));
      await invalidateTableAssignmentData();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos asignar el mesero.'),
  });

  const updateSelectedGroup = useMutation({
    mutationFn: async () => {
      if (!selectedGroup) {
        throw new Error('Selecciona un grupo para editar.');
      }

      const currentWaiterId = selectedGroup.assignments[0]?.waiter.id ?? '';
      const nextWaiter = waiters.find((waiter) => waiter.id === groupEditForm.waiterId);
      const currentWaiter = waiters.find((waiter) => waiter.id === currentWaiterId);
      if (
        currentWaiterId &&
        groupEditForm.waiterId &&
        currentWaiterId !== groupEditForm.waiterId &&
        !window.confirm(
          `Este grupo pasará de ${currentWaiter?.fullName ?? 'el responsable actual'} a ${nextWaiter?.fullName ?? 'el nuevo responsable'}. ${currentWaiter?.fullName ?? 'El responsable actual'} dejará de ver estas mesas.`,
        )
      ) {
        return selectedGroup;
      }

      const updated = await apiFetch<TableGroup>(`/table-groups/${selectedGroup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: groupEditForm.name,
          area: groupEditForm.area || undefined,
          description: groupEditForm.description || undefined,
          color: groupEditForm.color || undefined,
          isActive: groupEditForm.isActive,
        }),
      });

      const previousTableIds = new Set(selectedGroup.tables.map((table) => table.id));
      const nextTableIds = new Set(groupEditTableIds);
      const tablesToAdd = [...nextTableIds].filter((tableId) => !previousTableIds.has(tableId));
      const tablesToRemove = [...previousTableIds].filter((tableId) => !nextTableIds.has(tableId));

      await Promise.all([
        ...tablesToAdd.map((tableId) =>
          apiFetch(`/table-groups/${selectedGroup.id}/tables`, {
            method: 'POST',
            body: JSON.stringify({ tableId }),
          }),
        ),
        ...tablesToRemove.map((tableId) =>
          apiFetch(`/table-groups/${selectedGroup.id}/tables/${tableId}`, {
            method: 'DELETE',
          }),
        ),
      ]);

      if (groupEditForm.waiterId && groupEditForm.waiterId !== currentWaiterId) {
        await apiFetch('/waiter-assignments', {
          method: 'POST',
          body: JSON.stringify({
            waiterId: groupEditForm.waiterId,
            scope: 'GROUP',
            tableGroupId: selectedGroup.id,
          }),
        });
      }

      return updated;
    },
    onSuccess: async () => {
      toast.success('Grupo actualizado correctamente');
      await invalidateTableAssignmentData();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos actualizar el grupo.'),
  });

  const assignTableDirectly = useMutation({
    mutationFn: ({ tableId, waiterId }: { tableId: string; waiterId: string }) =>
      apiFetch('/waiter-assignments', {
        method: 'POST',
        body: JSON.stringify({
          waiterId,
          scope: 'TABLE',
          tableId,
        }),
      }),
    onSuccess: async () => {
      toast.success('Asignación directa actualizada');
      await invalidateTableAssignmentData();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos asignar la mesa.'),
  });

  return (
    <div className="space-y-6" data-testid="tables-page">
      <PageHeader
        eyebrow="Operación de salón"
        title="Mesas y servicio"
        description="Gestiona disponibilidad, comandas y responsables sin perder el estado real del salón."
        status={tables.data ? <Badge tone="info">{metrics.occupied} con servicio</Badge> : undefined}
        actions={
          <Button type="button" variant="secondary" onClick={() => { setSelectedTableId(null); setForm(defaultForm); }} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Nueva mesa
          </Button>
        }
      />

      {tables.isSuccess && !metrics.total ? (
        <StatusBanner
          tone="info"
          title="Todavía no hay mesas configuradas"
          description="Cuando tengas mesas configuradas, las vas a ver acá listas para operar."
        />
      ) : null}

      {tableGroups.isError || users.isError || waiterAssignments.isError ? (
        <div className="space-y-3" role="alert">
          <StatusBanner
            tone="warning"
            title="Parte de la configuración del salón no está disponible"
            description="Las mesas siguen visibles, pero grupos o responsables podrían estar incompletos. No asumimos valores vacíos como datos reales."
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void Promise.all([tableGroups.refetch(), users.refetch(), waiterAssignments.refetch()])}
          >
            Reintentar configuración
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricSurface density="compact" label="Total" value={formatNumber(metrics.total)} unavailable={tables.isError} icon={<Armchair className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Disponibles" value={formatNumber(metrics.free)} unavailable={tables.isError} icon={<CheckCircle2 className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Ocupadas" value={formatNumber(metrics.occupied)} unavailable={tables.isError} icon={<CircleDashed className="h-5 w-5" />} />
        <MetricSurface density="compact" label="Fuera de servicio" value={formatNumber(metrics.unavailable)} unavailable={tables.isError} icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-4 px-5 pt-5">
            <h2 className="text-[15px] font-extrabold text-ink">Mesas</h2>
            {tables.data ? <Badge tone="neutral">{metrics.total} configuradas</Badge> : null}
          </div>

          <QueryState
            status={tables.isError ? 'error' : tables.isLoading ? 'loading' : orderedTables.length ? 'ready' : 'empty'}
            title={tables.isError ? 'No pudimos cargar el salón' : 'No hay mesas todavía'}
            description={tables.isError ? 'Reintenta antes de operar: no mostramos un salón vacío como reemplazo.' : 'Cuando configures mesas, aparecerán aquí listas para operar.'}
            onRetry={tables.isError ? () => void tables.refetch() : undefined}
            className="m-4"
            skeletonRows={4}
          >
          <div className="mt-3 grid gap-3 px-4 pb-4 md:grid-cols-2">
            {orderedTables.map((table) => {
              const activeOrder = table.orderTickets[0] ?? null;
              const visual = getTableVisual(table.status, table.isActive);
              const previewItems = activeOrder?.items.slice(0, 2) ?? [];
              const remainingItems = Math.max((activeOrder?.items.length ?? 0) - previewItems.length, 0);
              const compactNote = table.notes?.trim();
              const waiterName = activeOrder?.waiterNameSnapshot ?? activeOrder?.assignedWaiter?.fullName ?? null;

              return (
                <div
                  key={table.id}
                  className={`flex min-h-[7rem] flex-col overflow-hidden rounded-[1.45rem] border shadow-soft transition ${selectedTableId === table.id ? 'border-brand-300 bg-brand-50/40 ring-1 ring-brand-200' : 'border-stone-200 bg-white'} ${!table.isActive ? 'opacity-80' : ''}`}
                  data-testid={`table-card-${table.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <div className="h-1 w-full" style={{ backgroundColor: selectedTableId === table.id ? undefined : table.group?.color ?? (table.isActive ? '#e7e5e4' : '#fca5a5') }} />
                  {selectedTableId === table.id ? <div className="h-1 w-full bg-brand-500 -mt-1" /> : null}
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[1rem] font-semibold leading-tight text-ink">{table.label}</p>
                          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                            <MapPinned className="h-3.5 w-3.5" />
                            <span className="truncate">{table.group?.name ?? table.area ?? 'Sin zona'}</span>
                          </span>
                        </div>
                        {compactNote ? (
                          <p className="mt-1 line-clamp-1 text-[12px] leading-4 text-stone-600">{compactNote}</p>
                        ) : null}
                      </div>
                      <Badge tone={visual.tone} className="mt-0.5 shrink-0 self-start px-2.5 py-1 text-[12px]">
                        {visual.label}
                      </Badge>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <div className="rounded-[1.05rem] border border-stone-200 bg-stone-50 px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-stone-600">
                          <Users className="h-4 w-4" />
                          <span className="text-[12px] font-semibold uppercase tracking-[0.12em]">Capacidad</span>
                        </div>
                        <p className="mt-1 text-[12px] font-semibold leading-4.5 text-ink">
                          {formatNumber(table.capacity)} personas
                        </p>
                      </div>
                      <div className="rounded-[1.05rem] border border-stone-200 bg-stone-50 px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-stone-600">
                          <ReceiptText className="h-4 w-4" />
                          <span className="text-[12px] font-semibold uppercase tracking-[0.12em]">Comanda</span>
                        </div>
                        <p className="mt-1 truncate text-[12px] font-semibold leading-4.5 text-ink">
                          {activeOrder ? getOperationalOrderDisplayCode(activeOrder.type) : 'Sin abrir'}
                        </p>
                      </div>
                    </div>

                    {activeOrder ? (
                      <div className="mt-3 flex flex-1 flex-col rounded-[1.1rem] border border-brand-100 bg-brand-50/30 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-[12px] font-semibold text-ink">
                                {getOperationalOrderDisplayCode(activeOrder.type)}
                              </p>
                              <span className={getOrderTypeVisual(activeOrder.type)}>
                                {getOrderTypeLabel(activeOrder.type)}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-stone-600">
                              {activeOrder.customerName ?? 'Cliente sin nombre'} · {translateOrderStatus(activeOrder.status)}
                            </p>
                            <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-stone-600">
                              Mesero: {waiterName ?? 'Sin asignar'}
                            </p>
                          </div>
                          <Badge tone="info">Activa</Badge>
                        </div>
                        <div className="mt-2 flex-1 space-y-1.5">
                          {previewItems.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/80 bg-white px-2.5 py-1.5 text-[12px]">
                              <span className="truncate text-stone-700">{item.product.name}</span>
                              <span className="shrink-0 font-semibold text-ink">x{formatNumber(item.quantity)}</span>
                            </div>
                          ))}
                          {remainingItems ? (
                            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-stone-600">
                              + {remainingItems} ítems más en la comanda
                            </p>
                          ) : null}
                        </div>
                        <p className="numeric-tabular mt-2 whitespace-nowrap text-right text-[12px] font-semibold text-ink">{formatCurrency(activeOrder.subtotal)}</p>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[1.1rem] border border-dashed border-stone-200 bg-stone-50/60 p-3 text-sm text-stone-600">
                        <div className="flex items-center gap-2.5 text-left">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-stone-600 shadow-sm">
                            <UtensilsCrossed className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <p className="text-[12px] font-semibold text-stone-700">Sin comanda activa</p>
                            <p className="mt-0.5 text-[12px] leading-4 text-stone-600">Lista para abrir servicio.</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <Button type="button" variant="secondary" onClick={() => startEdit(table)} className="w-full">
                        Editar
                      </Button>
                      {table.isActive && table.status !== 'OUT_OF_SERVICE' ? (
                        <Button asChild type="button" className="w-full">
                          <Link href={`/pos?tableId=${table.id}`}>
                            {activeOrder ? 'Retomar comanda' : 'Abrir comanda'}
                          </Link>
                        </Button>
                      ) : (
                        <Button type="button" className="w-full" disabled>
                          {activeOrder ? 'Retomar comanda' : 'Abrir comanda'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </QueryState>
        </Card>

        <Card className="xl:sticky xl:top-24">
          <div className="rounded-[1.5rem] border border-brand-100 bg-brand-50/45 px-4 py-4">
            <h2 className="text-[15px] font-extrabold text-ink">
              {selectedTable ? `Editar ${selectedTable.label}` : 'Registrar nueva mesa'}
            </h2>
            <p className="mt-1 text-sm leading-5 text-stone-600">
              Mantén el salón ordenado para que cada pedido abierto tenga una ubicación clara.
            </p>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              upsertTable.mutate();
            }}
          >
            <Field label="Nombre visible" required>
              <Input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Zona o área">
                <Input value={form.area} onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))} />
              </Field>
              <Field label="Capacidad" hint="Número estimado de personas.">
                <Input
                  type="number"
                  value={form.capacity}
                  onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))}
                />
              </Field>
            </div>
            <Field label="Estado inicial">
              <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as TableForm['status'] }))}>
                <option value="FREE">Libre</option>
                <option value="RESERVED">Reservada</option>
                <option value="OUT_OF_SERVICE">Fuera de servicio</option>
              </Select>
            </Field>
            <Field label="Grupo de mesas" hint="Opcional. Define el responsable desde Grupos de mesas.">
              <Select value={form.groupId} onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}>
                <option value="">Sin grupo</option>
                {activeGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notas internas" hint="Opcional. Útil para restricciones o referencias del salón.">
              <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-28" />
            </Field>
            <Button
              type="submit"
              className="w-full"
              disabled={tables.isError || !form.label.trim() || Number(form.capacity) <= 0 || upsertTable.isPending}
            >
              {upsertTable.isPending ? 'Guardando mesa...' : selectedTable ? 'Guardar cambios de la mesa' : 'Crear mesa'}
            </Button>
            {selectedTable ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full border-red-200 text-red-700 hover:bg-red-50"
                disabled={deleteSelectedTable.isPending}
                onClick={() => deleteSelectedTable.mutate()}
                data-testid="table-delete-button"
              >
                <Trash2 className="h-4 w-4" />
                {deleteSelectedTable.isPending ? 'Eliminando...' : 'Eliminar mesa'}
              </Button>
            ) : null}
          </form>
        </Card>
      </div>

      <Card data-testid="admin-table-groups" className="p-0">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="border-b border-stone-200 p-6 xl:border-b-0 xl:border-r">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Grupos de mesas</h2>
                <p className="mt-1 text-sm leading-5 text-stone-600">
                  Agrupa salón, exterior o auxiliares y asigna un responsable operativo.
                </p>
              </div>
              <Badge tone="info">{activeGroups.length} activos</Badge>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {tableGroups.isLoading ? (
                Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-[1.4rem]" />)
              ) : null}

              {!tableGroups.isLoading && !activeGroups.length ? (
                <div className="md:col-span-2">
                  <EmptyState
                    title="Sin grupos configurados"
                    description="Crea un grupo para asignar mesas y meseros responsables."
                  />
                </div>
              ) : null}

              {activeGroups.map((group) => {
                const assignedWaiter = group.assignments[0]?.waiter ?? null;
                return (
                  <button
                    key={group.id}
                    type="button"
                    data-testid={`table-group-${group.name.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => setSelectedGroupId(group.id)}
                    className={`rounded-[1.4rem] border p-4 text-left transition border-l-[4px] ${
                      selectedGroup?.id === group.id
                        ? 'border-brand-300 bg-brand-50/50 ring-1 ring-brand-200'
                        : 'border-stone-200 bg-white hover:border-brand-200'
                    }`}
                    style={{ borderLeftColor: selectedGroup?.id === group.id ? undefined : (group.color ?? undefined) }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold text-ink">{group.name}</p>
                        <p className="mt-1 truncate text-[12px] text-stone-600">{group.area ?? 'Sin área'}</p>
                      </div>
                      <Badge tone={assignedWaiter ? 'success' : 'warning'}>
                        {assignedWaiter ? 'Asignado' : 'Sin asignar'}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-stone-600">Mesas</p>
                        <p className="mt-0.5 font-semibold text-ink">{group.tables.length}</p>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-stone-600">Responsable</p>
                        <p className="mt-0.5 truncate font-semibold text-ink">{assignedWaiter?.fullName ?? 'Sin asignar'}</p>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-stone-600">
                      {group.tables.map((table) => table.label).join(', ') || 'Aún no tiene mesas.'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-6" data-testid="admin-assign-waiter-to-group">
            <div className="rounded-[1.4rem] border border-brand-100 bg-brand-50/45 p-4">
              <h3 className="text-base font-semibold text-ink">Configurar responsable</h3>
              <p className="mt-1 text-sm leading-5 text-stone-600">
                Admin configura. Mesero opera solo sus mesas cuando hay asignaciones activas.
              </p>
            </div>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                createGroup.mutate();
              }}
            >
              <Field label="Nombre del grupo" required>
                <Input
                  value={groupForm.name}
                  onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Salón, Exterior, Auxiliar"
                />
              </Field>
              <Field label="Área">
                <Input
                  value={groupForm.area}
                  onChange={(event) => setGroupForm((current) => ({ ...current, area: event.target.value }))}
                  placeholder="Salón principal"
                />
              </Field>
              <Field label="Descripción">
                <Textarea
                  value={groupForm.description}
                  onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-20"
                />
              </Field>
              <Button type="submit" className="w-full" disabled={!groupForm.name.trim() || createGroup.isPending}>
                {createGroup.isPending ? 'Creando grupo...' : 'Crear grupo de mesas'}
              </Button>
            </form>

            <div className="mt-6 space-y-4 border-t border-stone-200 pt-5">
              <Field label="Grupo">
                <Select value={selectedGroup?.id ?? ''} onChange={(event) => setSelectedGroupId(event.target.value)}>
                  {activeGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Asignar mesero">
                <Select
                  value={groupForm.waiterId}
                  onChange={(event) => setGroupForm((current) => ({ ...current, waiterId: event.target.value }))}
                >
                  <option value="">Selecciona responsable</option>
                  {waiters.map((waiter) => (
                    <option key={waiter.id} value={waiter.id}>
                      {waiter.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={!selectedGroup || !groupForm.waiterId || assignWaiterToGroup.isPending}
                onClick={() => assignWaiterToGroup.mutate()}
              >
                {assignWaiterToGroup.isPending ? 'Asignando...' : 'Asignar mesero'}
              </Button>
            </div>

            {selectedGroup ? (
              <form
                className="mt-6 space-y-4 border-t border-stone-200 pt-5"
                data-testid="admin-edit-table-group"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateSelectedGroup.mutate();
                }}
              >
                <div>
                  <h3 className="text-base font-semibold text-ink">Editar grupo seleccionado</h3>
                  <p className="mt-1 text-sm leading-5 text-stone-600">
                    Cambia nombre, mesas y responsable sin crear duplicados.
                  </p>
                </div>

                <Field label="Nombre del grupo" required>
                  <Input
                    value={groupEditForm.name}
                    onChange={(event) => setGroupEditForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Área">
                    <Input
                      value={groupEditForm.area}
                      onChange={(event) => setGroupEditForm((current) => ({ ...current, area: event.target.value }))}
                    />
                  </Field>
                  <Field label="Color">
                    <Input
                      value={groupEditForm.color}
                      onChange={(event) => setGroupEditForm((current) => ({ ...current, color: event.target.value }))}
                      placeholder="#F59E0B"
                    />
                  </Field>
                </div>
                <Field label="Descripción">
                  <Textarea
                    value={groupEditForm.description}
                    onChange={(event) => setGroupEditForm((current) => ({ ...current, description: event.target.value }))}
                    className="min-h-20"
                  />
                </Field>
                <Field label="Responsable actual">
                  <Select
                    value={groupEditForm.waiterId}
                    onChange={(event) => setGroupEditForm((current) => ({ ...current, waiterId: event.target.value }))}
                    data-testid="admin-table-group-responsible-select"
                  >
                    <option value="">Sin responsable</option>
                    {waiters.map((waiter) => (
                      <option key={waiter.id} value={waiter.id}>
                        {waiter.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">Mesas del grupo</p>
                    <Badge tone="neutral">{groupEditTableIds.length} seleccionadas</Badge>
                  </div>
                  <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                    {activeTables.map((table) => {
                      const checked = groupEditTableIds.includes(table.id);
                      const directAssignment = activeDirectAssignmentsByTableId.get(table.id);
                      return (
                        <label
                          key={table.id}
                          className="flex items-start gap-3 rounded-xl border border-white bg-white px-3 py-2 text-sm shadow-sm"
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-stone-300 text-brand-600"
                            checked={checked}
                            onChange={(event) =>
                              setGroupEditTableIds((current) =>
                                event.target.checked
                                  ? [...new Set([...current, table.id])]
                                  : current.filter((tableId) => tableId !== table.id),
                              )
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-ink">{table.label}</span>
                            <span className="block text-[12px] text-stone-600">
                              {table.area ?? 'Sin área'}
                              {directAssignment ? ` · Asignación directa: ${directAssignment.waiter.fullName}` : ''}
                            </span>
                          </span>
                          {directAssignment ? <Badge tone="info">Prioridad directa</Badge> : null}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <Field label="Estado del grupo">
                  <Select
                    value={groupEditForm.isActive ? 'active' : 'inactive'}
                    onChange={(event) =>
                      setGroupEditForm((current) => ({ ...current, isActive: event.target.value === 'active' }))
                    }
                  >
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </Select>
                </Field>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={!groupEditForm.name.trim() || updateSelectedGroup.isPending}
                >
                  {updateSelectedGroup.isPending ? 'Guardando cambios...' : 'Guardar cambios del grupo'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full border-red-200 text-red-700 hover:bg-red-50"
                  disabled={deleteSelectedGroup.isPending}
                  onClick={() => deleteSelectedGroup.mutate()}
                  data-testid="table-group-delete-button"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleteSelectedGroup.isPending ? 'Eliminando...' : 'Eliminar grupo'}
                </Button>
              </form>
            ) : null}

            {selectedGroup ? (
              <div className="mt-6 space-y-3 border-t border-stone-200 pt-5" data-testid="admin-direct-table-assignment">
                <div>
                  <h3 className="text-base font-semibold text-ink">Asignación directa</h3>
                  <p className="mt-1 text-sm leading-5 text-stone-600">
                    Una mesa directa tiene prioridad sobre el responsable del grupo.
                  </p>
                </div>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {selectedGroup.tables.map((table) => {
                    const directAssignment = activeDirectAssignmentsByTableId.get(table.id);
                    return (
                      <div key={table.id} className="rounded-xl border border-stone-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">{table.label}</p>
                            <p className="mt-0.5 truncate text-[12px] text-stone-600">
                              {directAssignment ? `Directa: ${directAssignment.waiter.fullName}` : 'Sigue responsable del grupo'}
                            </p>
                          </div>
                          {directAssignment ? <Badge tone="info">Directa</Badge> : <Badge tone="neutral">Grupo</Badge>}
                        </div>
                        <Select
                          className="mt-2"
                          value={directAssignment?.waiterId ?? ''}
                          onChange={(event) => {
                            if (event.target.value) {
                              assignTableDirectly.mutate({ tableId: table.id, waiterId: event.target.value });
                            }
                          }}
                        >
                          <option value="">Asignar directo</option>
                          {waiters.map((waiter) => (
                            <option key={waiter.id} value={waiter.id}>
                              {waiter.fullName}
                            </option>
                          ))}
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

function getOrderTypeLabel(type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER') {
  switch (type) {
    case 'DINE_IN':
      return 'MESA';
    case 'DELIVERY':
      return 'DOMICILIO';
    case 'TAKEAWAY':
      return 'LLEVAR';
    case 'COUNTER':
    default:
      return 'MOSTRADOR';
  }
}

function getOrderTypeVisual(type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER') {
  switch (type) {
    case 'DINE_IN':
      return 'inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-sky-800';
    case 'DELIVERY':
      return 'inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-violet-800';
    case 'TAKEAWAY':
      return 'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-emerald-800';
    case 'COUNTER':
    default:
      return 'inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-amber-800';
  }
}

function getTableVisual(status: TableStatus, isActive: boolean) {
  if (!isActive || status === 'OUT_OF_SERVICE') {
    return { tone: 'danger' as const, label: 'Fuera de servicio' };
  }

  if (status === 'FREE') {
    return { tone: 'success' as const, label: 'Libre' };
  }

  if (status === 'PAYMENT_PENDING') {
    return { tone: 'info' as const, label: 'Pago pendiente' };
  }

  if (status === 'RESERVED') {
    return { tone: 'default' as const, label: 'Reservada' };
  }

  return { tone: 'default' as const, label: 'Ocupada' };
}

function translateOrderStatus(status: string) {
  const labels: Record<string, string> = {
    OPEN: 'Abierta',
    IN_PREPARATION: 'En preparación',
    SERVED: 'Servida',
    PAYMENT_PENDING: 'Pendiente de cobro',
    PAID: 'Pagada',
    CANCELLED: 'Cancelada',
  };

  return labels[status] ?? status;
}

function compareTablesForMap(left: DiningTable, right: DiningTable) {
  const leftNumber = extractTrailingNumber(left.label);
  const rightNumber = extractTrailingNumber(right.label);

  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  if (leftNumber !== null && rightNumber === null) {
    return -1;
  }

  if (leftNumber === null && rightNumber !== null) {
    return 1;
  }

  return left.label.localeCompare(right.label, 'es', { numeric: true, sensitivity: 'base' });
}

function extractTrailingNumber(label: string) {
  const match = label.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : null;
}
