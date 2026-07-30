'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Brain,
  CheckCircle2,
  Database,
  Lock,
  MessageCircle,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetchSchema } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { sofiaAlertAckResponseSchema, sofiaGovernancePauseResponseSchema } from '@/features/sofia/contracts';
import {
  sofiaQueryKeys,
  useSofiaAlerts,
  useSofiaDashboardSummary,
  useSofiaGovernanceEvents,
  useSofiaReadiness,
} from '@/features/sofia/queries';
import {
  SofiaCommandCard,
  SofiaPageHero,
  SofiaPageShell,
  SofiaTechnicalDetailsAccordion,
  SofiaLiveStatusDot,
  SofiaReadinessGauge,
  SofiaLiveSignalCard,
  SofiaBlockerChecklist,
  SofiaScopeComparison,
  SofiaActionMatrixCard,
  SofiaReadinessGrid,
  SofiaTimeline,
  humanizeSecurityStatus,
  humanizeCheckStatus,
  humanizeEventStatus,
  humanizeEventType,
  humanizeReasonCode,
  humanizeSofiaMode,
} from '@/components/sofia';
import type { SofiaOperatorTone, ReadinessItem, TimelineEvent } from '@/components/sofia';

const READINESS_GROUP: Record<string, ReadinessItem['group']> = {
  prompt_active: 'core',
  catalog_active: 'core',
  memory_active: 'core',
  safetyguard_active: 'core',
  kill_switch: 'core',
  secret_rotation: 'security',
  qr_gateway_architecture: 'whatsapp',
  qr_receive_only: 'whatsapp',
  qr_gateway_real_send: 'whatsapp',
  qr_gateway_real: 'whatsapp',
  whatsapp_real: 'whatsapp',
  whatsapp_no_paid: 'whatsapp',
  auto_safe_sandbox: 'ai',
  deepseek_real: 'ai',
  maxi_family_protected: 'operations',
  checkout_cash_stock_regression: 'operations',
};

function formatDate(value: string | null) {
  if (!value) return 'No disponible';
  return new Date(value).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function boolText(value: boolean) {
  return value ? 'Sí' : 'No';
}

function blockedLabel(value: boolean) {
  return value ? 'Bloqueada' : 'No bloqueada';
}

export default function SofiaMainDashboardPage() {
  const [showFullChecklist, setShowFullChecklist] = useState(false);
  const queryClient = useQueryClient();

  const summary = useSofiaDashboardSummary();
  const readiness = useSofiaReadiness();
  const events = useSofiaGovernanceEvents();
  const alerts = useSofiaAlerts();

  const invalidateOperationalQueries = () => {
    queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.dashboardSummary });
    queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.governanceEvents });
  };

  const pauseSofia = useMutation({
    mutationFn: () =>
      apiFetchSchema('/admin/sofia/governance/pause', sofiaGovernancePauseResponseSchema, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Pausa manual desde Centro de Mando' }),
      }),
    scope: { id: 'sofia-governance-write' },
    onSuccess: (result) => {
      toast.success(result.message);
      invalidateOperationalQueries();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo pausar Sofía'),
  });

  const resumeSofia = useMutation({
    mutationFn: () =>
      apiFetchSchema('/admin/sofia/governance/resume', sofiaGovernancePauseResponseSchema, { method: 'POST' }),
    scope: { id: 'sofia-governance-write' },
    onSuccess: (result) => {
      toast.success(result.message);
      invalidateOperationalQueries();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo reanudar Sofía'),
  });

  const ackAlert = useMutation({
    mutationFn: (id: string) =>
      apiFetchSchema(`/admin/sofia/alerts/${id}/ack`, sofiaAlertAckResponseSchema, { method: 'POST' }),
    scope: { id: 'sofia-governance-write' },
    onSuccess: () => {
      toast.success('Alerta reconocida');
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.alerts });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo reconocer la alerta'),
  });

  const data = summary.data;

  if (summary.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" data-testid="sofia-admin-page">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-sofia-200 border-t-sofia-600" />
          <p className="mt-4 text-sm font-bold text-stone-500">Cargando datos reales del backend...</p>
        </div>
      </div>
    );
  }

  if (summary.isError || !data) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-10 text-center"
        data-testid="sofia-admin-page"
      >
        <AlertTriangle className="h-10 w-10 text-red-500" />
        <p className="mt-4 text-base font-extrabold text-red-800">No se pudo cargar el resumen real de Sofía</p>
        <p className="mt-2 max-w-md text-sm font-medium text-red-600">POS, Domicilios, Caja, Stock y Checkout no se ven afectados.</p>
      </div>
    );
  }

  const deepSeekLabel = data.ai.dryRunEnabled
    ? data.ai.externalProviderEnabled
      ? 'DeepSeek dry-run'
      : 'DeepSeek dry-run · proveedor externo OFF'
    : data.ai.deepSeekEnabled
      ? 'DeepSeek sin dry-run'
      : 'IA no disponible';
  const qrStatusLabel = data.whatsappQr.connected
    ? 'Conectado'
    : data.whatsappQr.qrAvailable
      ? 'QR listo'
      : data.whatsappQr.status
        ? humanizeEventStatus(data.whatsappQr.status)
        : 'No disponible';

  const passedCount = readiness.data ? readiness.data.checklist.filter((i) => i.status === 'PASS').length : data.security.passedChecks.length;
  const totalChecks = readiness.data
    ? readiness.data.checklist.length
    : data.security.passedChecks.length + data.security.blockedChecks.length + data.security.pendingChecks.length;

  const blockerItems = [
    ...data.security.blockedChecks.map((label) => ({ label, tone: 'blocked' as const })),
    ...data.security.pendingChecks.map((label) => ({ label, tone: 'pending' as const })),
  ];

  const readinessItems: ReadinessItem[] = (readiness.data?.checklist ?? []).map((item) => ({
    key: item.key,
    label: item.label,
    status: item.status,
    reason: item.reason,
    evidence: item.evidence,
    group: READINESS_GROUP[item.key] ?? 'operations',
  }));

  const timelineEvents: TimelineEvent[] = (events.data ?? []).map((event) => {
    const viaEventStatus = humanizeEventStatus(event.status);
    const viaEventType = humanizeEventType(event.status);
    const viaReasonCode = humanizeReasonCode(event.status);
    const status =
      viaEventStatus !== event.status ? viaEventStatus : viaEventType !== event.status ? viaEventType : viaReasonCode;
    const detail =
      event.type === 'AUTO_SAFE_DECISION'
        ? event.detail.split(', ').map((code) => humanizeReasonCode(code.trim())).join(' · ')
        : event.type === 'COMMERCIAL_RULE'
          ? event.detail.split(': ').map((part) => humanizeReasonCode(part.trim())).join(': ')
          : event.detail;
    return {
      type: humanizeEventType(event.type),
      status,
      detail,
      createdAt: event.createdAt,
    };
  });

  const whatsappTone: SofiaOperatorTone = data.whatsappQr.connected ? 'safe' : data.whatsappQr.qrAvailable ? 'pending' : 'off';
  const aiTone: SofiaOperatorTone = data.ai.dryRunEnabled ? 'dryRun' : data.ai.deepSeekEnabled ? 'pending' : 'off';
  const safetyHasEvidence = data.safetyGuard.real.totalDecisions > 0;
  const safetyTone: SofiaOperatorTone = !safetyHasEvidence
    ? 'off'
    : data.safetyGuard.real.blockedCount > 0
      ? 'blocked'
      : 'safe';
  const productionTone: SofiaOperatorTone = data.general.productionBlocked ? 'blocked' : 'pending';

  return (
    <SofiaPageShell data-testid="sofia-admin-page">
      <SofiaPageHero
        eyebrow="Sofía"
        title="Centro de Gobierno Sofía"
        description="IA supervisada para conversación, seguridad y readiness operativo."
        statusChips={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-extrabold text-white">
              <SofiaLiveStatusDot tone={summary.isError ? 'blocked' : 'safe'} size="sm" />
              {summary.isFetching ? 'Actualizando…' : 'Live'} · {formatDate(data.generatedAt)}
            </span>
          </>
        }
        actions={
          <>
            <Link
              href={data.routes.whatsappQrUrl ?? '/sofia/whatsapp-qr'}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <Radio className="h-3.5 w-3.5" />
              QR
            </Link>
            <Link
              href={data.routes.conversationsUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Conversaciones
            </Link>
            <Link
              href={data.routes.sandboxUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Sandbox
            </Link>
          </>
        }
        data-testid="sofia-main-real-data-hero"
      />

      <section
        className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
        data-testid="sofia-main-control-bar"
      >
        <div className="flex items-center gap-3">
          <SofiaLiveStatusDot tone={data.general.automationBlocked ? 'blocked' : 'safe'} />
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-stone-600">Control operativo</p>
            <p className="text-base font-extrabold text-stone-900">
              Sofía {humanizeSofiaMode(data.general.sofiaMode)}
            </p>
            <p className="text-xs font-semibold text-stone-500">
              Kill switch: {data.general.killSwitchActive ? 'ACTIVO' : 'inactivo'} · Envío real: bloqueado
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.general.sofiaMode === 'paused' ? (
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => resumeSofia.mutate()}
              disabled={resumeSofia.isPending}
              data-testid="sofia-main-resume"
            >
              <Play className="mr-2 h-4 w-4" />
              Reanudar análisis supervisado
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="bg-red-50 text-red-700 ring-red-200 hover:bg-red-100"
              onClick={() => {
                if (window.confirm('¿Pausar Sofía globalmente? Deja de generar sugerencias y análisis hasta reanudar.')) {
                  pauseSofia.mutate();
                }
              }}
              disabled={pauseSofia.isPending}
              data-testid="sofia-main-pause"
            >
              <Pause className="mr-2 h-4 w-4" />
              Pausar Sofía
            </Button>
          )}
        </div>
      </section>

      {alerts.isLoading && <SectionSkeleton rows={2} data-testid="sofia-main-alerts-skeleton" />}
      {alerts.isError && (
        <DegradedSection
          label="Alertas operativas no disponibles"
          detail="El resto del panel sigue operativo."
          data-testid="sofia-main-alerts-degraded"
        />
      )}
      {alerts.data && alerts.data.some((alert) => alert.status === 'OPEN') && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4" data-testid="sofia-main-alerts">
          <p className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">
            <Bell className="h-3.5 w-3.5" />
            Alertas operativas
          </p>
          <div className="grid gap-2">
            {alerts.data
              .filter((alert) => alert.status === 'OPEN')
              .map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-amber-100 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-stone-900">{alert.title}</p>
                    <p className="text-xs font-semibold text-stone-500">{alert.message}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => ackAlert.mutate(alert.id)}
                    disabled={ackAlert.isPending}
                    data-testid={`sofia-alert-ack-${alert.id}`}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Reconocer
                  </Button>
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="sofia-main-live-signals">
        <SofiaLiveSignalCard
          icon={Radio}
          title="WhatsApp QR"
          tone={whatsappTone}
          statusLabel={qrStatusLabel}
          chips={['Receive-only', data.whatsappQr.adapterReal ? 'Adapter real' : 'Adapter pendiente']}
          lastReading={`Inbound: ${formatDate(data.whatsappQr.lastInboundAt)}`}
          suggestedAction={data.whatsappQr.connected ? 'Monitorear' : 'Revisar QR Gateway'}
          data-testid="sofia-signal-whatsapp"
        />
        <SofiaLiveSignalCard
          icon={Brain}
          title="IA"
          tone={aiTone}
          statusLabel={deepSeekLabel}
          chips={[`Fallback: ${data.ai.fallbackProvider}`]}
          lastReading={`Lectura: ${formatDate(data.ai.lastAiCheckAt)}`}
          suggestedAction="No responde al cliente"
          data-testid="sofia-signal-ai"
        />
        <SofiaLiveSignalCard
          icon={ShieldCheck}
          title="SafetyGuard"
          tone={safetyTone}
          statusLabel={
            safetyHasEvidence
              ? `${data.safetyGuard.real.blockedCount} bloqueos reales`
              : 'Sin decisiones: estado no comprobado'
          }
          chips={[`${data.safetyGuard.real.totalDecisions} decisiones`, `${data.safetyGuard.real.paymentSensitiveCount} pago sensible`]}
          lastReading={`Última decisión: ${formatDate(data.safetyGuard.real.lastDecisionAt)}`}
          suggestedAction={safetyHasEvidence ? 'Monitorear' : 'Esperar evidencia runtime'}
          data-testid="sofia-signal-safetyguard"
        />
        <SofiaLiveSignalCard
          icon={Lock}
          title="Producción"
          tone={productionTone}
          statusLabel={blockedLabel(data.general.productionBlocked)}
          chips={[`Allowlist: ${humanizeSecurityStatus(data.security.allowlistFinalStatus)}`, `Readiness: ${humanizeCheckStatus(data.security.productionReadinessStatus)}`]}
          suggestedAction="Cerrar allowlist final"
          data-testid="sofia-signal-production"
        />
      </section>

      <SofiaScopeComparison
        data-testid="sofia-main-scope-comparison"
        note="Validación interna no cuenta como operación real."
        rows={[
          { label: 'Conversaciones', real: data.conversations.realConversations, internal: data.conversations.sandboxConversations + data.conversations.internalValidationConversations },
          { label: 'Inbound hoy', real: data.whatsappQr.inboundToday, internal: data.internalValidation.qrGatewayValidationInboundToday },
          { label: 'Decisiones de seguridad', real: data.safetyGuard.real.totalDecisions, internal: data.safetyGuard.sandbox.totalDecisions },
        ]}
      />

      <section className="grid items-start gap-4 sm:grid-cols-2" data-testid="sofia-main-pending-and-actions">
        <SofiaActionMatrixCard tone="allowed" items={['Revisar sugerencias', 'Validar inbound', 'Monitorear SafetyGuard', 'Documentar pendientes']} data-testid="sofia-main-action-allowed" />
        <SofiaActionMatrixCard tone="blocked" items={['Enviar WhatsApp real', 'Auto reply', 'Marcar PAID', 'Mover pedidos desde Sofía']} data-testid="sofia-main-action-blocked" />
      </section>

      {events.isLoading ? (
        <SectionSkeleton rows={4} data-testid="sofia-main-timeline-skeleton" />
      ) : events.isError ? (
        <DegradedSection
          label="Actividad reciente no disponible"
          detail="Los eventos de auditoría no cargaron; reintento automático cada 30 s."
          data-testid="sofia-main-timeline-degraded"
        />
      ) : (
        <SofiaTimeline
          events={timelineEvents}
          emptyMessage="Sin actividad real reciente. Última actividad corresponde a validación interna."
          data-testid="sofia-main-activity-timeline"
        />
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="sofia-main-navigation">
        <SofiaCommandCard href={data.routes.whatsappQrUrl ?? '/sofia/whatsapp-qr'} label="WhatsApp QR" description="Estado Baileys receive-only" icon={Radio} />
        <SofiaCommandCard href={data.routes.conversationsUrl} label="Conversaciones" description="Inbox supervisado" icon={MessageCircle} />
        <SofiaCommandCard href={data.routes.sandboxUrl} label="Sandbox" description="Laboratorio separado" icon={Sparkles} />
        <SofiaCommandCard href={data.routes.posUrl} label="POS" description="Operación real separada" icon={Database} />
      </section>

      <SofiaTechnicalDetailsAccordion
        title="Camino a producción"
        description="Informativo, no es un panel de activación. Producción real sigue bloqueada aquí y a nivel de servidor."
        data-testid="sofia-main-production-path"
      >
        <div className="grid gap-4">
          <SofiaReadinessGauge
            passed={passedCount}
            total={totalChecks}
            subtitle={readiness.data?.nextRequiredAction}
            topBlockers={data.security.blockedChecks}
            data-testid="sofia-main-readiness-gauge"
          />
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-red-600">Bloqueadores hacia producción</p>
            <SofiaBlockerChecklist items={blockerItems} />
          </div>
          {readinessItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowFullChecklist((v) => !v)}
                className="text-xs font-extrabold text-sofia-700 underline underline-offset-2 hover:text-sofia-900"
                data-testid="sofia-main-readiness-toggle"
              >
                {showFullChecklist ? 'Ocultar checklist completo' : `Ver checklist completo (${totalChecks})`}
              </button>
              {showFullChecklist && (
                <SofiaReadinessGrid
                  className="mt-3"
                  items={readinessItems}
                  overallStatus={readiness.data?.status ?? 'BLOCKED'}
                  overallLabel="Checklist de readiness — historia 10"
                  data-testid="sofia-main-readiness-grid"
                />
              )}
            </div>
          )}
        </div>
      </SofiaTechnicalDetailsAccordion>

      <SofiaTechnicalDetailsAccordion
        title="Detalle técnico"
        description="Fuente backend, políticas de datos y checks sin PII."
        data-testid="sofia-main-technical-details"
      >
        <div className="grid gap-3 text-xs font-semibold text-stone-600 md:grid-cols-2">
          <Row label="Endpoint principal" value="/admin/sofia/dashboard/summary" />
          <Row label="Generado" value={formatDate(data.generatedAt)} />
          <Row label="Sin secretos" value={boolText(data.dataPolicy.noSecrets)} />
          <Row label="Sin PII" value={boolText(data.dataPolicy.noPii)} />
          <Row label="Sin QR raw" value={boolText(data.dataPolicy.noQrRaw)} />
          <Row label="Sandbox separado" value={boolText(data.dataPolicy.sandboxSeparated)} />
          <Row label="Pausa global" value={data.general.globalPaused ? 'ACTIVA' : 'inactiva'} />
          <Row label="Kill switch" value={data.general.killSwitchActive ? 'ACTIVO' : 'inactivo'} />
          <Row label="Automatización bloqueada" value={boolText(data.general.automationBlocked)} />
          <Row label="Proveedor IA externo" value={data.ai.externalProviderEnabled ? 'habilitado' : 'OFF'} />
          <Row label="QR status raw" value={data.whatsappQr.status} />
          <Row label="QR available" value={boolText(data.whatsappQr.qrAvailable)} />
          <Row label="Last AI check" value={formatDate(data.ai.lastAiCheckAt)} />
          <Row label="Real operation reason" value={data.dataPolicy.realOperationReason} />
        </div>
      </SofiaTechnicalDetailsAccordion>
    </SofiaPageShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-stone-50 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <span className="text-stone-500">{label}</span>
      <span className="break-words font-extrabold text-stone-900 sm:max-w-[60%] sm:text-right">{value || 'No disponible'}</span>
    </div>
  );
}

function SectionSkeleton({ rows, 'data-testid': testId }: { rows: number; 'data-testid'?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" data-testid={testId} aria-busy="true">
      <div className="grid gap-2.5">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-9 animate-pulse rounded-xl bg-stone-100" />
        ))}
      </div>
    </div>
  );
}

function DegradedSection({
  label,
  detail,
  'data-testid': testId,
}: {
  label: string;
  detail: string;
  'data-testid'?: string;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4"
      data-testid={testId}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
      <div>
        <p className="text-sm font-extrabold text-stone-700">{label}</p>
        <p className="text-xs font-semibold text-stone-500">{detail}</p>
      </div>
    </div>
  );
}
