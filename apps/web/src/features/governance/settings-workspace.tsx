'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Clock3, DatabaseBackup, Printer, Save, ShieldCheck, Store, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MetricSurface, PageHeader, QueryState, StatusBadge, Timeline } from '@/components/product';
import { useAuth } from '@/features/auth/auth-provider';
import { apiFetch } from '@/lib/api';
import { errorIsPermissionDenied, fetchOperationsStatus, fetchSettings, formatDateTime, humanize } from './queries';

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
};

const emptyForm: SettingsForm = {
  businessName: '',
  logoUrl: '',
  phone: '',
  address: '',
  currency: 'COP',
  receiptFooter: '',
  allowOpenSaleWithoutSession: false,
  timezone: 'America/Bogota',
  printSignature: true,
};

export function SettingsWorkspace() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('admin') ?? false;
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const settings = useQuery({ queryKey: ['governance', 'settings'], queryFn: fetchSettings });
  const operations = useQuery({
    queryKey: ['governance', 'settings', 'operations'],
    queryFn: fetchOperationsStatus,
    enabled: isAdmin,
  });

  useEffect(() => {
    if (!settings.data) return;
    const profile = settings.data.find((item) => item.key === 'business.profile')?.value ?? {};
    const pos = settings.data.find((item) => item.key === 'pos.defaults')?.value ?? {};
    const reports = settings.data.find((item) => item.key === 'reports.daily-close')?.value ?? {};
    setForm({
      businessName: typeof profile.name === 'string' ? profile.name : '',
      logoUrl: typeof profile.logoUrl === 'string' ? profile.logoUrl : '',
      phone: typeof profile.phone === 'string' ? profile.phone : '',
      address: typeof profile.address === 'string' ? profile.address : '',
      currency: typeof profile.currency === 'string' ? profile.currency : 'COP',
      receiptFooter: typeof pos.receiptFooter === 'string' ? pos.receiptFooter : '',
      allowOpenSaleWithoutSession: pos.allowOpenSaleWithoutSession === true,
      timezone: typeof reports.timezone === 'string' ? reports.timezone : 'America/Bogota',
      printSignature: reports.printSignature !== false,
    });
  }, [settings.data]);

  const notificationConfig = settings.data?.find((item) => item.key === 'whatsapp.closing-summary')?.value;
  const closingSummaryEnabled = notificationConfig?.enabled === true;

  const save = useMutation({
    mutationFn: () => {
      if (!form.businessName.trim()) throw new Error('El nombre del negocio es obligatorio.');
      if (!/^[A-Z]{3}$/.test(form.currency.trim().toUpperCase())) throw new Error('La moneda debe usar un código ISO de tres letras.');
      return apiFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          items: [
            {
              key: 'business.profile',
              category: 'business',
              description: 'Perfil básico del negocio',
              value: {
                name: form.businessName.trim(),
                logoUrl: form.logoUrl.trim(),
                phone: form.phone.trim(),
                address: form.address.trim(),
                currency: form.currency.trim().toUpperCase(),
              },
            },
            {
              key: 'pos.defaults',
              category: 'pos',
              description: 'Comportamiento por defecto del punto de venta',
              value: {
                receiptFooter: form.receiptFooter.trim(),
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
          ],
        }),
      });
    },
    onSuccess: async () => {
      toast.success('Configuración actualizada');
      await queryClient.invalidateQueries({ queryKey: ['governance', 'settings'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No fue posible actualizar la configuración.'),
  });

  const catalogTimeline = useMemo(() => (operations.data?.catalogSyncEvents ?? []).map((event) => ({
    id: event.id,
    title: humanize(event.action),
    timestamp: formatDateTime(event.createdAt),
    description: `${event.actor}${event.reason ? ` · ${event.reason}` : ''}`,
    metadata: event.source ? <span className="rounded-full border border-line bg-canvas px-2 py-1 text-xs font-medium text-muted">{humanize(event.source)}</span> : undefined,
    tone: 'info' as const,
  })), [operations.data]);

  const queryStatus = settings.isPending
    ? 'loading'
    : errorIsPermissionDenied(settings.error)
      ? 'permission_denied'
      : settings.isError
        ? 'error'
        : 'ready';

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Administración"
        title="Configuración operacional"
        description="Identidad del negocio y reglas existentes de POS y reportes. Las capacidades de SOFIA se gobiernan por separado."
        status={<StatusBadge status={isAdmin ? 'ACTIVE' : 'CLAIMED'} label={isAdmin ? 'Edición administrativa' : 'Solo lectura'} tone={isAdmin ? 'success' : 'info'} />}
        actions={isAdmin ? <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || settings.isPending}><Save className="h-4 w-4" aria-hidden="true" />{save.isPending ? 'Guardando…' : 'Guardar cambios'}</Button> : undefined}
      />

      <QueryState status={queryStatus} onRetry={() => void settings.refetch()}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
          <div className="space-y-4">
            <SettingsSection icon={<Building2 className="h-5 w-5" />} title="Perfil del negocio" description="Datos impresos o visibles en flujos operativos.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre comercial" required><Input value={form.businessName} onChange={(event) => setForm((value) => ({ ...value, businessName: event.target.value }))} disabled={!isAdmin} /></Field>
                <Field label="Moneda" hint="Código ISO, por ejemplo COP."><Input value={form.currency} onChange={(event) => setForm((value) => ({ ...value, currency: event.target.value.toUpperCase() }))} maxLength={3} disabled={!isAdmin} /></Field>
                <Field label="Teléfono"><Input value={form.phone} onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))} inputMode="tel" disabled={!isAdmin} /></Field>
                <Field label="Dirección"><Input value={form.address} onChange={(event) => setForm((value) => ({ ...value, address: event.target.value }))} disabled={!isAdmin} /></Field>
                <div className="sm:col-span-2"><Field label="URL del logo" hint="La URL se conserva como configuración; la carga remota está sujeta a controles del servidor."><Input type="url" value={form.logoUrl} onChange={(event) => setForm((value) => ({ ...value, logoUrl: event.target.value }))} disabled={!isAdmin} /></Field></div>
              </div>
            </SettingsSection>

            <SettingsSection icon={<Store className="h-5 w-5" />} title="Punto de venta" description="Comportamiento existente del comprobante y la sesión de caja.">
              <div className="space-y-4">
                <Field label="Pie del comprobante"><Textarea value={form.receiptFooter} onChange={(event) => setForm((value) => ({ ...value, receiptFooter: event.target.value }))} maxLength={500} disabled={!isAdmin} /></Field>
                <label className="flex min-h-12 items-start gap-3 rounded-2xl border border-line bg-canvas p-4">
                  <input type="checkbox" checked={form.allowOpenSaleWithoutSession} onChange={(event) => setForm((value) => ({ ...value, allowOpenSaleWithoutSession: event.target.checked }))} disabled={!isAdmin} className="mt-0.5 h-5 w-5 accent-brand-600" />
                  <span><span className="block text-sm font-semibold text-ink">Permitir venta sin sesión abierta</span><span className="mt-1 block text-xs leading-5 text-muted">Regla sensible de POS. El servidor conserva la autoridad.</span></span>
                </label>
              </div>
            </SettingsSection>

            <SettingsSection icon={<Printer className="h-5 w-5" />} title="Cierre diario" description="Presentación y zona horaria de reportes.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Zona horaria" hint="El backend normaliza actualmente America/Bogota."><Input value={form.timezone} disabled /></Field>
                <label className="flex min-h-12 items-start gap-3 rounded-2xl border border-line bg-canvas p-4">
                  <input type="checkbox" checked={form.printSignature} onChange={(event) => setForm((value) => ({ ...value, printSignature: event.target.checked }))} disabled={!isAdmin} className="mt-0.5 h-5 w-5 accent-brand-600" />
                  <span><span className="block text-sm font-semibold text-ink">Imprimir espacio de firma</span><span className="mt-1 block text-xs text-muted">Aparece en el cierre diario impreso.</span></span>
                </label>
              </div>
            </SettingsSection>
          </div>

          <aside className="space-y-4">
            <MetricSurface label="Negocio" value={form.businessName || 'Sin configurar'} context="Fuente: business.profile" icon={<Building2 className="h-4 w-4" />} density="compact" />
            <MetricSurface label="Moneda" value={form.currency || 'Sin configurar'} context="Fuente: business.profile" icon={<Wallet className="h-4 w-4" />} density="compact" />
            <MetricSurface label="Resumen WhatsApp" value={closingSummaryEnabled ? 'Configurado' : 'Desactivado'} context="Solo estado. Los identificadores del canal no se exponen aquí." icon={<ShieldCheck className="h-4 w-4" />} density="compact" />
            {isAdmin ? (
              <QueryState status={operations.isPending ? 'loading' : operations.isError ? 'error' : 'ready'} onRetry={() => void operations.refetch()} skeletonRows={3}>
                <div className="space-y-4">
                  <MetricSurface label="Último backup detectado" value={operations.data?.backup.latest ? formatDateTime(operations.data.backup.latest.createdAt) : 'Sin backup detectado'} context={operations.data?.backup.latest ? `${(operations.data.backup.latest.sizeBytes / 1_048_576).toFixed(1)} MB · ${operations.data.backup.latest.fileName}` : 'El contrato no reportó un artefacto.'} icon={<DatabaseBackup className="h-4 w-4" />} density="compact" />
                  <MetricSurface label="Próxima ventana" value={operations.data?.backup.nextRunAt ? formatDateTime(operations.data.backup.nextRunAt) : 'No calculable'} context={`Cron: ${operations.data?.backup.cronExpression ?? 'no disponible'}`} icon={<Clock3 className="h-4 w-4" />} density="compact" />
                  <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
                    <h2 className="font-heading text-base font-semibold text-ink">Actividad de catálogo</h2>
                    {catalogTimeline.length ? <Timeline items={catalogTimeline} density="compact" className="mt-4" /> : <p className="mt-3 text-sm text-muted">No hay eventos recientes reportados.</p>}
                  </section>
                </div>
              </QueryState>
            ) : null}
          </aside>
        </div>
      </QueryState>
    </div>
  );
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
      <header className="mb-5 flex items-start gap-3 border-b border-line pb-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-brand-800" aria-hidden="true">{icon}</span>
        <div><h2 className="font-heading text-lg font-semibold text-ink">{title}</h2><p className="mt-1 text-sm leading-6 text-muted">{description}</p></div>
      </header>
      {children}
    </section>
  );
}
