'use client';

import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  History,
  KeyRound,
  ListChecks,
  Pause,
  Play,
  Power,
  PowerOff,
  ShieldAlert,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import {
  ControlTowerFrame,
  PageHeader,
  QueryStateBoundary,
  SectionHeading,
  StatCard,
  StatusBadge,
  toneFromAlertSeverity,
  toneFromCheckStatus,
  type SofiaStatusTone,
} from '@/components/sofia';
import {
  useSofiaActivateKillSwitch,
  useSofiaAlerts,
  useSofiaDeactivateKillSwitch,
  useSofiaGovernanceEvents,
  useSofiaGovernanceStatus,
  useSofiaPauseGlobal,
  useSofiaReadiness,
  useSofiaResumeGlobal,
  useSofiaRuntimeSafety,
} from '@/features/sofia/queries';
import type { SofiaGovernanceStatus, SofiaRuntimeSafety } from '@/features/sofia/contracts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const COUNTER_META: Record<keyof SofiaRuntimeSafety['counters'], { label: string; hint: string; accent: 'brand' | 'success' | 'warning' | 'danger' | 'ink' }> = {
  messages_received_total: { label: 'Mensajes recibidos', hint: 'Inbound total', accent: 'brand' },
  messages_blocked_total: { label: 'Mensajes bloqueados', hint: 'Detenidos por SafetyGuard', accent: 'warning' },
  send_attempts_total: { label: 'Intentos de envío', hint: 'Siempre en dry-run', accent: 'ink' },
  send_blocked_total: { label: 'Envíos bloqueados', hint: 'Envío real OFF', accent: 'danger' },
  duplicate_events_total: { label: 'Eventos duplicados', hint: 'Deduplicados por idempotencia', accent: 'ink' },
  payment_sensitive_total: { label: 'Sensibles a pago', hint: 'Nunca autoprocesados', accent: 'warning' },
  human_escalations_total: { label: 'Escalados a humano', hint: 'Requieren revisión manual', accent: 'brand' },
  auto_reply_attempts_total: { label: 'Intentos de auto-reply', hint: 'Auto reply está OFF', accent: 'ink' },
  auto_safe_attempts_total: { label: 'Intentos de Auto Safe', hint: 'Auto Safe productivo OFF', accent: 'ink' },
  timeout_total: { label: 'Timeouts', hint: 'Latencia/proveedor', accent: 'ink' },
  allowlist_denied_total: { label: 'Denegados por allowlist', hint: 'Allowlist comercial pendiente', accent: 'danger' },
};

const DECLARED_FLAG_ROWS: { key: keyof SofiaRuntimeSafety['state']['declared']; label: string }[] = [
  { key: 'realSendingEnabled', label: 'Envío real de WhatsApp' },
  { key: 'autoReplyEnabled', label: 'Respuesta automática (auto-reply)' },
  { key: 'autoSafeEnabled', label: 'Auto Safe productivo' },
  { key: 'productionEnabled', label: 'Producción' },
];

/* ------------------------------------------------------------------ */
/*  (a) Runtime safety: declarado vs. efectivo + contadores            */
/* ------------------------------------------------------------------ */

function SafetyFlagRow({ label, declared, effective, testId }: { label: string; declared: boolean; effective: boolean; testId: string }) {
  // Invariante de seguridad: mientras producción esté bloqueada, TODO lo
  // "Efectivo" debe leer false, sin importar lo declarado. Si algún día
  // effective llega en true, es una violación crítica y se marca en rojo.
  const effectiveTone: SofiaStatusTone = effective ? 'failed' : 'success';
  return (
    <tr className="border-b border-stone-100 last:border-0" data-testid={testId}>
      <td className="py-2.5 pr-3 text-[12.5px] font-semibold text-stone-700">{label}</td>
      <td className="py-2.5 pr-3">
        <StatusBadge tone={declared ? 'warning' : 'read_only'} label={declared ? 'Declarado: ON' : 'Declarado: OFF'} />
      </td>
      <td className="py-2.5">
        <StatusBadge
          tone={effectiveTone}
          label={effective ? 'EFECTIVO: ON — VIOLACIÓN' : 'Efectivo: OFF (seguro)'}
          data-testid={`${testId}-effective`}
        />
      </td>
    </tr>
  );
}

function RuntimeSafetySection({ data }: { data: SofiaRuntimeSafety }) {
  const { state, counters } = data;
  return (
    <Card data-testid="sofia-safety-runtime-card">
      <SectionHeading
        icon={<ShieldCheck className="h-4.5 w-4.5" />}
        title="Runtime safety — declarado vs. efectivo"
        subtitle={`Generado: ${formatDateTime(data.generatedAt)}`}
        right={
          <>
            <StatusBadge tone={state.globalPaused ? 'blocked' : 'success'} label={state.globalPaused ? 'SOFIA pausada' : 'SOFIA activa'} />
            <StatusBadge tone={state.killSwitchActive ? 'blocked' : 'success'} label={state.killSwitchActive ? 'Kill-switch activo' : 'Kill-switch inactivo'} />
          </>
        }
      />

      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="Mensajes recibidos"
          value={formatNumber(counters.messages_received_total)}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Bloqueados por SafetyGuard"
          value={formatNumber(counters.messages_blocked_total)}
          accent="warning"
          icon={<Ban className="h-4 w-4" />}
        />
        <StatCard
          label="Escalados a humano"
          value={formatNumber(counters.human_escalations_total)}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <StatCard
          label="Sensibles a pago"
          value={formatNumber(counters.payment_sensitive_total)}
          accent="danger"
          icon={<KeyRound className="h-4 w-4" />}
        />
      </div>

      <div
        className="mt-4 flex items-start gap-2.5 rounded-[1.1rem] border border-emerald-200 bg-emerald-50 px-3.5 py-3"
        role="note"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
        <p className="text-[12px] leading-5 text-emerald-900">
          Invariante de seguridad: mientras la producción esté bloqueada, la columna &ldquo;Efectivo&rdquo; debe leer
          siempre <strong>OFF</strong>, sin importar el valor declarado. Cualquier fila que muestre ON en Efectivo es
          una violación crítica y requiere atención inmediata.
        </p>
      </div>

      <div className="mt-3.5 overflow-x-auto rounded-[1.1rem] border border-stone-100">
        <table className="w-full text-left" data-testid="sofia-safety-flags-table">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/80 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-500">
              <th className="px-3.5 py-2.5 font-semibold">Control</th>
              <th className="px-3.5 py-2.5 font-semibold">Declarado</th>
              <th className="px-3.5 py-2.5 font-semibold">Efectivo</th>
            </tr>
          </thead>
          <tbody>
            {DECLARED_FLAG_ROWS.map((row) => (
              <SafetyFlagRow
                key={row.key}
                label={row.label}
                declared={state.declared[row.key]}
                effective={state.effective[row.key]}
                testId={`sofia-safety-flag-${row.key}`}
              />
            ))}
            <SafetyFlagRow
              label="SOFIA puede marcar pagos"
              declared={false}
              effective={state.effective.whatsappCanMarkPaid}
              testId="sofia-safety-flag-whatsappCanMarkPaid"
            />
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatusBadge tone={state.automationBlocked ? 'blocked' : 'success'} label={state.automationBlocked ? 'Automatización bloqueada' : 'Automatización permitida'} />
        <StatusBadge tone="read_only" label={`Política: ${state.policy}`} />
        <StatusBadge tone="blocked" label="Producción bloqueada" />
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Orden de precedencia</p>
        <ol className="mt-2 space-y-1.5" data-testid="sofia-safety-precedence-list">
          {state.precedence.map((item, index) => (
            <li
              key={item}
              className="flex items-center gap-2 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-1.5 text-[12px] font-semibold text-stone-700"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[10px] font-bold text-stone-600">
                {index + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">Contadores del día</p>
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" data-testid="sofia-safety-counters-grid">
          {(Object.keys(COUNTER_META) as (keyof SofiaRuntimeSafety['counters'])[]).map((key) => {
            const meta = COUNTER_META[key];
            return (
              <StatCard
                key={key}
                label={meta.label}
                value={formatNumber(counters[key])}
                hint={meta.hint}
                accent={meta.accent}
                data-testid={`sofia-safety-counter-${key}`}
              />
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  (b) Gobernanza: pausar/reanudar, kill-switch                       */
/* ------------------------------------------------------------------ */

function GovernancePanel({ status }: { status: SofiaGovernanceStatus }) {
  const pauseGlobal = useSofiaPauseGlobal();
  const resumeGlobal = useSofiaResumeGlobal();
  const activateKill = useSofiaActivateKillSwitch();
  const deactivateKill = useSofiaDeactivateKillSwitch();

  function handlePause() {
    if (
      window.confirm(
        '¿Pausar SOFIA globalmente? Esto detiene toda automatización de SOFIA (sugerencias, auto-reply, auto-safe). No afecta POS, Caja, Stock ni Domicilios.',
      )
    ) {
      pauseGlobal.mutate(undefined);
    }
  }

  function handleResume() {
    if (window.confirm('¿Reanudar la operación supervisada de SOFIA? La producción real permanece bloqueada por diseño.')) {
      resumeGlobal.mutate(undefined);
    }
  }

  function handleActivateKillSwitch() {
    if (
      window.confirm(
        '¿Activar el kill-switch de emergencia? Esto bloquea de inmediato toda automatización de SOFIA hasta que se desactive manualmente.',
      )
    ) {
      activateKill.mutate(undefined);
    }
  }

  function handleDeactivateKillSwitch() {
    if (window.confirm('¿Desactivar el kill-switch de emergencia y devolver el control al estado de pausa/gobernanza normal?')) {
      deactivateKill.mutate(undefined);
    }
  }

  const anyError = pauseGlobal.error ?? resumeGlobal.error ?? activateKill.error ?? deactivateKill.error;

  return (
    <Card data-testid="sofia-safety-governance-card">
      <SectionHeading
        icon={<Power className="h-4.5 w-4.5" />}
        title="Panel de gobernanza"
        subtitle="Acciones globales, mutuamente excluyentes según el estado actual y siempre con confirmación explícita."
        tone="ink"
      />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-[1.1rem] border border-stone-200 bg-stone-50/70 p-3.5" data-testid="sofia-safety-governance-pause-group">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-ink">Pausa global</p>
            <StatusBadge tone={status.globalPaused ? 'blocked' : 'success'} label={status.globalPaused ? 'Pausada' : 'Activa'} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={status.globalPaused || pauseGlobal.isPending} onClick={handlePause} data-testid="sofia-safety-action-pause">
              <Pause className="h-4 w-4" />
              {pauseGlobal.isPending ? 'Pausando…' : 'Pausar SOFIA'}
            </Button>
            <Button size="sm" variant="secondary" disabled={!status.globalPaused || resumeGlobal.isPending} onClick={handleResume} data-testid="sofia-safety-action-resume">
              <Play className="h-4 w-4" />
              {resumeGlobal.isPending ? 'Reanudando…' : 'Reanudar SOFIA'}
            </Button>
          </div>
        </div>

        <div className="rounded-[1.1rem] border border-stone-200 bg-stone-50/70 p-3.5" data-testid="sofia-safety-governance-killswitch-group">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-ink">Kill-switch de emergencia</p>
            <StatusBadge tone={status.killSwitchActive ? 'blocked' : 'success'} label={status.killSwitchActive ? 'Activo' : 'Inactivo'} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={status.killSwitchActive || activateKill.isPending}
              onClick={handleActivateKillSwitch}
              data-testid="sofia-safety-action-killswitch-activate"
            >
              <Siren className="h-4 w-4" />
              {activateKill.isPending ? 'Activando…' : 'Activar kill-switch'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!status.killSwitchActive || deactivateKill.isPending}
              onClick={handleDeactivateKillSwitch}
              data-testid="sofia-safety-action-killswitch-deactivate"
            >
              <PowerOff className="h-4 w-4" />
              {deactivateKill.isPending ? 'Desactivando…' : 'Desactivar kill-switch'}
            </Button>
          </div>
        </div>
      </div>

      {anyError ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-800" role="alert">
          No se pudo completar la acción de gobernanza. Intenta de nuevo.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <p className="text-[11.5px] text-stone-600">
          Fase actual: <span className="font-semibold text-ink">{status.phase}</span>
        </p>
        <p className="text-[11.5px] text-stone-600">
          Rotación de secretos: <span className="font-semibold text-ink">{status.secretRotationStatus}</span>
        </p>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  (c) Readiness de producción                                        */
/* ------------------------------------------------------------------ */

const CHECKLIST_ACCENT: Record<'PASS' | 'WARNING' | 'BLOCKED', string> = {
  PASS: 'border-l-emerald-400',
  WARNING: 'border-l-amber-400',
  BLOCKED: 'border-l-red-400',
};

function ReadinessSection() {
  const readiness = useSofiaReadiness();
  return (
    <QueryStateBoundary
      isLoading={readiness.isLoading}
      isError={readiness.isError}
      error={readiness.error}
      data={readiness.data}
      loadingLabel="Cargando readiness de producción…"
      errorTitle="No se pudo cargar el readiness de producción"
      data-testid="sofia-safety-readiness"
    >
      {(data) => (
        <Card data-testid="sofia-safety-readiness-card">
          <SectionHeading
            icon={<ListChecks className="h-4.5 w-4.5" />}
            title="Readiness de producción"
            subtitle={`Próxima acción requerida: ${data.nextRequiredAction}`}
            right={<StatusBadge tone={toneFromCheckStatus(data.status)} label={`Estado: ${data.status}`} data-testid="sofia-safety-readiness-status" />}
          />

          {data.checklist.length === 0 ? (
            <EmptyState className="mt-3" title="Sin checklist" description="No hay elementos de readiness registrados." />
          ) : (
            <ul className="mt-3.5 space-y-2" data-testid="sofia-safety-readiness-checklist">
              {data.checklist.map((item) => (
                <li
                  key={item.key}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-xl border border-l-4 border-stone-100 bg-stone-50/70 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between',
                    CHECKLIST_ACCENT[item.status],
                  )}
                  data-testid={`sofia-safety-readiness-item-${item.key}`}
                >
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-stone-800">{item.label}</p>
                    <p className="mt-0.5 text-[11.5px] text-stone-600">{item.reason}</p>
                    {item.evidence ? <p className="mt-0.5 truncate text-[11px] text-stone-600" title={item.evidence}>Evidencia: {item.evidence}</p> : null}
                  </div>
                  <StatusBadge tone={toneFromCheckStatus(item.status)} className="shrink-0 self-start sm:self-center" />
                </li>
              ))}
            </ul>
          )}

          {(data.blockers.length > 0 || data.warnings.length > 0) && (
            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.blockers.length > 0 ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-red-800">
                    <AlertTriangle className="h-3.5 w-3.5" /> Bloqueadores
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[12px] text-red-800">
                    {data.blockers.map((blocker) => (
                      <li key={blocker}>• {blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-900">
                    <ShieldAlert className="h-3.5 w-3.5" /> Advertencias
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[12px] text-amber-900">
                    {data.warnings.map((warning) => (
                      <li key={warning}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      )}
    </QueryStateBoundary>
  );
}

/* ------------------------------------------------------------------ */
/*  (d) Timeline de eventos + alertas                                  */
/* ------------------------------------------------------------------ */

function GovernanceEventsSection() {
  const events = useSofiaGovernanceEvents();
  return (
    <QueryStateBoundary
      isLoading={events.isLoading}
      isError={events.isError}
      error={events.error}
      data={events.data}
      loadingLabel="Cargando eventos de gobernanza…"
      errorTitle="No se pudo cargar el historial de gobernanza"
      data-testid="sofia-safety-events"
    >
      {(data) => (
        <Card data-testid="sofia-safety-events-card" className="h-full">
          <SectionHeading icon={<History className="h-4.5 w-4.5" />} title="Timeline de eventos de gobernanza" tone="ink" />
          {data.length === 0 ? (
            <EmptyState className="mt-3" title="Sin eventos" description="No se han registrado eventos de gobernanza todavía." />
          ) : (
            <ol className="relative mt-3.5 space-y-0" data-testid="sofia-safety-events-list">
              {data.map((event, index) => (
                <li key={`${event.type}-${event.createdAt}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < data.length - 1 && (
                    <span className="absolute left-[0.9375rem] top-7 h-[calc(100%-1.25rem)] w-px bg-stone-200" aria-hidden="true" />
                  )}
                  <span className="relative z-10 flex h-[1.875rem] w-[1.875rem] shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl border border-stone-100 bg-stone-50/70 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-bold text-ink">{event.type}</p>
                      <p className="text-[11px] text-stone-600">{formatDateTime(event.createdAt)}</p>
                    </div>
                    <p className="mt-0.5 text-[11.5px] font-semibold text-stone-700">{event.status}</p>
                    <p className="mt-0.5 text-[12px] text-stone-600">{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </QueryStateBoundary>
  );
}

function AlertsSection() {
  const alerts = useSofiaAlerts();
  return (
    <QueryStateBoundary
      isLoading={alerts.isLoading}
      isError={alerts.isError}
      error={alerts.error}
      data={alerts.data}
      loadingLabel="Cargando alertas…"
      errorTitle="No se pudo cargar las alertas"
      data-testid="sofia-safety-alerts"
    >
      {(data) => {
        const openCount = data.filter((alert) => alert.status === 'OPEN').length;
        return (
          <Card data-testid="sofia-safety-alerts-card" className="h-full">
            <SectionHeading
              icon={<Bell className="h-4.5 w-4.5" />}
              title="Alertas"
              tone={openCount > 0 ? 'warning' : 'ink'}
              right={<StatusBadge tone={openCount > 0 ? 'warning' : 'success'} label={`${openCount} abiertas`} />}
            />
            {data.length === 0 ? (
              <EmptyState className="mt-3" title="Sin alertas abiertas" description="No hay alertas registradas para SOFIA en este momento." />
            ) : (
              <ul className="mt-3.5 space-y-2.5" data-testid="sofia-safety-alerts-list">
                {data.map((alert) => (
                  <li
                    key={alert.id}
                    className={cn(
                      'rounded-xl border px-3.5 py-2.5',
                      alert.severity === 'CRITICAL'
                        ? 'border-red-200 bg-red-50'
                        : alert.severity === 'WARNING'
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-stone-200 bg-stone-50/70',
                    )}
                    data-testid={`sofia-safety-alert-${alert.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12.5px] font-bold text-ink">{alert.title}</p>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge tone={toneFromAlertSeverity(alert.severity)} label={alert.severity} />
                        <StatusBadge tone={alert.status === 'RESOLVED' ? 'success' : alert.status === 'ACKNOWLEDGED' ? 'pending' : 'warning'} label={alert.status} />
                      </div>
                    </div>
                    <p className="mt-1 text-[12px] text-stone-700">{alert.message}</p>
                    <p className="mt-1 text-[11px] text-stone-600">{formatDateTime(alert.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      }}
    </QueryStateBoundary>
  );
}

/* ------------------------------------------------------------------ */
/*  Página                                                             */
/* ------------------------------------------------------------------ */

export default function SofiaSafetyPage() {
  const runtimeSafety = useSofiaRuntimeSafety();
  const governanceStatus = useSofiaGovernanceStatus();

  return (
    <ControlTowerFrame>
      <div className="space-y-4" data-testid="sofia-safety-page">
        <PageHeader
          eyebrow="Torre de Control"
          title="Seguridad"
          description="Runtime safety declarado vs. efectivo, gobernanza (pausar/kill-switch), readiness de producción y auditoría de eventos/alertas. Producción, envío real y auto reply permanecen bloqueados por diseño."
          statusBadges={
            governanceStatus.data ? (
              <>
                <StatusBadge tone={governanceStatus.data.globalPaused ? 'blocked' : 'success'} label={governanceStatus.data.globalPaused ? 'SOFIA pausada' : 'SOFIA activa'} />
                <StatusBadge tone={governanceStatus.data.killSwitchActive ? 'blocked' : 'success'} label={governanceStatus.data.killSwitchActive ? 'Kill-switch activo' : 'Kill-switch inactivo'} />
                <StatusBadge tone="read_only" label="Producción bloqueada" />
              </>
            ) : undefined
          }
          data-testid="sofia-safety-header"
        />

        <QueryStateBoundary
          isLoading={runtimeSafety.isLoading}
          isError={runtimeSafety.isError}
          error={runtimeSafety.error}
          data={runtimeSafety.data}
          loadingLabel="Cargando runtime safety…"
          errorTitle="No se pudo cargar runtime safety"
          data-testid="sofia-safety-runtime"
        >
          {(data) => <RuntimeSafetySection data={data} />}
        </QueryStateBoundary>

        <QueryStateBoundary
          isLoading={governanceStatus.isLoading}
          isError={governanceStatus.isError}
          error={governanceStatus.error}
          data={governanceStatus.data}
          loadingLabel="Cargando estado de gobernanza…"
          errorTitle="No se pudo cargar el estado de gobernanza"
          data-testid="sofia-safety-governance"
        >
          {(data) => <GovernancePanel status={data} />}
        </QueryStateBoundary>

        <ReadinessSection />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GovernanceEventsSection />
          <AlertsSection />
        </div>
      </div>
    </ControlTowerFrame>
  );
}
