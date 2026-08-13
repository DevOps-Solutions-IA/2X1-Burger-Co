'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Cable, CirclePause, CreditCard, MessageSquareText, Radio, RefreshCw, ShieldAlert, ShieldCheck, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { DetailDialog, MetricSurface, PageHeader, QueryState, ReadinessSurface, StatusBadge, Timeline } from '@/components/product';
import { useAuth } from '@/features/auth/auth-provider';
import { apiFetch } from '@/lib/api';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import type { EnterpriseStatus } from './contracts';
import { errorIsPermissionDenied, fetchEnterpriseStatus, fetchQrStatus, fetchRuntimeSafety, formatDateTime, humanize } from './queries';

type SafetyAction = 'pause' | 'resume' | 'kill' | 'unkill';

const actionCopy: Record<SafetyAction, { title: string; description: string; endpoint: string; needsReason: boolean }> = {
  pause: {
    title: 'Pausar automatización de SOFIA',
    description: 'Bloquea acciones automáticas de SOFIA sin afectar POS, caja, inventario ni domicilios.',
    endpoint: '/admin/sofia/control/pause-global',
    needsReason: true,
  },
  resume: {
    title: 'Retirar pausa global',
    description: 'SOFIA vuelve únicamente al modo gobernado permitido por los demás gates. No habilita producción ni envíos.',
    endpoint: '/admin/sofia/control/resume-global',
    needsReason: false,
  },
  kill: {
    title: 'Activar kill switch',
    description: 'Aplica el bloqueo operacional de mayor precedencia para automatización y envío.',
    endpoint: '/admin/sofia/control/kill-switch/activate',
    needsReason: true,
  },
  unkill: {
    title: 'Desactivar kill switch',
    description: 'Retira el bloqueo de emergencia, pero conserva producción, outbound, auto-reply y Bold desactivados.',
    endpoint: '/admin/sofia/control/kill-switch/deactivate',
    needsReason: false,
  },
};

export function ActivationControl() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('admin') ?? false;
  const canOperateSafety = isAdmin || (user?.roles.includes('supervisor') ?? false);
  const [pendingAction, setPendingAction] = useState<SafetyAction | null>(null);
  const [reason, setReason] = useState('');

  const enterprise = useQuery({
    queryKey: ['governance', 'activation', 'enterprise'],
    queryFn: fetchEnterpriseStatus,
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
  const runtime = useQuery({
    queryKey: ['governance', 'activation', 'runtime'],
    queryFn: fetchRuntimeSafety,
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
  const qr = useQuery({
    queryKey: ['governance', 'activation', 'qr'],
    queryFn: fetchQrStatus,
    refetchInterval: visiblePolling(POLLING_INTERVAL.critical),
  });

  const control = useMutation({
    mutationFn: async (action: SafetyAction) => {
      const policy = actionCopy[action];
      if (policy.needsReason && reason.trim().length < 8) throw new Error('Registra un motivo de al menos 8 caracteres.');
      return apiFetch(policy.endpoint, {
        method: 'POST',
        body: JSON.stringify(policy.needsReason ? { reason: reason.trim() } : {}),
      });
    },
    onSuccess: async () => {
      toast.success('Control defensivo actualizado');
      setPendingAction(null);
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['governance', 'activation'] }),
        queryClient.invalidateQueries({ queryKey: ['sofia'] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'El servidor rechazó el cambio de control.'),
  });

  const error = enterprise.error ?? runtime.error ?? qr.error;
  const status = enterprise.isPending || runtime.isPending || qr.isPending
    ? 'loading'
    : errorIsPermissionDenied(error)
      ? 'permission_denied'
      : enterprise.isError || runtime.isError || qr.isError
        ? 'error'
        : 'ready';

  const refreshAll = () => void Promise.all([enterprise.refetch(), runtime.refetch(), qr.refetch()]);
  const enterpriseStatus = enterprise.data;
  const runtimeStatus = runtime.data;
  const qrStatus = qr.data;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8" data-testid="activation-control-page">
      <PageHeader
        eyebrow="Gobernanza operacional"
        title="Control de activación"
        description="Estado efectivo de proveedores y gates. Esta pantalla no habilita Bold real, outbound ni auto-reply."
        status={enterpriseStatus ? <StatusBadge status={enterpriseStatus.productionReadiness.status} label={humanize(enterpriseStatus.overallStatus)} /> : <StatusBadge status="UNKNOWN_RESULT" label="Sin verificar" />}
        actions={<Button type="button" variant="secondary" onClick={refreshAll} disabled={status === 'loading'}><RefreshCw className="h-4 w-4" aria-hidden="true" />Actualizar</Button>}
      />

      <QueryState status={status} onRetry={refreshAll}>
        {enterpriseStatus && runtimeStatus && qrStatus ? (
          <div className="space-y-6">
            <section aria-labelledby="activation-gates-title">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div><h2 id="activation-gates-title" className="font-heading text-lg font-semibold text-ink">Gates efectivos</h2><p className="mt-1 text-sm text-muted">Valores leídos del backend; no son estimaciones del navegador.</p></div>
                <p className="text-xs tabular-nums text-muted">Actualizado {formatDateTime(enterpriseStatus.generatedAt)}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <WhatsappReadiness enterprise={enterpriseStatus} qrStatus={qrStatus} />
                <ReadinessSurface title="Inbound WhatsApp" description={qrStatus.mode === 'receive_only' ? 'El modo declarado es receive-only.' : `Modo declarado: ${humanize(qrStatus.mode)}.`} state={qrStatus.connected && qrStatus.mode === 'receive_only' ? 'ready' : qrStatus.status === 'FAILED' ? 'degraded' : 'blocked'} details={<p>{qrStatus.operatorMessage}</p>} />
                <ReadinessSurface title="Outbound WhatsApp" description="El envío automático de clientes permanece fuera de esta fase." state={runtimeStatus.state.effective.realSendingEnabled ? 'degraded' : 'blocked'} details={<FactLine label="Efectivo" value={runtimeStatus.state.effective.realSendingEnabled ? 'Habilitado inesperadamente' : 'Deshabilitado'} />} />
                <ReadinessSurface title="Auto reply" description="Ninguna respuesta automática está autorizada." state={runtimeStatus.state.effective.autoReplyEnabled ? 'degraded' : 'blocked'} details={<FactLine label="Efectivo" value={runtimeStatus.state.effective.autoReplyEnabled ? 'Habilitado inesperadamente' : 'Deshabilitado'} />} />
                <ReadinessSurface title="Bold real" description="La preferencia de pago y la infraestructura no equivalen a activación financiera." state={enterpriseStatus.payments.paymentLinksEnabled ? 'degraded' : 'blocked'} details={<FactLine label="Links productivos" value={enterpriseStatus.payments.paymentLinksEnabled ? 'Habilitados' : 'Deshabilitados'} />} />
                <ReadinessSurface title="Proveedor de IA" description={`Proveedor reportado: ${humanize(enterpriseStatus.ai.provider)} · modo ${humanize(enterpriseStatus.ai.mode)}.`} state={enterpriseStatus.ai.healthStatus === 'PASS' ? 'ready' : enterpriseStatus.ai.healthStatus === 'WARNING' ? 'degraded' : 'blocked'} details={<FactLine label="Fallback seguro" value={humanize(enterpriseStatus.ai.fallbackProvider)} />} />
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Actividad y protección">
              <MetricSurface label="Inbound hoy" value={qrStatus.inboundToday} context="Eventos reales del QR gateway" icon={<Radio className="h-4 w-4" />} density="compact" />
              <MetricSurface label="Outbound hoy" value={qrStatus.outboundToday} context="Debe permanecer en cero en receive-only" icon={<MessageSquareText className="h-4 w-4" />} density="compact" />
              <MetricSurface label="Pendientes outbound" value={qrStatus.pendingOutbound} context="No autoriza despacho" icon={<Cable className="h-4 w-4" />} density="compact" />
              <MetricSurface label="Handoffs humanos" value={enterpriseStatus.conversations.humanTaken + enterpriseStatus.conversations.humanRequired} context="Requieren control humano" icon={<ShieldCheck className="h-4 w-4" />} density="compact" />
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
              <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div><h2 className="font-heading text-lg font-semibold text-ink">Controles defensivos</h2><p className="mt-1 text-sm leading-6 text-muted">La pausa y el kill switch reducen capacidad; no activan proveedores ni producción.</p></div>
                  <StatusBadge status={runtimeStatus.state.automationBlocked ? 'BLOCKED' : 'ACTIVE'} label={runtimeStatus.state.automationBlocked ? 'Automatización bloqueada' : 'Gobernada'} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SafetyControl
                    icon={<CirclePause className="h-5 w-5" />}
                    title="Pausa global"
                    active={runtimeStatus.state.globalPaused}
                    description="Detiene automatización SOFIA sin alterar módulos operativos."
                    actionLabel={runtimeStatus.state.globalPaused ? 'Retirar pausa' : 'Pausar SOFIA'}
                    disabled={!canOperateSafety}
                    onAction={() => setPendingAction(runtimeStatus.state.globalPaused ? 'resume' : 'pause')}
                  />
                  <SafetyControl
                    icon={<ShieldAlert className="h-5 w-5" />}
                    title="Kill switch"
                    active={runtimeStatus.state.killSwitchActive}
                    description="Bloqueo de mayor precedencia para respuesta ante incidentes."
                    actionLabel={runtimeStatus.state.killSwitchActive ? 'Desactivar kill switch' : 'Activar kill switch'}
                    disabled={!canOperateSafety || (runtimeStatus.state.killSwitchActive && !isAdmin)}
                    onAction={() => setPendingAction(runtimeStatus.state.killSwitchActive ? 'unkill' : 'kill')}
                  />
                </div>
                {!canOperateSafety ? <p className="mt-4 rounded-xl bg-canvas p-3 text-sm text-muted">Tu rol permite consultar, pero no modificar controles defensivos.</p> : null}
              </div>

              <div className="space-y-4">
                <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
                  <h2 className="font-heading text-lg font-semibold text-ink">Activaciones fuera de alcance</h2>
                  <ul className="mt-4 space-y-3">
                    <DisabledActivation icon={<CreditCard className="h-4 w-4" />} title="Bold real" />
                    <DisabledActivation icon={<MessageSquareText className="h-4 w-4" />} title="WhatsApp outbound" />
                    <DisabledActivation icon={<Bot className="h-4 w-4" />} title="Auto reply" />
                  </ul>
                  <Button asChild variant="secondary" className="mt-4 w-full"><Link href="/sofia/whatsapp-qr"><Wifi className="h-4 w-4" aria-hidden="true" />Ver binding receive-only</Link></Button>
                </section>
                <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
                  <h2 className="font-heading text-lg font-semibold text-ink">Últimos eventos</h2>
                  {enterpriseStatus.lastEvents.length ? (
                    <Timeline className="mt-4" density="compact" items={enterpriseStatus.lastEvents.slice(0, 6).map((event, index) => ({ id: `${event.type}-${event.createdAt}-${index}`, title: humanize(event.type), timestamp: formatDateTime(event.createdAt), description: event.detail, tone: event.status === 'PASS' ? 'success' : event.status === 'BLOCKED' ? 'danger' : 'warning' }))} />
                  ) : <p className="mt-3 text-sm text-muted">El backend no reporta eventos recientes.</p>}
                </section>
              </div>
            </section>
          </div>
        ) : null}
      </QueryState>

      <DetailDialog
        open={Boolean(pendingAction)}
        onClose={() => { setPendingAction(null); setReason(''); }}
        title={pendingAction ? actionCopy[pendingAction].title : 'Confirmar control'}
        description={pendingAction ? actionCopy[pendingAction].description : undefined}
        mode="dialog"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setPendingAction(null); setReason(''); }}>Cancelar</Button>
            <Button type="button" onClick={() => { if (pendingAction) control.mutate(pendingAction); }} disabled={control.isPending}>{control.isPending ? 'Aplicando…' : 'Confirmar control'}</Button>
          </div>
        )}
      >
        {pendingAction && actionCopy[pendingAction].needsReason ? <Field label="Motivo operacional" required hint="Se registrará sanitizado en auditoría."><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={180} /></Field> : <p className="rounded-2xl bg-canvas p-4 text-sm leading-6 text-muted">El servidor volverá a evaluar todos los gates. Esta acción no habilita envío, pagos ni producción.</p>}
      </DetailDialog>
    </div>
  );
}

function WhatsappReadiness({ enterprise, qrStatus }: { enterprise: EnterpriseStatus; qrStatus: { connected: boolean; status: string; provider: string; storageWritable: boolean; blockers: string[] } }) {
  return <ReadinessSurface title="WhatsApp provider" description={`${humanize(qrStatus.provider)} · ${humanize(qrStatus.status)}.`} state={qrStatus.connected ? 'ready' : qrStatus.status === 'FAILED' ? 'degraded' : 'blocked'} details={<div className="space-y-1"><FactLine label="Binding" value={enterprise.whatsapp.qrConnected ? 'Conectado' : 'No conectado'} /><FactLine label="Storage" value={qrStatus.storageWritable ? 'Disponible' : 'No disponible'} /></div>} />;
}

function FactLine({ label, value }: { label: string; value: string }) {
  return <p className="flex items-start justify-between gap-3"><span>{label}</span><strong className="text-right font-semibold text-ink">{value}</strong></p>;
}

function SafetyControl({ icon, title, active, description, actionLabel, disabled, onAction }: { icon: React.ReactNode; title: string; active: boolean; description: string; actionLabel: string; disabled: boolean; onAction: () => void }) {
  return (
    <article className="rounded-2xl border border-line bg-canvas p-4">
      <div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel text-brand-800" aria-hidden="true">{icon}</span><StatusBadge status={active ? 'BLOCKED' : 'ACTIVE'} label={active ? 'Activo' : 'Inactivo'} /></div>
      <h3 className="mt-4 font-heading text-base font-semibold text-ink">{title}</h3><p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      <Button type="button" variant="secondary" className="mt-4 w-full" disabled={disabled} onClick={onAction}>{actionLabel}</Button>
    </article>
  );
}

function DisabledActivation({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <li className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-3"><span className="flex items-center gap-2 text-sm font-semibold text-ink"><span aria-hidden="true">{icon}</span>{title}</span><StatusBadge status="BLOCKED" label="Deshabilitado" /></li>;
}
