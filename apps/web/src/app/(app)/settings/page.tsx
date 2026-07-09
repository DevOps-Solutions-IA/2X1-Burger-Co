'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Clock3, DatabaseBackup, MessageCircle, Printer, Settings2, Store, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/section-title';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';

type SettingRecord = {
  key: string;
  category: string | null;
  description: string | null;
  value: Record<string, unknown>;
};

type SettingsForm = {
  businessName: string;
  logoUrl: string;
  phone: string;
  address: string;
  currency: string;
  receiptFooter: string;
  allowOpenSaleWithoutSession: boolean;
  timezone: string;
  printSignature: boolean;
  closingSummaryEnabled: boolean;
  closingSummaryGroupLabel: string;
  closingSummaryGroupInviteCode: string;
  closingSummaryGroupJid: string;
};

type OperationsStatus = {
  backup: {
    cronExpression: string;
    nextRunAt: string | null;
    latest: {
      fileName: string;
      absolutePath: string;
      sizeBytes: number;
      createdAt: string;
    } | null;
  };
  catalogSyncEvents: Array<{
    id: string;
    action: string;
    createdAt: string;
    entityId: string | null;
    actor: string;
    source: string | null;
    reason: string | null;
  }>;
};

const initialForm: SettingsForm = {
  businessName: '2x1 Burger Co',
  logoUrl: '',
  phone: '',
  address: '',
  currency: 'COP',
  receiptFooter: '',
  allowOpenSaleWithoutSession: false,
  timezone: 'America/Bogota',
  printSignature: true,
  closingSummaryEnabled: false,
  closingSummaryGroupLabel: '',
  closingSummaryGroupInviteCode: '',
  closingSummaryGroupJid: '',
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm>(initialForm);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<SettingRecord[]>('/settings'),
  });
  const operationsStatus = useQuery({
    queryKey: ['settings-operations-status'],
    queryFn: () => apiFetch<OperationsStatus>('/settings/operations-status'),
  });

  useEffect(() => {
    if (!settings.data) {
      return;
    }

    const profile = settings.data.find((item) => item.key === 'business.profile')?.value ?? {};
    const posDefaults = settings.data.find((item) => item.key === 'pos.defaults')?.value ?? {};
    const reports = settings.data.find((item) => item.key === 'reports.daily-close')?.value ?? {};
    const whatsapp = settings.data.find((item) => item.key === 'whatsapp.closing-summary')?.value ?? {};

    setForm({
      businessName: String(profile.name ?? initialForm.businessName),
      logoUrl: String(profile.logoUrl ?? ''),
      phone: String(profile.phone ?? ''),
      address: String(profile.address ?? ''),
      currency: String(profile.currency ?? 'COP'),
      receiptFooter: String(posDefaults.receiptFooter ?? ''),
      allowOpenSaleWithoutSession: Boolean(posDefaults.allowOpenSaleWithoutSession ?? false),
      timezone: String(reports.timezone ?? 'America/Bogota'),
      printSignature: Boolean(reports.printSignature ?? true),
      closingSummaryEnabled: Boolean(whatsapp.enabled ?? false),
      closingSummaryGroupLabel: String(whatsapp.groupLabel ?? ''),
      closingSummaryGroupInviteCode: String(whatsapp.groupInviteCode ?? ''),
      closingSummaryGroupJid: String(whatsapp.groupJid ?? ''),
    });
  }, [settings.data]);

  const linkWhatsappGroup = useMutation({
    mutationFn: () =>
      apiFetch<{
        success: boolean;
        inviteCode: string;
        groupJid: string;
        groupLabel: string | null;
        linkedAt: string;
      }>('/whatsapp/daily-close-group/link', {
        method: 'POST',
        body: JSON.stringify({
          inviteLink: form.closingSummaryGroupInviteCode,
        }),
      }),
    onSuccess: (response) => {
      setForm((current) => ({
        ...current,
        closingSummaryEnabled: true,
        closingSummaryGroupInviteCode: response.inviteCode,
        closingSummaryGroupJid: response.groupJid,
        closingSummaryGroupLabel: response.groupLabel ?? current.closingSummaryGroupLabel,
      }));
      toast.success('Grupo de cierre enlazado y listo para automatización.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos enlazar el grupo de WhatsApp.'),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      apiFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          items: [
            {
              key: 'business.profile',
              category: 'business',
              description: 'Perfil básico del negocio',
              value: {
                name: form.businessName,
                logoUrl: form.logoUrl,
                phone: form.phone,
                address: form.address,
                currency: form.currency,
              },
            },
            {
              key: 'pos.defaults',
              category: 'pos',
              description: 'Comportamiento por defecto del punto de venta',
              value: {
                receiptFooter: form.receiptFooter,
                allowOpenSaleWithoutSession: form.allowOpenSaleWithoutSession,
              },
            },
            {
              key: 'reports.daily-close',
              category: 'reports',
              description: 'Configuración visual del cierre diario',
              value: {
                printSignature: form.printSignature,
                timezone: form.timezone,
              },
            },
            {
              key: 'whatsapp.closing-summary',
              category: 'whatsapp',
              description: 'Configuración del grupo que recibe el cierre diario',
              value: {
                enabled: form.closingSummaryEnabled,
                groupLabel: form.closingSummaryGroupLabel,
                groupInviteCode: form.closingSummaryGroupInviteCode,
                groupJid: form.closingSummaryGroupJid,
              },
            },
          ],
        }),
      }),
    onSuccess: async () => {
      toast.success('Configuración actualizada');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar la configuración'),
  });

  const settingCards = useMemo(
    () => [
      { icon: Store, label: 'Negocio', value: form.businessName || 'Sin nombre' },
      { icon: Wallet, label: 'Moneda', value: form.currency || 'COP' },
      { icon: Printer, label: 'Firma impresa', value: form.printSignature ? 'Habilitada' : 'Oculta' },
    ],
    [form.businessName, form.currency, form.printSignature],
  );

  const operationsCards = useMemo(
    () => [
      {
        icon: DatabaseBackup,
        label: 'Último backup',
        value: operationsStatus.data?.backup.latest
          ? new Date(operationsStatus.data.backup.latest.createdAt).toLocaleString('es-CO')
          : 'Sin backup detectado',
      },
      {
        icon: Clock3,
        label: 'Próximo backup',
        value: operationsStatus.data?.backup.nextRunAt
          ? new Date(operationsStatus.data.backup.nextRunAt).toLocaleString('es-CO')
          : operationsStatus.data?.backup.cronExpression ?? 'No configurado',
      },
      {
        icon: Settings2,
        label: 'Catálogo auditado',
        value: `${operationsStatus.data?.catalogSyncEvents.length ?? 0} eventos recientes`,
      },
      {
        icon: MessageCircle,
        label: 'WhatsApp cierre',
        value: form.closingSummaryEnabled
          ? form.closingSummaryGroupLabel || (form.closingSummaryGroupJid ? 'Grupo enlazado' : 'Grupo pendiente')
          : 'Desactivado',
      },
    ],
    [operationsStatus.data, form.closingSummaryEnabled, form.closingSummaryGroupJid, form.closingSummaryGroupLabel],
  );

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <SectionTitle
        eyebrow="Administracion"
        title="Configuracion"
        description="Perfil comercial, reglas operativas y cierre diario."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {settingCards.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="bg-white/95">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold text-stone-400">{item.label}</p>
                  <p className="mt-1 text-[18px] font-extrabold text-ink">{item.value}</p>
                </div>
                <div className="rounded-xl bg-stone-100 p-2.5 text-stone-500">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <form
        className="grid gap-5 xl:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          saveSettings.mutate();
        }}
      >
        <Card className="h-full space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Perfil del negocio</h2>
              <p className="text-[11px] text-stone-500">Datos visibles en reportes.</p>
            </div>
          </div>
          <Field label="Nombre del negocio">
            <Input value={form.businessName} onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))} />
          </Field>
          <Field label="Teléfono">
            <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </Field>
          <Field label="Logo URL">
            <Input value={form.logoUrl} onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))} placeholder="https://..." />
          </Field>
          <Field label="Dirección">
            <Textarea value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} className="min-h-24" />
          </Field>
          <Field label="Moneda">
            <Input value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} />
          </Field>
        </Card>

        <Card className="h-full space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Punto de venta y operación</h2>
              <p className="text-[11px] text-stone-500">Comportamiento del flujo de caja y venta.</p>
            </div>
          </div>
          <Field label="Mensaje pie de recibo">
            <Textarea value={form.receiptFooter} onChange={(event) => setForm((current) => ({ ...current, receiptFooter: event.target.value }))} className="min-h-24" />
          </Field>
          <label className="flex items-center justify-between rounded-[1.5rem] border border-stone-200 bg-stone-50 px-3.5 py-3.5">
            <div>
              <p className="text-[14px] font-bold text-ink">Permitir venta sin caja</p>
              <p className="text-[11px] text-stone-500">Mantener apagado en operacion.</p>
            </div>
            <input
              type="checkbox"
              checked={form.allowOpenSaleWithoutSession}
              onChange={(event) =>
                setForm((current) => ({ ...current, allowOpenSaleWithoutSession: event.target.checked }))
              }
              className="h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
            />
          </label>
        </Card>

        <Card className="h-full space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-stone-100 p-2.5 text-stone-600">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Cierre y reporte</h2>
              <p className="text-[11px] text-stone-500">Parametros de cierre diario e impresion.</p>
            </div>
          </div>
          <Field label="Zona horaria" hint="Fijada en Bogota, Colombia.">
            <Input value={form.timezone} readOnly disabled />
          </Field>
          <label className="flex items-center justify-between rounded-[1.5rem] border border-stone-200 bg-stone-50 px-3.5 py-3.5">
            <div>
              <p className="text-[14px] font-bold text-ink">Mostrar firma en PDF</p>
              <p className="text-[11px] text-stone-500">Validacion manual en PDF.</p>
            </div>
            <input
              type="checkbox"
              checked={form.printSignature}
              onChange={(event) => setForm((current) => ({ ...current, printSignature: event.target.checked }))}
              className="h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
            />
          </label>
          <label className="flex items-center justify-between rounded-[1.5rem] border border-stone-200 bg-stone-50 px-3.5 py-3.5">
            <div>
              <p className="text-[14px] font-bold text-ink">Cierre a WhatsApp</p>
              <p className="text-[11px] text-stone-500">Envio automatico al grupo.</p>
            </div>
            <input
              type="checkbox"
              checked={form.closingSummaryEnabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, closingSummaryEnabled: event.target.checked }))
              }
              className="h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
            />
          </label>
          <Field label="Nombre del grupo de cierre">
            <Input
              value={form.closingSummaryGroupLabel}
              onChange={(event) =>
                setForm((current) => ({ ...current, closingSummaryGroupLabel: event.target.value }))
              }
              placeholder="Ej. Equipo cierre nocturno"
            />
          </Field>
          <Field
            label="Código o enlace del grupo"
            hint="Pega el enlace de invitacion. El sistema extrae el codigo."
          >
            <Input
              value={form.closingSummaryGroupInviteCode}
              onChange={(event) =>
                setForm((current) => ({ ...current, closingSummaryGroupInviteCode: event.target.value }))
              }
              placeholder="https://chat.whatsapp.com/..."
            />
          </Field>
          <Field label="Grupo enlazado">
            <Input value={form.closingSummaryGroupJid} readOnly placeholder="Se completa al validar" />
          </Field>

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={!form.closingSummaryGroupInviteCode.trim() || linkWhatsappGroup.isPending}
            onClick={() => linkWhatsappGroup.mutate()}
          >
            {linkWhatsappGroup.isPending ? 'Enlazando grupo...' : 'Validar y enlazar grupo'}
          </Button>

          <Button type="submit" className="w-full" disabled={saveSettings.isPending}>
            {saveSettings.isPending ? 'Guardando configuración...' : 'Guardar configuración'}
          </Button>
        </Card>
      </form>

      <Card className="space-y-3">
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">Ubicacion base</h2>
          <p className="mt-0.5 text-[12px] text-stone-500">Origen para calcular rutas de domicilio.</p>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">Direccion</p><p className="mt-0.5 text-[11px] font-bold text-ink truncate">{form.address || 'Pendiente'}</p></div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">Latitud</p><p className="mt-0.5 text-[11px] font-bold text-ink">—</p></div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">Longitud</p><p className="mt-0.5 text-[11px] font-bold text-ink">—</p></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-amber-700">Estado</p><p className="mt-0.5 text-[11px] font-bold text-amber-800">Pendiente</p></div>
        </div>
        <p className="text-[11px] text-stone-500">Sin coordenadas no se pueden calcular rutas automaticas.</p>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="space-y-3">
          <div>
            <h2 className="text-[15px] font-extrabold text-ink">Respaldo y proteccion</h2>
            <p className="mt-0.5 text-[12px] text-stone-500">Backup automatico y referencias operativas.</p>
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            {operationsCards.map((item) => (

                <div key={item.label} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">{item.label}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-ink truncate">{item.value}</p>
                </div>
              ))}
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Detalle tecnico</p>
              <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[10px] font-bold text-stone-500">Automatico</span>
            </div>
            <div className="grid gap-1 text-[11px]">
              <div className="flex justify-between gap-2"><span className="text-stone-500">Cron</span><span className="font-bold text-ink">{operationsStatus.data?.backup.cronExpression ?? '—'}</span></div>
              <div className="flex justify-between gap-2"><span className="text-stone-500">Archivo</span><span className="font-bold text-ink truncate">{operationsStatus.data?.backup.latest?.fileName ?? '—'}</span></div>
              <div className="flex justify-between gap-2"><span className="text-stone-500">Tamano</span><span className="font-bold text-ink">{operationsStatus.data?.backup.latest ? `${(operationsStatus.data.backup.latest.sizeBytes / 1024 / 1024).toFixed(2)} MB` : '—'}</span></div>
            </div>
          </div>
        </Card>

        <Card className="space-y-3">
          <div>
            <h2 className="text-[15px] font-extrabold text-ink">Trazabilidad de catalogo</h2>
            <p className="mt-0.5 text-[12px] text-stone-500">Cambios recientes de sincronizacion.</p>
          </div>
          <div className="max-h-[16rem] space-y-1.5 overflow-y-auto">
            {operationsStatus.data?.catalogSyncEvents.length ? (
              operationsStatus.data.catalogSyncEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-ink">{event.action} &middot; {event.actor}</p>
                    <p className="text-[10px] text-stone-400">{new Date(event.createdAt).toLocaleString('es-CO')}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-5 text-center">
                <p className="text-[12px] font-bold text-stone-400">Sin eventos recientes</p>
                <p className="mt-0.5 text-[11px] text-stone-400">Los cambios de catalogo apareceran aqui.</p>
              </div>
            )}
          </div>
        </Card>

        <DeliveryRatesPanel />
      </div>
    </div>
  );
}

function DeliveryRatesPanel() {
  return (
    <Card>
      <div data-testid="settings-delivery-reset-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Configuración de domicilios</h2>
            <p className="mt-1 text-[13px] leading-6 text-stone-600">
              El backend calcula la tarifa de domicilio con dirección, zona, ruta, reglas del negocio y proveedores configurados.
            </p>
          </div>
          <Badge tone="success">Automático</Badge>
        </div>

        <div className="rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900">
          <p className="font-semibold">Cálculo automático activo.</p>
          <p className="mt-1">
            El POS solo captura dirección, barrio y referencia. La tarifa final la calcula el backend y se conserva en comanda, venta, caja y comprobante.
          </p>
          <p className="mt-2">
            Si la dirección es insuficiente, ambigua, fuera de cobertura o el proveedor no está disponible, el sistema bloquea el checkout y solicita corregir la dirección. No se ingresa tarifa en POS.
          </p>
        </div>
      </div>
    </Card>
  );
}
