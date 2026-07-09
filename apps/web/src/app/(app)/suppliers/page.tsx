'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/section-title';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { matchesSearch } from '@/lib/format';

type Supplier = {
  id: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
};

type SupplierForm = {
  name: string;
  taxId: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
};

const initialForm: SupplierForm = {
  name: '',
  taxId: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  isActive: true,
};

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(initialForm);
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ supplier: Supplier; action: 'toggle' | 'delete' } | null>(null);

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<Supplier[]>('/suppliers'),
  });

  const filteredSuppliers = useMemo(
    () =>
      (suppliers.data ?? []).filter((supplier) =>
        matchesSearch(
          [supplier.name, supplier.contactName, supplier.phone, supplier.email, supplier.address],
          search,
        ),
      ),
    [suppliers.data, search],
  );

  const saveSupplier = useMutation({
    mutationFn: async () => {
      if (selectedSupplier) {
        return apiFetch(`/suppliers/${selectedSupplier.id}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
      }

      return apiFetch('/suppliers', {
        method: 'POST',
        body: JSON.stringify(form),
      });
    },
    onSuccess: async () => {
      toast.success(selectedSupplier ? 'Proveedor actualizado' : 'Proveedor creado');
      setSelectedSupplier(null);
      setForm(initialForm);
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/suppliers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: async (_, variables) => {
      toast.success(variables.isActive ? 'Proveedor activado' : 'Proveedor desactivado');
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const deleteSupplier = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/suppliers/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast.success('Proveedor eliminado');
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo eliminar el proveedor. Si tiene historial, desactívalo para evitar nuevas compras.',
      );
    },
  });

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <SectionTitle
        eyebrow="Abastecimiento"
        title="Proveedores"
        description="Base de abastecimiento para compras rápidas y organizadas."
        status={<Badge tone="info">{suppliers.data?.length ?? 0} proveedores</Badge>}
        actions={
          <Button type="button" variant="secondary" size="sm" onClick={() => { setSelectedSupplier(null); setForm(initialForm); }} data-testid="supplier-form">
            Nuevo proveedor
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        {/* LEFT: List */}
        <Card className="overflow-hidden p-0" data-testid="suppliers-list">
          <div className="space-y-3 border-b border-stone-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Base de proveedores</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Contacto, canal y estado comercial.</p>
            </div>
            <div className="relative" data-testid="suppliers-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proveedor..." className="pl-9" />
            </div>
          </div>

          <div className="hide-scrollbar max-h-[28rem] overflow-y-auto divide-y divide-stone-100">
            {filteredSuppliers.map((supplier) => (
              <div key={supplier.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-stone-50/50 transition" data-testid="supplier-card">
                <button
                  type="button"
                  className="text-left flex-1 min-w-0"
                  onClick={() => setDetailSupplier(supplier)}
                  data-testid="supplier-detail-button"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-extrabold text-ink truncate">{supplier.name}</p>
                    <span className={`text-[10px] font-bold uppercase tracking-[0.06em] ${supplier.isActive ? 'text-emerald-600' : 'text-stone-400'}`} data-testid="supplier-status-badge">
                      {supplier.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-stone-500 truncate">
                    {supplier.contactName || 'Sin contacto'} &middot; {supplier.phone || 'Sin teléfono'}
                  </p>
                </button>
                <Button type="button" variant="secondary" size="sm" className="shrink-0"
                  onClick={() => setConfirmAction({ supplier, action: 'toggle' })}
                  data-testid={supplier.isActive ? 'supplier-deactivate-button' : 'supplier-activate-button'}>
                  {supplier.isActive ? 'Desactivar' : 'Activar'}
                </Button>
              </div>
            ))}
            {!filteredSuppliers.length ? (
              <div className="p-8">
                <EmptyState title="Sin proveedores" description="Crea un proveedor o ajusta la búsqueda." />
              </div>
            ) : null}
          </div>
        </Card>

        {/* RIGHT: Form */}
        <Card data-testid="supplier-form">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600"><Truck className="h-5 w-5" /></div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">{selectedSupplier ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Informacion comercial y canal de contacto.</p>
            </div>
          </div>

          <form className="mt-5 grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveSupplier.mutate(); }}>
            <Field label="Nombre" required><Input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} data-testid="supplier-name-input" /></Field>
            <Field label="NIT / identificacion"><Input value={form.taxId} onChange={(e) => setForm((c) => ({ ...c, taxId: e.target.value }))} data-testid="supplier-nit-input" /></Field>
            <Field label="Contacto"><Input value={form.contactName} onChange={(e) => setForm((c) => ({ ...c, contactName: e.target.value }))} data-testid="supplier-contact-input" /></Field>
            <Field label="Telefono"><Input value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} data-testid="supplier-phone-input" /></Field>
            <Field label="Correo"><Input type="email" value={form.email} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} data-testid="supplier-email-input" /></Field>
            <label className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
              <div>
                <p className="text-[13px] font-bold text-ink">Proveedor activo</p>
                <p className="text-[11px] text-stone-500">Visible en compras nuevas.</p>
              </div>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))} className="h-4 w-4 rounded border-stone-300 text-stone-900" data-testid="supplier-active-toggle" />
            </label>
            <div className="md:col-span-2"><Field label="Direccion"><Input value={form.address} onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))} data-testid="supplier-address-input" /></Field></div>
            <div className="md:col-span-2"><Field label="Notas" hint="Opcional."><Textarea value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} className="min-h-[4rem]" data-testid="supplier-notes-input" /></Field></div>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" className="flex-1" disabled={saveSupplier.isPending} data-testid="supplier-save-button">
                {saveSupplier.isPending ? 'Guardando...' : selectedSupplier ? 'Guardar cambios' : 'Crear proveedor'}
              </Button>
              {selectedSupplier ? (
                <Button type="button" variant="secondary" onClick={() => { setSelectedSupplier(null); setForm(initialForm); }}>Cancelar</Button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>

      {/* Detail Modal */}
      {detailSupplier ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="supplier-detail-modal">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailSupplier(null)} />
          <div className="relative w-full max-w-md rounded-[1.5rem] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-[15px] font-extrabold text-ink">{detailSupplier.name}</h3>
                <span className={`text-[10px] font-bold uppercase tracking-[0.06em] ${detailSupplier.isActive ? 'text-emerald-600' : 'text-stone-400'}`}>{detailSupplier.isActive ? 'Activo' : 'Inactivo'}</span>
              </div>
              <button type="button" className="text-stone-400 hover:text-ink text-lg" onClick={() => setDetailSupplier(null)}>&times;</button>
            </div>
            <div className="space-y-2">
              {detailSupplier.taxId ? <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">NIT</p><p className="mt-0.5 text-[12px] font-bold text-ink">{detailSupplier.taxId}</p></div> : null}
              {detailSupplier.contactName ? <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Contacto</p><p className="mt-0.5 text-[12px] font-bold text-ink">{detailSupplier.contactName}</p></div> : null}
              {detailSupplier.phone ? <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Telefono</p><p className="mt-0.5 text-[12px] font-bold text-ink">{detailSupplier.phone}</p></div> : null}
              {detailSupplier.email ? <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Correo</p><p className="mt-0.5 text-[12px] font-bold text-ink">{detailSupplier.email}</p></div> : null}
              {detailSupplier.address ? <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Direccion</p><p className="mt-0.5 text-[12px] font-bold text-ink">{detailSupplier.address}</p></div> : null}
              {detailSupplier.notes ? <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Notas</p><p className="mt-0.5 text-[12px] font-bold text-ink">{detailSupplier.notes}</p></div> : null}
            </div>
            <div className="mt-5 flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => { setSelectedSupplier(detailSupplier); setForm({ name: detailSupplier.name, taxId: detailSupplier.taxId ?? '', contactName: detailSupplier.contactName ?? '', phone: detailSupplier.phone ?? '', email: detailSupplier.email ?? '', address: detailSupplier.address ?? '', notes: detailSupplier.notes ?? '', isActive: detailSupplier.isActive }); setDetailSupplier(null); }}>Editar</Button>
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => { setConfirmAction({ supplier: detailSupplier, action: 'toggle' }); setDetailSupplier(null); }}>
                {detailSupplier.isActive ? 'Desactivar' : 'Activar'}
              </Button>
              <Button size="sm" variant="secondary" className="flex-1 text-red-600" onClick={() => { setConfirmAction({ supplier: detailSupplier, action: 'delete' }); setDetailSupplier(null); }} data-testid="supplier-delete-button">Eliminar</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm Modal */}
      {confirmAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="supplier-delete-confirm-modal">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmAction(null)} />
          <div className="relative w-full max-w-sm rounded-[1.5rem] border border-stone-200 bg-white p-6 shadow-xl text-center">
            <p className="text-[15px] font-extrabold text-ink">
              {confirmAction.action === 'toggle'
                ? (confirmAction.supplier.isActive ? 'Desactivar proveedor' : 'Activar proveedor')
                : 'Eliminar proveedor'}
            </p>
            <p className="mt-2 text-[12px] text-stone-500 leading-5">
              {confirmAction.action === 'delete'
                ? 'Si el proveedor tiene historial de compras, se recomienda desactivarlo en lugar de eliminarlo.'
                : 'El proveedor seguira en el historial pero no aparecera en compras nuevas.'}
            </p>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => setConfirmAction(null)}>Cancelar</Button>
              <Button size="sm" className={`flex-1 ${confirmAction.action === 'delete' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}`}
                onClick={() => {
                  if (confirmAction.action === 'toggle') {
                    toggleStatus.mutate({ id: confirmAction.supplier.id, isActive: !confirmAction.supplier.isActive });
                  } else {
                    deleteSupplier.mutate(confirmAction.supplier.id);
                  }
                  setConfirmAction(null);
                }}>
                {confirmAction.action === 'toggle'
                  ? (confirmAction.supplier.isActive ? 'Desactivar' : 'Activar')
                  : 'Eliminar'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
