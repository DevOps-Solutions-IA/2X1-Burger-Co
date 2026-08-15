'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  CirclePause,
  MessagesSquare,
  Pause,
  Play,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  MetricSurface,
  ModuleTabs,
  PageHeader,
  QueryState,
  ReadinessSurface,
  StatusBadge,
  Timeline,
  type TimelineItem,
} from '@/components/product';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiFetchSchema } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  canAccessRoute,
  canPerformAction,
  canReadSofiaAlerts,
  canReadSofiaGovernance,
} from '@/features/auth/access-control';
import { useAuth } from '@/features/auth/auth-provider';
import {
  sofiaAlertAckResponseSchema,
  sofiaAlertsSchema,
  sofiaGovernanceEventsSchema,
  sofiaGovernancePauseResponseSchema,
  sofiaReadinessSchema,
} from '@/features/sofia/contracts';
import {
  sofiaQueryKeys,
  useSofiaDashboardSummary,
} from '@/features/sofia/queries';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';

function readable(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  return value ? formatDateTime(value) : 'Sin lectura disponible';
}

export default function SofiaMainDashboardPage() {
  const [showFullChecklist, setShowFullChecklist] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canReadGovernance = canReadSofiaGovernance(user?.permissions);
  const canReadAlerts = canReadSofiaAlerts(user?.permissions, user?.roles);
  const canOpenActivationControl = canAccessRoute('/activation-control', user?.permissions, user?.roles);
  const summary = useSofiaDashboardSummary();
  const readiness = useQuery({
    queryKey: sofiaQueryKeys.readiness,
    queryFn: () => apiFetchSchema('/admin/sofia/readiness', sofiaReadinessSchema),
    enabled: canReadGovernance,
    refetchInterval: canReadGovernance ? visiblePolling(POLLING_INTERVAL.operational) : false,
  });
  const events = useQuery({
    queryKey: sofiaQueryKeys.governanceEvents,
    queryFn: () => apiFetchSchema('/admin/sofia/governance/events', sofiaGovernanceEventsSchema),
    enabled: canReadGovernance,
    refetchInterval: canReadGovernance ? visiblePolling(POLLING_INTERVAL.operational) : false,
  });
  const alerts = useQuery({
    queryKey: sofiaQueryKeys.alerts,
    queryFn: () => apiFetchSchema('/admin/sofia/alerts', sofiaAlertsSchema),
    enabled: canReadAlerts,
    refetchInterval: canReadAlerts ? visiblePolling(POLLING_INTERVAL.operational) : false,
  });
  const canGovern = canPerformAction(user?.permissions, 'settings.update', user?.roles, ['admin', 'supervisor']);

  const invalidateOperationalQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.dashboardSummary }),
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.governanceEvents }),
    ]);
  };

  const pauseSofia = useMutation({
    mutationFn: () => {
      if (!canGovern) throw new Error('No tienes permiso para pausar Sofia.');
      return apiFetchSchema('/admin/sofia/governance/pause', sofiaGovernancePauseResponseSchema, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Pausa manual desde Centro de Gobierno Sofia' }),
      });
    },
    scope: { id: 'sofia-governance-write' },
    onSuccess: async (result) => {
      toast.success(result.message);
      await invalidateOperationalQueries();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo pausar Sofia'),
  });

  const resumeSofia = useMutation({
    mutationFn: () => {
      if (!canGovern) throw new Error('No tienes permiso para reanudar Sofia.');
      return apiFetchSchema('/admin/sofia/governance/resume', sofiaGovernancePauseResponseSchema, { method: 'POST' });
    },
    scope: { id: 'sofia-governance-write' },
    onSuccess: async (result) => {
      toast.success(result.message);
      await invalidateOperationalQueries();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo reanudar Sofia'),
  });

  const ackAlert = useMutation({
    mutationFn: (id: string) => {
      if (!canGovern) throw new Error('No tienes permiso para reconocer alertas de Sofia.');
      return apiFetchSchema(`/admin/sofia/alerts/${id}/ack`, sofiaAlertAckResponseSchema, { method: 'POST' });
    },
    scope: { id: 'sofia-governance-write' },
    onSuccess: async () => {
      toast.success('Alerta reconocida');
      await queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.alerts });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo reconocer la alerta'),
  });

  const data = summary.data;
  const summaryStatus = summary.isPending ? 'loading' : summary.isError || !data ? 'error' : 'ready';

  const timelineItems: TimelineItem[] =
    events.data?.map((event, index) => ({
      id: `${event.createdAt}-${event.type}-${index}`,
      title: readable(event.type),
      timestamp: formatDate(event.createdAt),
      description: event.detail,
      metadata: <StatusBadge status={event.status} label={readable(event.status)} />,
      tone: event.status.includes('BLOCK') || event.status.includes('FAIL') ? 'danger' : event.status.includes('WARN') ? 'warning' : 'info',
    })) ?? [];

  return (
    <div className="space-y-6" data-testid="sofia-admin-page">
      <div data-testid="sofia-main-real-data-hero">
        <PageHeader
          eyebrow="Inteligencia conversacional supervisada"
          title="Centro de Gobierno Sofia"
          description="Lectura operacional, alertas y control humano. El lenguaje puede ser flexible; la ejecución permanece gobernada por el dominio."
          status={
            data ? (
              <StatusBadge
                status={data.general.sofiaMode}
                label={data.general.globalPaused ? 'Sofia pausada' : `Modo ${readable(data.general.sofiaMode)}`}
                tone={data.general.globalPaused ? 'warning' : 'info'}
              />
            ) : undefined
          }
          actions={
            <>
              <Button asChild variant="secondary">
                <Link href="/conversations"><MessagesSquare className="h-4 w-4" aria-hidden="true" /> Conversaciones</Link>
              </Button>
              {canOpenActivationControl ? <Button asChild variant="secondary">
                <Link href="/activation-control"><Radio className="h-4 w-4" aria-hidden="true" /> Control de activacion</Link>
              </Button> : null}
            </>
          }
        />
      </div>

      <ModuleTabs
        label="Navegacion del modulo Sofia"
        items={[
          { id: 'operations', label: 'Operacion', href: '/sofia', active: true, icon: <Bot className="h-4 w-4" /> },
          { id: 'conversations', label: 'Conversaciones', href: '/conversations', icon: <MessagesSquare className="h-4 w-4" /> },
          { id: 'customers', label: 'Clientes', href: '/customers' },
          { id: 'activation', label: 'Activacion', href: '/activation-control', icon: <ShieldCheck className="h-4 w-4" /> },
        ].filter((item) => canAccessRoute(item.href, user?.permissions, user?.roles))}
      />

      <QueryState
        status={summaryStatus}
        title={summary.isError ? 'No pudimos cargar el estado real de Sofia' : 'Cargando estado operacional'}
        description={summary.isError ? 'POS, domicilios, caja, stock y checkout no se alteran. No mostramos datos estimados como reemplazo.' : undefined}
        onRetry={summary.isError ? () => void summary.refetch() : undefined}
        className="min-h-60"
      >
        {data ? (
          <>
            <section
              className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5"
              data-testid="sofia-main-control-bar"
              aria-labelledby="sofia-control-title"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-brand-800">
                    {data.general.globalPaused ? <CirclePause className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                  </span>
                  <div>
                    <h2 id="sofia-control-title" className="font-heading text-lg font-semibold text-ink">Control operacional</h2>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      Kill switch {data.general.killSwitchActive ? 'activo' : 'inactivo'} · envio real {data.general.realSendingEnabled ? 'habilitado' : 'bloqueado'} · auto reply {data.general.autoReplyEnabled ? 'habilitado' : 'bloqueado'}.
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-muted">Ultima lectura: {formatDate(data.generatedAt)}</p>
                  </div>
                </div>
                {data.general.globalPaused ? (
                  <Button
                    type="button"
                    onClick={() => resumeSofia.mutate()}
                    disabled={!canGovern || resumeSofia.isPending}
                    title={!canGovern ? 'Requiere settings.update' : undefined}
                    data-testid="sofia-main-resume"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {resumeSofia.isPending ? 'Reanudando...' : 'Reanudar analisis'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (window.confirm('Pausar Sofia globalmente? No se generaran sugerencias hasta reanudar.')) pauseSofia.mutate();
                    }}
                    disabled={!canGovern || pauseSofia.isPending}
                    title={!canGovern ? 'Requiere settings.update' : undefined}
                    data-testid="sofia-main-pause"
                  >
                    <Pause className="h-4 w-4" aria-hidden="true" />
                    {pauseSofia.isPending ? 'Pausando...' : 'Pausar Sofia'}
                  </Button>
                )}
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="sofia-main-live-signals">
              <MetricSurface
                label="WhatsApp inbound"
                value={data.whatsappQr.inboundToday.toLocaleString('es-CO')}
                context={`${data.whatsappQr.connected ? 'Conectado' : readable(data.whatsappQr.status)} · ${data.general.receiveOnly ? 'solo recepcion' : readable(data.whatsappQr.mode)}`}
                icon={<Radio className="h-5 w-5" />}
                status={<StatusBadge status={data.whatsappQr.connected ? 'ACTIVE' : data.whatsappQr.status} />}
              />
              <MetricSurface
                label="Conversaciones reales"
                value={data.conversations.realConversations.toLocaleString('es-CO')}
                context={`${data.conversations.pendingReview} pendientes de revision`}
                icon={<MessagesSquare className="h-5 w-5" />}
              />
              <MetricSurface
                label="Decisiones SafetyGuard"
                value={data.safetyGuard.real.totalDecisions.toLocaleString('es-CO')}
                context={`${data.safetyGuard.real.blockedCount} bloqueadas · ${data.safetyGuard.real.humanRequiredCount} humanas`}
                icon={<ShieldCheck className="h-5 w-5" />}
              />
              <MetricSurface
                label="Automatizacion"
                value={data.general.automationBlocked ? 'Bloqueada' : 'Requiere revision'}
                context={`Envio real ${data.general.realSendingEnabled ? 'habilitado' : 'bloqueado'} · auto reply ${data.general.autoReplyEnabled ? 'habilitado' : 'bloqueado'} · Auto Safe ${data.general.autoSafeEnabled ? 'habilitado' : 'bloqueado'}`}
                icon={<CirclePause className="h-5 w-5" />}
                status={<StatusBadge status={data.general.automationBlocked ? 'BLOCKED' : 'WARNING'} label={data.general.automationBlocked ? 'Fail-closed' : 'Revisar'} tone={data.general.automationBlocked ? 'danger' : 'warning'} />}
              />
            </section>

            {canReadAlerts || canReadGovernance ? <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]" data-testid="sofia-main-alerts">
              {canReadAlerts ? <Card className="min-w-0">
                <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
                  <div>
                    <h2 className="font-heading text-lg font-semibold text-ink">Alertas operativas</h2>
                    <p className="mt-1 text-sm text-muted">Solo evidencia real entregada por el backend.</p>
                  </div>
                  <Bell className="h-5 w-5 text-muted" aria-hidden="true" />
                </div>
                <div className="pt-4">
                  <QueryState
                    status={alerts.isPending ? 'loading' : alerts.isError ? 'error' : alerts.data?.some((alert) => alert.status === 'OPEN') ? 'ready' : 'empty'}
                    title={alerts.isError ? 'Alertas no disponibles' : 'Sin alertas abiertas'}
                    description={alerts.isError ? 'El panel conserva el resto de capacidades en modo seguro.' : 'No hay alertas operativas abiertas en esta lectura.'}
                    onRetry={alerts.isError ? () => void alerts.refetch() : undefined}
                    skeletonRows={2}
                  >
                    <div className="space-y-3">
                      {alerts.data?.filter((alert) => alert.status === 'OPEN').map((alert) => (
                        <article key={alert.id} className="rounded-xl border border-line bg-canvas p-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold text-ink">{alert.title}</h3>
                                <StatusBadge status={alert.severity} tone={alert.severity === 'CRITICAL' ? 'danger' : alert.severity === 'WARNING' ? 'warning' : 'info'} />
                              </div>
                              <p className="mt-1 text-sm leading-6 text-muted">{alert.message}</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => ackAlert.mutate(alert.id)}
                              disabled={!canGovern || ackAlert.isPending}
                              title={!canGovern ? 'Requiere settings.update' : undefined}
                              data-testid={`sofia-alert-ack-${alert.id}`}
                            >
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Reconocer
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </QueryState>
                </div>
              </Card> : null}

              {canReadGovernance ? <Card>
                <h2 className="font-heading text-lg font-semibold text-ink">Readiness supervisado</h2>
                <p className="mt-1 text-sm leading-6 text-muted">La activacion de canal sigue separada de este workspace.</p>
                <div className="mt-4">
                  <QueryState
                    status={readiness.isPending ? 'loading' : readiness.isError || !readiness.data ? 'error' : 'ready'}
                    title="Readiness no disponible"
                    onRetry={readiness.isError ? () => void readiness.refetch() : undefined}
                    skeletonRows={3}
                  >
                    {readiness.data ? (
                      <ReadinessSurface
                        title={`${readiness.data.checklist.filter((item) => item.status === 'PASS').length}/${readiness.data.checklist.length} controles en PASS`}
                        description={readiness.data.nextRequiredAction}
                        state={readiness.data.status === 'PASS' ? 'ready' : readiness.data.status === 'WARNING' ? 'degraded' : 'blocked'}
                        details={`${readiness.data.blockers.length} bloqueadores · ${readiness.data.warnings.length} advertencias`}
                      />
                    ) : null}
                  </QueryState>
                </div>
                {readiness.data ? (
                  <div className="mt-4" data-testid="sofia-main-production-path">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowFullChecklist((current) => !current)}
                      data-testid="sofia-main-readiness-toggle"
                    >
                      {showFullChecklist ? 'Ocultar controles' : 'Ver controles completos'}
                    </Button>
                    {showFullChecklist ? (
                      <ul className="mt-3 space-y-2" data-testid="sofia-main-readiness-grid">
                        {readiness.data.checklist.map((item) => (
                          <li key={item.key} className="rounded-xl border border-line bg-canvas p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-ink">{item.label}</p>
                                <p className="mt-1 text-xs leading-5 text-muted">{item.reason}</p>
                              </div>
                              <StatusBadge status={item.status} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </Card> : null}
            </section> : (
              <QueryState
                status="permission_denied"
                title="Gobierno de Sofia restringido"
                description="La lectura operacional permanece disponible. Readiness, alertas y eventos requieren settings.read."
                data-testid="sofia-governance-restricted"
              />
            )}

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]" data-testid="sofia-main-activity-timeline">
              {canReadGovernance ? <Card>
                <div className="border-b border-line pb-4">
                  <h2 className="font-heading text-lg font-semibold text-ink">Actividad de gobierno</h2>
                  <p className="mt-1 text-sm text-muted">Eventos sanitizados; no contiene razonamiento oculto ni payloads de proveedor.</p>
                </div>
                <div className="pt-5">
                  <QueryState
                    status={events.isPending ? 'loading' : events.isError ? 'error' : timelineItems.length ? 'ready' : 'empty'}
                    title={events.isError ? 'Actividad no disponible' : 'Sin actividad reciente'}
                    onRetry={events.isError ? () => void events.refetch() : undefined}
                    skeletonRows={4}
                  >
                    <Timeline items={timelineItems} label="Actividad reciente de Sofia" density="compact" />
                  </QueryState>
                </div>
              </Card> : null}

              <Card data-testid="sofia-main-action-blocked">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-signal-danger" aria-hidden="true" />
                  <h2 className="font-heading text-lg font-semibold text-ink">Acciones bloqueadas</h2>
                </div>
                <ul className="mt-4 space-y-2 text-sm leading-6 text-muted">
                  {['Enviar WhatsApp real', 'Activar auto reply', 'Marcar un pago como PAID', 'Crear pedidos desde una sugerencia', 'Modificar caja, stock o precios'].map((item) => (
                    <li key={item} className="flex gap-2"><span aria-hidden="true">•</span><span>{item}</span></li>
                  ))}
                </ul>
                {canOpenActivationControl ? <Button asChild className="mt-5 w-full" variant="secondary">
                  <Link href="/activation-control">Ver controles de activacion</Link>
                </Button> : null}
              </Card>
            </section>

            <section className="sr-only" data-testid="sofia-main-scope-comparison">
              Conversaciones reales {data.conversations.realConversations}; validacion interna {data.conversations.internalValidationConversations}.
            </section>
            <section className="sr-only" data-testid="sofia-main-action-allowed">Revision, monitoreo y gobierno humano permitidos.</section>
            <section className="sr-only" data-testid="sofia-main-navigation">Navegacion canonica disponible.</section>
            <section className="sr-only" data-testid="sofia-main-readiness-gauge">Readiness gobernado disponible.</section>
            <section className="sr-only" data-testid="sofia-main-technical-details">Sin secretos, PII ni QR raw.</section>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
