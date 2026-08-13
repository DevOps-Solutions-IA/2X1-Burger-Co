'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck, UserRound, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  DataTableShell,
  DetailDialog,
  FilterBar,
  MetricSurface,
  PageHeader,
  QueryState,
  StatusBadge,
  type DataTableColumn,
} from '@/components/product';
import { useAuth } from '@/features/auth/auth-provider';
import { apiFetch } from '@/lib/api';
import type { RoleRecord, UserRecord } from './contracts';
import { errorIsPermissionDenied, fetchRoles, fetchUsers, formatDateTime, humanize } from './queries';

type TeamGroup = 'all' | 'system' | 'waiter' | 'delivery';

type UserForm = {
  fullName: string;
  email: string;
  roleId: string;
  password: string;
  accessCode: string;
};

const emptyForm: UserForm = { fullName: '', email: '', roleId: '', password: '', accessCode: '' };

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  cashier: 'Caja',
  kitchen: 'Cocina',
  inventory: 'Inventario',
  reports: 'Reportes',
  waiter: 'Mesero',
  delivery: 'Domiciliario',
};

function roleLabel(name: string) {
  return roleLabels[name.toLowerCase()] ?? humanize(name);
}

function groupFor(user: UserRecord): Exclude<TeamGroup, 'all'> {
  if (user.roles.some((role) => role.name === 'waiter')) return 'waiter';
  if (user.roles.some((role) => role.name === 'delivery')) return 'delivery';
  return 'system';
}

function generateAccessCode(prefix: 'M' | 'D') {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return `${prefix}${String((values[0] ?? 0) % 1_000_000).padStart(6, '0')}`;
}

export function TeamWorkspace() {
  const queryClient = useQueryClient();
  const { user: actor } = useAuth();
  const isAdmin = actor?.roles.includes('admin') ?? false;
  const [group, setGroup] = useState<TeamGroup>('all');
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<UserRecord | null>(null);
  const [details, setDetails] = useState<UserRecord | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [confirmStatus, setConfirmStatus] = useState<UserRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRecord | null>(null);

  const users = useQuery({ queryKey: ['governance', 'users'], queryFn: fetchUsers });
  const roles = useQuery({ queryKey: ['governance', 'roles'], queryFn: fetchRoles });

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return (users.data ?? []).filter((candidate) => {
      const matchesGroup = group === 'all' || groupFor(candidate) === group;
      const haystack = [candidate.fullName, candidate.email, candidate.accessName ?? '', ...candidate.roles.map((role) => roleLabel(role.name))]
        .join(' ')
        .toLocaleLowerCase('es');
      return matchesGroup && (!term || haystack.includes(term));
    });
  }, [group, search, users.data]);

  const counts = useMemo(() => ({
    total: users.data?.length ?? 0,
    active: users.data?.filter((item) => item.isActive).length ?? 0,
    operational: users.data?.filter((item) => groupFor(item) !== 'system').length ?? 0,
    inactive: users.data?.filter((item) => !item.isActive).length ?? 0,
  }), [users.data]);

  const selectedRole = roles.data?.find((role) => role.id === form.roleId) ?? null;
  const operationalRole = selectedRole?.name === 'waiter' || selectedRole?.name === 'delivery';

  const saveUser = useMutation({
    mutationFn: async () => {
      if (!form.fullName.trim() || !form.roleId) throw new Error('Completa nombre y rol.');
      const payload = operationalRole
        ? {
            fullName: form.fullName.trim(),
            roleIds: [form.roleId],
            ...(form.accessCode.trim() ? { accessCode: form.accessCode.trim().toUpperCase() } : {}),
          }
        : {
            fullName: form.fullName.trim(),
            email: form.email.trim().toLowerCase(),
            roleIds: [form.roleId],
            ...(form.password ? { password: form.password } : {}),
          };
      if (!operationalRole && !form.email.trim()) throw new Error('El correo es obligatorio para usuarios del sistema.');
      if (!selected && operationalRole && !form.accessCode.trim()) throw new Error('Genera o ingresa un código de acceso.');
      if ((!selected || form.password) && !operationalRole && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(form.password)) {
        throw new Error('La contraseña debe tener 8 caracteres, mayúscula, minúscula, número y símbolo.');
      }
      return apiFetch(selected ? `/users/${selected.id}` : '/users', {
        method: selected ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      toast.success(selected ? 'Integrante actualizado' : 'Integrante creado');
      closeEditor();
      await queryClient.invalidateQueries({ queryKey: ['governance', 'users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible guardar el integrante.'),
  });

  const toggleStatus = useMutation({
    mutationFn: (candidate: UserRecord) => apiFetch(`/users/${candidate.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !candidate.isActive }),
    }),
    onSuccess: async (_, candidate) => {
      toast.success(candidate.isActive ? 'Acceso desactivado' : 'Acceso activado');
      setConfirmStatus(null);
      await queryClient.invalidateQueries({ queryKey: ['governance', 'users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible cambiar el acceso.'),
  });

  const removeUser = useMutation({
    mutationFn: (candidate: UserRecord) => apiFetch(`/users/${candidate.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Integrante eliminado; la evidencia histórica fue preservada por el servidor.');
      setConfirmDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['governance', 'users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible eliminar el integrante.'),
  });

  const openCreate = () => {
    setSelected(null);
    setForm(emptyForm);
    setEditorOpen(true);
  };

  const openEdit = (candidate: UserRecord) => {
    setSelected(candidate);
    setForm({
      fullName: candidate.fullName,
      email: groupFor(candidate) === 'system' ? candidate.email : '',
      roleId: candidate.roles[0]?.id ?? '',
      password: '',
      accessCode: '',
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setSelected(null);
    setForm(emptyForm);
  };

  const columns: Array<DataTableColumn<UserRecord>> = [
    {
      id: 'person',
      header: 'Integrante',
      cell: (candidate) => (
        <div>
          <p className="font-semibold text-ink">{candidate.fullName}</p>
          <p className="mt-1 text-xs text-muted">{groupFor(candidate) === 'system' ? candidate.email : candidate.accessName ?? 'Acceso operativo'}</p>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Rol',
      cell: (candidate) => <span className="text-sm font-medium text-ink">{candidate.roles.map((role) => roleLabel(role.name)).join(', ') || 'Sin rol'}</span>,
    },
    {
      id: 'access',
      header: 'Acceso',
      cell: (candidate) => <StatusBadge status={candidate.isActive ? 'ACTIVE' : 'BLOCKED'} label={candidate.isActive ? 'Activo' : 'Desactivado'} />,
    },
    {
      id: 'lastLogin',
      header: 'Último ingreso',
      cell: (candidate) => <span className="text-xs tabular-nums text-muted">{formatDateTime(candidate.lastLoginAt)}</span>,
    },
  ];

  const queryStatus = users.isPending || roles.isPending
    ? 'loading'
    : errorIsPermissionDenied(users.error ?? roles.error)
      ? 'permission_denied'
      : users.isError || roles.isError
        ? 'error'
        : filtered.length === 0
          ? 'empty'
          : 'ready';

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8" data-testid="team-page">
      <PageHeader
        eyebrow="Administración"
        title="Equipo y acceso"
        description="Personas, roles y permisos efectivos. La autorización final siempre se valida en el servidor."
        status={<StatusBadge status="ACTIVE" label="RBAC activo" tone="success" />}
        actions={isAdmin ? <Button type="button" onClick={openCreate}><Plus className="h-4 w-4" aria-hidden="true" />Agregar integrante</Button> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricSurface label="Integrantes" value={counts.total} icon={<UserRound className="h-4 w-4" />} density="compact" />
        <MetricSurface label="Accesos activos" value={counts.active} icon={<UserCheck className="h-4 w-4" />} density="compact" />
        <MetricSurface label="Equipo operativo" value={counts.operational} icon={<KeyRound className="h-4 w-4" />} density="compact" />
        <MetricSurface label="Desactivados" value={counts.inactive} icon={<UserX className="h-4 w-4" />} density="compact" />
      </div>

      <div className="overflow-x-auto border-b border-line" role="group" aria-label="Tipos de integrante">
        <div className="flex min-w-max gap-1">
          {([
            ['all', 'Todos'],
            ['system', 'Sistema'],
            ['waiter', 'Meseros'],
            ['delivery', 'Domiciliarios'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={group === id}
              onClick={() => setGroup(id)}
              className={`relative min-h-11 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${group === id ? 'bg-panel text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand-600' : 'text-muted hover:bg-panel hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <FilterBar
        activeCount={(group !== 'all' ? 1 : 0) + (search.trim() ? 1 : 0)}
        search={(
          <label className="relative block">
            <span className="sr-only">Buscar integrante</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" aria-hidden="true" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, correo o rol" className="pl-10" />
          </label>
        )}
        filters={(
          <Select value={group} onChange={(event) => setGroup(event.target.value as TeamGroup)} aria-label="Filtrar tipo de integrante">
            <option value="all">Todo el equipo</option>
            <option value="system">Usuarios del sistema</option>
            <option value="waiter">Meseros</option>
            <option value="delivery">Domiciliarios</option>
          </Select>
        )}
      />

      <section id="team-list">
        <QueryState
          status={queryStatus}
          title={queryStatus === 'empty' ? 'No hay integrantes con estos filtros' : undefined}
          onRetry={() => void Promise.all([users.refetch(), roles.refetch()])}
        >
          <DataTableShell
            rows={filtered}
            columns={columns}
            rowKey={(candidate) => candidate.id}
            caption="Equipo y roles"
            rowActions={(candidate) => (
              <div className="flex flex-wrap justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setDetails(candidate)} aria-label={`Ver permisos de ${candidate.fullName}`}>
                  <Eye className="h-4 w-4" aria-hidden="true" /><span className="md:sr-only">Ver</span>
                </Button>
                {isAdmin ? (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(candidate)} aria-label={`Editar ${candidate.fullName}`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" /><span className="md:sr-only">Editar</span>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmStatus(candidate)} aria-label={`${candidate.isActive ? 'Desactivar' : 'Activar'} ${candidate.fullName}`}>
                      {candidate.isActive ? <UserX className="h-4 w-4" aria-hidden="true" /> : <UserCheck className="h-4 w-4" aria-hidden="true" />}
                      <span className="md:sr-only">{candidate.isActive ? 'Desactivar' : 'Activar'}</span>
                    </Button>
                    {candidate.id !== actor?.sub ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(candidate)} aria-label={`Eliminar ${candidate.fullName}`}>
                        <Trash2 className="h-4 w-4 text-signal-danger" aria-hidden="true" /><span className="md:sr-only">Eliminar</span>
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            )}
          />
        </QueryState>
      </section>

      <DetailDialog open={editorOpen} onClose={closeEditor} title={selected ? 'Editar integrante' : 'Agregar integrante'} description="Los permisos se asignan mediante un rol canónico del servidor." mode="dialog" footer={(
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={closeEditor}>Cancelar</Button>
          <Button type="button" onClick={() => saveUser.mutate()} disabled={saveUser.isPending}>{saveUser.isPending ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      )}>
        <div className="space-y-4">
          <Field label="Nombre completo" required><Input value={form.fullName} onChange={(event) => setForm((value) => ({ ...value, fullName: event.target.value }))} autoComplete="name" /></Field>
          <Field label="Rol" required><Select value={form.roleId} onChange={(event) => setForm((value) => ({ ...value, roleId: event.target.value, accessCode: '' }))}><option value="">Selecciona un rol</option>{roles.data?.map((role) => <option key={role.id} value={role.id}>{roleLabel(role.name)}</option>)}</Select></Field>
          {operationalRole ? (
            <Field label={selected ? 'Nuevo código (opcional)' : 'Código de acceso'} hint="El código solo se envía al guardar y nunca vuelve a mostrarse.">
              <div className="flex flex-col gap-2 sm:flex-row"><Input value={form.accessCode} onChange={(event) => setForm((value) => ({ ...value, accessCode: event.target.value.toUpperCase() }))} autoComplete="off" /><Button type="button" variant="secondary" onClick={() => setForm((value) => ({ ...value, accessCode: generateAccessCode(selectedRole?.name === 'waiter' ? 'M' : 'D') }))}>Generar</Button></div>
            </Field>
          ) : (
            <>
              <Field label="Correo" required><Input type="email" value={form.email} onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))} autoComplete="email" /></Field>
              <Field label={selected ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'} required={!selected} hint="Mínimo 8 caracteres. No se almacena en el navegador."><Input type="password" value={form.password} onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))} autoComplete="new-password" /></Field>
            </>
          )}
        </div>
      </DetailDialog>

      <DetailDialog open={Boolean(details)} onClose={() => setDetails(null)} title={details?.fullName ?? 'Detalle del integrante'} description="Permisos efectivos del rol asignado.">
        {details ? <TeamDetails user={details} roles={roles.data ?? []} /> : null}
      </DetailDialog>

      <ConfirmDialog
        open={Boolean(confirmStatus)}
        title={confirmStatus?.isActive ? 'Desactivar acceso' : 'Activar acceso'}
        message={confirmStatus?.isActive ? `Se cerrarán las sesiones activas de ${confirmStatus.fullName}.` : `${confirmStatus?.fullName ?? 'El integrante'} podrá volver a iniciar sesión.`}
        confirmLabel={confirmStatus?.isActive ? 'Desactivar' : 'Activar'}
        destructive={confirmStatus?.isActive}
        onCancel={() => setConfirmStatus(null)}
        onConfirm={() => { if (confirmStatus) toggleStatus.mutate(confirmStatus); }}
      />
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Eliminar integrante"
        message={`Se eliminará la cuenta de ${confirmDelete?.fullName ?? 'este integrante'}. El servidor reasignará referencias históricas a su cuenta de archivo; esta acción no se puede deshacer.`}
        confirmLabel="Eliminar cuenta"
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) removeUser.mutate(confirmDelete); }}
      />
    </div>
  );
}

function TeamDetails({ user, roles }: { user: UserRecord; roles: RoleRecord[] }) {
  const assigned = roles.filter((role) => user.roles.some((candidate) => candidate.id === role.id));
  const permissions = [...new Set(assigned.flatMap((role) => role.permissions?.map((entry) => entry.permission.code) ?? []))].sort();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line p-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Estado</p><div className="mt-2"><StatusBadge status={user.isActive ? 'ACTIVE' : 'BLOCKED'} label={user.isActive ? 'Activo' : 'Desactivado'} /></div></div>
        <div className="rounded-2xl border border-line p-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Último ingreso</p><p className="mt-2 text-sm font-semibold text-ink">{formatDateTime(user.lastLoginAt)}</p></div>
      </div>
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Permisos efectivos</h3>
        {permissions.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2">{permissions.map((permission) => <li key={permission} className="rounded-xl bg-canvas px-3 py-2 text-xs font-medium text-ink">{humanize(permission)}</li>)}</ul> : <p className="mt-3 text-sm text-muted">El contrato no reporta permisos para este rol.</p>}
      </section>
    </div>
  );
}
