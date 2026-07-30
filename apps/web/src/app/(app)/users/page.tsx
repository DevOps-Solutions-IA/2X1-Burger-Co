'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Search, ShieldCheck, Trash2, UserCog, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/section-title';
import { Select } from '@/components/ui/select';
import { apiFetch } from '@/lib/api';
import { formatDateTime, matchesSearch } from '@/lib/format';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { z } from 'zod';

type Role = {
  id: string;
  name: string;
};

type User = {
  id: string;
  email: string;
  fullName: string;
  accessName: string | null;
  hasAccessCode: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: Role[];
};

const passwordSchema = z
  .string()
  .min(8, 'Minimo 8 caracteres')
  .regex(/[A-Z]/, 'Debe contener al menos una mayuscula')
  .regex(/[a-z]/, 'Debe contener al menos una minuscula')
  .regex(/[0-9]/, 'Debe contener al menos un numero')
  .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un caracter especial');

const passwordRequirements = [
  { label: 'Minimo 8 caracteres', test: (v: string) => v.length >= 8 },
  { label: 'Al menos una mayuscula', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'Al menos una minuscula', test: (v: string) => /[a-z]/.test(v) },
  { label: 'Al menos un numero', test: (v: string) => /[0-9]/.test(v) },
  { label: 'Al menos un caracter especial', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const result = passwordSchema.safeParse(password);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map((issue) => issue.message),
  };
}

const initialSystemForm: {
  email: string;
  fullName: string;
  password: string;
  confirmPassword: string;
  roleId: string;
} = {
  email: '',
  fullName: '',
  password: '',
  confirmPassword: '',
  roleId: '',
};

const initialOperationalForm = {
  fullName: '',
  accessCode: '',
};

function generateOperationalCode(prefix: 'M' | 'D') {
  const randomValue = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
  const digits = String(randomValue % 1_000_000).padStart(6, '0');
  return `${prefix}${digits}`;
}

function formatRoleLabel(roleName: string) {
  const labels: Record<string, string> = {
    admin: 'Administrador',
    administrator: 'Administrador',
    cashier: 'Cajero',
    manager: 'Supervisor',
    inventory: 'Inventario',
    waiter: 'Mesero',
    delivery: 'Domiciliario',
    kitchen: 'Cocina',
    reports: 'Reportes',
  };

  const normalized = roleName.toLowerCase().trim();
  return labels[normalized] ?? roleName.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPermissionLabel(permissionCode: string) {
  return permissionCode
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedSystemUser, setSelectedSystemUser] = useState<User | null>(null);
  const [selectedWaiter, setSelectedWaiter] = useState<User | null>(null);
  const [selectedDeliveryRider, setSelectedDeliveryRider] = useState<User | null>(null);
  const [configuredWaiterCode, setConfiguredWaiterCode] = useState<string | null>(null);
  const [configuredDeliveryCode, setConfiguredDeliveryCode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [systemForm, setSystemForm] = useState(initialSystemForm);
  const [waiterForm, setWaiterForm] = useState(initialOperationalForm);
  const [deliveryForm, setDeliveryForm] = useState(initialOperationalForm);
  const [systemSubmitAttempted, setSystemSubmitAttempted] = useState(false);

  const systemFormErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!systemForm.fullName.trim()) errors.fullName = 'El nombre completo es obligatorio.';
    if (!systemForm.email.trim()) errors.email = 'El correo electrónico es obligatorio.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(systemForm.email)) errors.email = 'El formato del correo no es válido.';
    if (!systemForm.roleId) errors.roleId = 'Debe seleccionar un rol.';
    if (!selectedSystemUser || systemForm.password) {
      const pw = validatePassword(systemForm.password);
      if (!pw.valid) errors.password = pw.errors.join('. ');
      if (!systemForm.confirmPassword) {
        errors.confirmPassword = 'Confirma la contraseña.';
      } else if (systemForm.password && systemForm.password !== systemForm.confirmPassword) {
        errors.confirmPassword = 'Las contraseñas no coinciden.';
      }
    }
    return errors;
  }, [systemForm, selectedSystemUser]);

  const isSystemFormValid = Object.keys(systemFormErrors).length === 0;

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<User[]>('/users'),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<Array<Role & { permissions: Array<{ permission: { code: string } }> }>>('/roles'),
  });

  const filteredUsers = useMemo(
    () =>
      (users.data ?? []).filter((user) =>
        matchesSearch([
          user.fullName,
          user.email,
          user.accessName,
          ...user.roles.map((role) => role.name),
          ...user.roles.map((role) => formatRoleLabel(role.name)),
        ], search),
      ),
    [users.data, search],
  );

  const waiterRole = useMemo(
    () => roles.data?.find((role) => role.name === 'waiter') ?? null,
    [roles.data],
  );
  const deliveryRole = useMemo(
    () => roles.data?.find((role) => role.name === 'delivery') ?? null,
    [roles.data],
  );

  const waiterUsers = useMemo(
    () => filteredUsers.filter((user) => user.roles.some((role) => role.name === 'waiter')),
    [filteredUsers],
  );
  const deliveryUsers = useMemo(
    () => filteredUsers.filter((user) => user.roles.some((role) => role.name === 'delivery')),
    [filteredUsers],
  );

  const systemUsers = useMemo(
    () => filteredUsers.filter((user) => !user.roles.some((role) => ['waiter', 'delivery'].includes(role.name))),
    [filteredUsers],
  );

  const systemRoles = useMemo(
    () => (roles.data ?? []).filter((role) => !['waiter', 'delivery'].includes(role.name)),
    [roles.data],
  );

  const selectedSystemRole = useMemo(
    () => roles.data?.find((role) => role.id === systemForm.roleId) ?? null,
    [roles.data, systemForm.roleId],
  );

  const saveSystemUser = useMutation({
    mutationFn: async () => {
      if (!systemForm.roleId) {
        throw new Error('Selecciona un rol para el usuario del sistema.');
      }

      const needsPassword = !selectedSystemUser || Boolean(systemForm.password);
      if (needsPassword && systemForm.password) {
        const pwValidation = validatePassword(systemForm.password);
        if (!pwValidation.valid) {
          throw new Error('La contrasena no cumple los requisitos de seguridad: ' + pwValidation.errors.join(', '));
        }
        if (systemForm.password !== systemForm.confirmPassword) {
          throw new Error('Las contrasenas no coinciden.');
        }
      }
      if (needsPassword && !systemForm.confirmPassword) {
        throw new Error('Confirma la contrasena antes de guardar.');
      }

      const payload = {
        email: systemForm.email,
        fullName: systemForm.fullName,
        roleIds: [systemForm.roleId],
        ...(systemForm.password ? { password: systemForm.password } : {}),
      };

      if (selectedSystemUser) {
        return apiFetch(`/users/${selectedSystemUser.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      return apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          password: systemForm.password,
        }),
      });
    },
    onSuccess: async () => {
      toast.success(selectedSystemUser ? 'Usuario actualizado' : 'Usuario creado');
      setSelectedSystemUser(null);
      setSystemForm(initialSystemForm);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible guardar el usuario'),
  });

  const saveWaiter = useMutation({
    mutationFn: async () => {
      if (!waiterRole) {
        throw new Error('No encontramos el rol de mesero en la configuración.');
      }

      const payload = {
        fullName: waiterForm.fullName,
        roleIds: [waiterRole.id],
        ...(waiterForm.accessCode ? { accessCode: waiterForm.accessCode } : {}),
      };

      if (selectedWaiter) {
        return apiFetch(`/users/${selectedWaiter.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      if (!waiterForm.accessCode) {
        throw new Error('Genera o escribe un código para el mesero.');
      }

      return apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      if (waiterForm.accessCode.trim()) {
        setConfiguredWaiterCode(waiterForm.accessCode.trim().toUpperCase());
      }
      toast.success(selectedWaiter ? 'Mesero actualizado' : 'Mesero creado');
      setSelectedWaiter(null);
      setWaiterForm(initialOperationalForm);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible guardar el mesero'),
  });

  const saveDeliveryRider = useMutation({
    mutationFn: async () => {
      if (!deliveryRole) {
        throw new Error('No encontramos el rol de domiciliario en la configuración.');
      }

      const payload = {
        fullName: deliveryForm.fullName,
        roleIds: [deliveryRole.id],
        ...(deliveryForm.accessCode ? { accessCode: deliveryForm.accessCode } : {}),
      };

      if (selectedDeliveryRider) {
        return apiFetch(`/users/${selectedDeliveryRider.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      if (!deliveryForm.accessCode) {
        throw new Error('Genera o escribe un código para el domiciliario.');
      }

      return apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      if (deliveryForm.accessCode.trim()) {
        setConfiguredDeliveryCode(deliveryForm.accessCode.trim().toUpperCase());
      }
      toast.success(selectedDeliveryRider ? 'Domiciliario actualizado' : 'Domiciliario creado');
      setSelectedDeliveryRider(null);
      setDeliveryForm(initialOperationalForm);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible guardar el domiciliario'),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: async (_, variables) => {
      toast.success(variables.isActive ? 'Usuario activado' : 'Usuario desactivado');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar el estado'),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/users/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast.success('Usuario eliminado');
      setSelectedSystemUser(null);
      setSelectedWaiter(null);
      setSelectedDeliveryRider(null);
      setSystemForm(initialSystemForm);
      setWaiterForm(initialOperationalForm);
      setDeliveryForm(initialOperationalForm);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible eliminar el usuario'),
  });

  return (
    <div className="space-y-6 p-6 lg:p-8" data-testid="users-page">
      <SectionTitle
        eyebrow="Administracion"
        title="Equipo"
        description="Gestiona accesos, roles y permisos del personal."
        status={<Badge tone="info">{systemUsers.length} usuarios &middot; {waiterUsers.length} meseros &middot; {deliveryUsers.length} domiciliarios</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden p-0">
          <div className="space-y-3 border-b border-stone-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Usuarios del sistema</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Administracion, caja, supervision e inventario.</p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar usuario..." className="pl-9" />
            </div>
          </div>

          <div className="hide-scrollbar max-h-[32rem] min-h-0 overflow-y-auto divide-y divide-stone-100">
            {systemUsers.map((user) => {
              const isSelected = selectedSystemUser?.id === user.id;
              return (
              <div key={user.id} className={`flex items-center justify-between gap-3 px-5 py-3 border transition ${
                isSelected ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200 shadow-sm border-l-[3px] border-l-brand-400 shadow-[0_0_0_1px_rgba(0,0,0,0.03)]' : 'border-transparent hover:bg-stone-50/50'
              }`}>
                <button
                  type="button"
                  className="text-left flex-1 min-w-0"
                  onClick={() => {
                    setSelectedSystemUser(user);
                    setSystemForm({
                      email: user.email,
                      fullName: user.fullName,
                      password: '',
                      confirmPassword: '',
                      roleId: user.roles[0]?.id ?? '',
                    });
                  }}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-extrabold text-ink truncate">{user.fullName}</p>
                    <span className={`text-[10px] font-bold shrink-0 ${user.isActive ? 'text-emerald-800' : 'text-stone-600'}`}>{user.isActive ? 'Activo' : 'Inactivo'}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-stone-500 truncate">{user.email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {user.roles.map((role) => (
                      <span key={role.id} className="text-[10px] font-bold text-stone-500">{formatRoleLabel(role.name)}</span>
                    ))}
                    {user.roles.length > 1 && user.roles.map((r,i) => i > 0 ? <span key={r.id} className="text-[10px] text-stone-600">&middot; {formatRoleLabel(r.name)}</span> : null)}
                    <span className="text-[10px] text-stone-600">&middot; {formatDateTime(user.lastLoginAt)}</span>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button type="button" variant="secondary" size="sm" className="text-[11px]"
                    onClick={() => toggleStatus.mutate({ id: user.id, isActive: !user.isActive })}>
                    {user.isActive ? 'Desactivar' : 'Activar'}
                  </Button>
                  <button type="button" className="text-stone-500 hover:text-red-700 transition"
                    aria-label={`Eliminar usuario ${user.fullName}`}
                    disabled={deleteUser.isPending}
                    onClick={() => setConfirmDelete({ id: user.id, name: user.fullName })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              );
            })}
            {!systemUsers.length ? (
              <div className="p-6">
                <EmptyState
                  title="Sin usuarios del sistema"
                  description="Crea aquí las cuentas administrativas o de caja."
                />
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <UserCog className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">{selectedSystemUser ? 'Editar usuario' : 'Nuevo usuario'}</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Cuentas del sistema.</p>
            </div>
          </div>

          <form
            className="mt-6 space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setSystemSubmitAttempted(true);
              if (!isSystemFormValid) return;
              saveSystemUser.mutate();
            }}
          >
            <Field label="Nombre completo" error={systemSubmitAttempted ? systemFormErrors.fullName : null} required>
              <Input
                value={systemForm.fullName}
                onChange={(event) => setSystemForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Ej. Laura Mejía"
              />
            </Field>
            <Field label="Correo" error={systemSubmitAttempted ? systemFormErrors.email : null} required>
              <Input
                type="email"
                value={systemForm.email}
                onChange={(event) => setSystemForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="usuario@correo.com"
              />
            </Field>
            <Field label={selectedSystemUser ? 'Nueva contraseña opcional' : 'Contraseña temporal'} error={systemSubmitAttempted ? systemFormErrors.password : null} required={!selectedSystemUser}>
              <Input
                type="password"
                value={systemForm.password}
                onChange={(event) => setSystemForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={selectedSystemUser ? 'Solo si deseas rotarla' : 'Minimo 8 caracteres'}
              />
              {systemForm.password ? (
                <div className="mt-2 space-y-1">
                  {passwordRequirements.map((req) => (
                    <p key={req.label} className={`text-[12px] leading-5 ${req.test(systemForm.password) ? 'text-emerald-800' : 'text-stone-600'}`}>
                      {req.test(systemForm.password) ? '✓' : '○'} {req.label}
                    </p>
                  ))}
                </div>
              ) : null}
            </Field>
            {systemForm.password || !selectedSystemUser ? (
              <Field label="Confirmar contraseña" error={systemSubmitAttempted ? systemFormErrors.confirmPassword : null} required={!selectedSystemUser}>
                <Input
                  type="password"
                  value={systemForm.confirmPassword}
                  onChange={(event) => setSystemForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                  placeholder="Repite la contrasena"
                />
              </Field>
            ) : null}
            <Field label="Rol principal" error={systemSubmitAttempted ? systemFormErrors.roleId : null} required>
              <Select
                value={systemForm.roleId}
                onChange={(event) => setSystemForm((current) => ({ ...current, roleId: event.target.value }))}
              >
                <option value="">Selecciona rol</option>
                {systemRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {formatRoleLabel(role.name)}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-3.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-brand-700" />
                <p className="font-medium text-ink">Resumen de permisos</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedSystemRole ? (
                  selectedSystemRole.permissions.slice(0, 8).map((permission) => (
                    <Badge key={`${selectedSystemRole.id}-${permission.permission.code}`}>
                      {formatPermissionLabel(permission.permission.code)}
                    </Badge>
                  ))
                ) : (
                  <p className="text-[13px] leading-6 text-stone-500">Selecciona un rol para visualizar el alcance operativo.</p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={saveSystemUser.isPending || (systemSubmitAttempted && !isSystemFormValid)}>
                {saveSystemUser.isPending ? 'Guardando usuario...' : selectedSystemUser ? 'Guardar cambios' : 'Crear usuario'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSelectedSystemUser(null);
                  setSystemForm(initialSystemForm);
                }}
              >
                Nuevo usuario
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-4 border-b border-stone-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Meseros</h2>
              <p className="mt-1 text-sm text-stone-500">Los meseros entran solo con su nombre y un código de acceso de turno.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                  setSelectedWaiter(null);
                  setWaiterForm({
                  ...initialOperationalForm,
                  accessCode: generateOperationalCode('M'),
                });
              }}
            >
              Nuevo mesero
            </Button>
          </div>

          <div className="hide-scrollbar max-h-[24rem] min-h-0 overflow-y-auto divide-y divide-stone-100">
            {waiterUsers.map((user) => {
              const isSelected = selectedWaiter?.id === user.id;
              return (
              <div key={user.id} className={`flex items-center justify-between gap-3 px-5 py-3 border transition ${
                isSelected ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200 shadow-sm border-l-[3px] border-l-brand-400' : 'border-transparent hover:bg-stone-50/50'
              }`}>
                <button
                  type="button"
                  className="text-left flex-1 min-w-0"
                  onClick={() => { setSelectedWaiter(user); setWaiterForm({ fullName: user.fullName, accessCode: '' }); }}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-extrabold text-ink truncate">{user.fullName}</p>
                    <span className={`text-[10px] font-bold shrink-0 ${user.isActive ? 'text-emerald-800' : 'text-stone-600'}`}>{user.isActive ? 'Activo' : 'Inactivo'}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                    <span className="text-stone-500">Acceso: <strong className="text-ink">{user.fullName}</strong></span>
                    <span className="text-stone-600">&middot;</span>
                    <span className="text-stone-500">Codigo: <strong className="text-ink">{user.hasAccessCode ? 'OK' : 'Pendiente'}</strong></span>
                    <span className="text-stone-600">&middot;</span>
                    <span className="text-stone-600">{formatDateTime(user.lastLoginAt)}</span>
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button type="button" variant="secondary" size="sm" className="text-[11px]"
                    onClick={() => toggleStatus.mutate({ id: user.id, isActive: !user.isActive })}>
                    {user.isActive ? 'Desactivar' : 'Activar'}
                  </Button>
                  <button type="button" className="text-stone-500 hover:text-red-700 transition"
                    aria-label={`Eliminar mesero ${user.fullName}`}
                    disabled={deleteUser.isPending}
                    onClick={() => setConfirmDelete({ id: user.id, name: user.fullName })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              );
            })}

            {!waiterUsers.length ? (
              <div className="p-6">
                <EmptyState
                  title="Sin meseros"
                  description="Crea aquí los accesos de meseros."
                />
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">{selectedWaiter ? 'Editar mesero' : 'Nuevo mesero'}</h2>
              <p className="mt-1 text-sm text-stone-500">Solo nombre y código de acceso para la app de meseros.</p>
            </div>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveWaiter.mutate();
            }}
          >
            <Field label="Nombre del mesero">
              <Input
                value={waiterForm.fullName}
                onChange={(event) => setWaiterForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Ej. Laura"
              />
            </Field>

            <Field label={selectedWaiter ? 'Nuevo código de acceso' : 'Código de acceso'}>
              <div className="flex gap-3">
                <Input
                  value={waiterForm.accessCode}
                  onChange={(event) => setWaiterForm((current) => ({ ...current, accessCode: event.target.value.toUpperCase() }))}
                  placeholder="Ej. M124578"
                  className="uppercase tracking-[0.18em]"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setWaiterForm((current) => ({ ...current, accessCode: generateOperationalCode('M') }))}
                >
                  <KeyRound className="h-4 w-4" />
                  Generar código
                </Button>
              </div>
            </Field>

            {configuredWaiterCode ? (
              <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Código configurado
                </p>
                <p className="mt-1 text-base font-semibold tracking-[0.18em] text-emerald-900">
                  {configuredWaiterCode}
                </p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={saveWaiter.isPending}>
                {saveWaiter.isPending ? 'Guardando mesero...' : selectedWaiter ? 'Guardar cambios' : 'Crear mesero'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSelectedWaiter(null);
                  setWaiterForm(initialOperationalForm);
                }}
              >
                Limpiar
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-4 border-b border-stone-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Domiciliarios</h2>
              <p className="mt-1 text-sm text-stone-500">Accesos móviles para entregar pedidos, ver ubicación y actualizar el reparto.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSelectedDeliveryRider(null);
                setDeliveryForm({
                  ...initialOperationalForm,
                  accessCode: generateOperationalCode('D'),
                });
              }}
            >
              Nuevo domiciliario
            </Button>
          </div>

          <div className="hide-scrollbar max-h-[24rem] min-h-0 overflow-y-auto divide-y divide-stone-100">
            {deliveryUsers.map((user) => {
              const isSelected = selectedDeliveryRider?.id === user.id;
              return (
              <div key={user.id} className={`flex items-center justify-between gap-3 px-5 py-3 border transition ${
                isSelected ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200 shadow-sm border-l-[3px] border-l-brand-400' : 'border-transparent hover:bg-stone-50/50'
              }`}>
                <button
                  type="button"
                  className="text-left flex-1 min-w-0"
                  onClick={() => { setSelectedDeliveryRider(user); setDeliveryForm({ fullName: user.fullName, accessCode: '' }); }}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-extrabold text-ink truncate">{user.fullName}</p>
                    <span className={`text-[10px] font-bold shrink-0 ${user.isActive ? 'text-emerald-800' : 'text-stone-600'}`}>{user.isActive ? 'Activo' : 'Inactivo'}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                    <span className="text-stone-500">Acceso: <strong className="text-ink">{user.fullName}</strong></span>
                    <span className="text-stone-600">&middot;</span>
                    <span className="text-stone-500">Codigo: <strong className="text-ink">{user.hasAccessCode ? 'OK' : 'Pendiente'}</strong></span>
                    <span className="text-stone-600">&middot;</span>
                    <span className="text-stone-600">{formatDateTime(user.lastLoginAt)}</span>
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button type="button" variant="secondary" size="sm" className="text-[11px]"
                    onClick={() => toggleStatus.mutate({ id: user.id, isActive: !user.isActive })}>
                    {user.isActive ? 'Desactivar' : 'Activar'}
                  </Button>
                  <button type="button" className="text-stone-500 hover:text-red-700 transition"
                    aria-label={`Eliminar domiciliario ${user.fullName}`}
                    disabled={deleteUser.isPending}
                    onClick={() => setConfirmDelete({ id: user.id, name: user.fullName })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              );
            })}

            {!deliveryUsers.length ? (
              <div className="p-6">
                <EmptyState
                  title="Sin domiciliarios"
                  description="Crea aquí los accesos del panel de reparto."
                />
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">{selectedDeliveryRider ? 'Editar domiciliario' : 'Nuevo domiciliario'}</h2>
              <p className="mt-1 text-sm text-stone-500">Solo nombre y código de acceso para el panel de entregas.</p>
            </div>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveDeliveryRider.mutate();
            }}
          >
            <Field label="Nombre del domiciliario">
              <Input
                value={deliveryForm.fullName}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Ej. Andrés"
              />
            </Field>

            <Field label={selectedDeliveryRider ? 'Nuevo código de acceso' : 'Código de acceso'}>
              <div className="flex gap-3">
                <Input
                  value={deliveryForm.accessCode}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, accessCode: event.target.value.toUpperCase() }))}
                  placeholder="Ej. D124578"
                  className="uppercase tracking-[0.18em]"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeliveryForm((current) => ({ ...current, accessCode: generateOperationalCode('D') }))}
                >
                  <KeyRound className="h-4 w-4" />
                  Generar código
                </Button>
              </div>
            </Field>

            {configuredDeliveryCode ? (
              <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Código configurado
                </p>
                <p className="mt-1 text-base font-semibold tracking-[0.18em] text-emerald-900">
                  {configuredDeliveryCode}
                </p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={saveDeliveryRider.isPending}>
                {saveDeliveryRider.isPending ? 'Guardando domiciliario...' : selectedDeliveryRider ? 'Guardar cambios' : 'Crear domiciliario'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSelectedDeliveryRider(null);
                  setDeliveryForm(initialOperationalForm);
                }}
              >
                Limpiar
              </Button>
            </div>
          </form>
        </Card>
      </div>
      {confirmDelete ? (
        <ConfirmDialog
          open
          title="Eliminar usuario"
          message={`¿Eliminar ${confirmDelete.name}? Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          destructive
          onConfirm={() => {
            deleteUser.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}
