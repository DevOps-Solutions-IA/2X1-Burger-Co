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
  CONSOLE_CARD_CLASS,
  ControlTowerFrame,
  EmptyStrip,
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
import { Button } from '@/components/ui/button';
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
    <tr className="border-b border-white/10 last:border-0" data-testid={testId}>
      <td className="py-2.5 pr-3 text-[12.5px] font-semibold text-white/85">{label}</td>
      <td className="py-2.5 pr-3">
        <StatusBadge tone={declared ? 'warning' : 'read_only'} label={declared ? 'Declarado: ON' : 'Declarado: OFF'} variant="console" />
      </td>
      <td className="py-2.5">
        <StatusBadge
          tone={effectiveTone}
          label={effective ? 'EFECTIVO: ON — VIOLACIÓN' : 'Efectivo: OFF (seguro)'}
          variant="console"
          data-testid={`${testId}-effective`}
        />
      </td>
    </tr>
  );
}

function RuntimeSafetySection({ data }: { data: SofiaRuntimeSafety }) {
  const { state, counters } = data;
  return (
    <div className={CONSOLE_CARD_CLASS} data-testid="sofia-safety-runtime-card">
      <SectionHeading
        icon={<ShieldCheck className="h-4.5 w-4.5" />}
        title="Runtime safety — declarado vs. efectivo"
        subtitle={`Generado: ${formatDateTime(data.generatedAt)}`}
        variant="console"
        right={
          <>
            <StatusBadge tone={state.globalPaused ? 'blocked' : 'success'} label={state.globalPaused ? 'SOFIA pausada' : 'SOFIA activa'} variant="console" />
            <StatusBadge tone={state.killSwitchActive ? 'blocked' : 'success'} label={state.killSwitchActive ? 'Kill-switch activo' : 'Kill-switch inactivo'} variant="console" />
          </>
        }
      />

      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="Mensajes recibidos"
          value={formatNumber(counters.messages_received_total)}
          icon={<Activity className="h-4 w-4" />}
          variant="console"
        />
        <StatCard
          label="Bloqueados por SafetyGuard"
          value={formatNumber(counters.messages_blocked_total)}
          accent="warning"
          icon={<Ban className="h-4 w-4" />}
          variant="console"
        />
        <StatCard
          label="Escalados a humano"
          value={formatNumber(counters.human_escalations_total)}
          icon={<ShieldAlert className="h-4 w-4" />}
          variant="console"
        />
        <StatCard
          label="Sensibles a pago"
          value={formatNumber(counters.payment_sensitive_total)}
          accent="danger"
          icon={<KeyRound className="h-4 w-4" />}
          variant="console"
        />
      </div>

      <div
        className="mt-4 flex items-start gap-2.5 rounded-[1.1rem] border border-emerald-400/25 bg-emerald-400/[0.08] px-3.5 py-3"
        role="note"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
        <p className="text-[12px] leading-5 text-emerald-200">
          Invariante de seguridad: mientras la producción esté bloqueada, la columna &ldquo;Efectivo&rdquo; debe leer
          siempre <strong>OFF</strong>, sin importar el valor declarado. Cualquier fila que muestre ON en Efectivo es
          una violación crítica y requiere atención inmediata.
        </p>
      </div>

      <div className="mt-3.5 overflow-x-auto rounded-[1.1rem] border border-white/10">
        <table className="w-full text-left" data-testid="sofia-safety-flags-table">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">
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
        <StatusBadge tone={state.automationBlocked ? 'blocked' : 'success'} label={state.automationBlocked ? 'Automatización bloqueada' : 'Automatización permitida'} variant="console" />
        <StatusBadge tone="read_only" label={`Política: ${state.policy}`} variant="console" />
        <StatusBadge tone="blocked" label="Producción bloqueada" variant="console" />
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">Orden de precedencia</p>
        <ol className="mt-2 space-y-1.5" data-testid="sofia-safety-precedence-list">
          {state.precedence.map((item, index) => (
            <li
              key={item}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white/85"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/70">
                {index + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">Contadores del día</p>
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
                variant="console"
                data-testid={`sofia-safety-counter-${key}`}
              />
            );
          })}
        </div>
      </div>
    </div>
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
    <div className={CONSOLE_CARD_CLASS} data-testid="sofia-safety-governance-card">
      <SectionHeading
        icon={<Power className="h-4.5 w-4.5" />}
        title="Panel de gobernanza"
        subtitle="Acciones globales, mutuamente excluyentes según el estado actual y siempre con confirmación explícita."
        tone="ink"
        variant="console"
      />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-3.5" data-testid="sofia-safety-governance-pause-group">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-white">Pausa global</p>
            <StatusBadge tone={status.globalPaused ? 'blocked' : 'success'} label={status.globalPaused ? 'Pausada' : 'Activa'} variant="console" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.1]"
              disabled={status.globalPaused || pauseGlobal.isPending}
              onClick={handlePause}
              data-testid="sofia-safety-action-pause"
            >
              <Pause className="h-4 w-4" />
              {pauseGlobal.isPending ? 'Pausando…' : 'Pausar SOFIA'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.1]"
              disabled={!status.globalPaused || resumeGlobal.isPending}
              onClick={handleResume}
              data-testid="sofia-safety-action-resume"
            >
              <Play className="h-4 w-4" />
              {resumeGlobal.isPending ? 'Reanudando…' : 'Reanudar SOFIA'}
            </Button>
          </div>
        </div>

        <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-3.5" data-testid="sofia-safety-governance-killswitch-group">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-white">Kill-switch de emergencia</p>
            <StatusBadge tone={status.killSwitchActive ? 'blocked' : 'success'} label={status.killSwitchActive ? 'Activo' : 'Inactivo'} variant="console" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.1]"
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
              className="bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.1]"
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
        <p className="mt-3 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3 py-2 text-[12px] font-semibold text-red-200" role="alert">
          No se pudo completar la acción de gobernanza. Intenta de nuevo.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <p className="text-[11.5px] text-white/70">
          Fase actual: <span className="font-semibold text-white">{status.phase}</span>
        </p>
        <p className="text-[11.5px] text-white/70">
          Rotación de secretos: <span className="font-semibold text-white">{status.secretRotationStatus}</span>
        </p>
      </div>
    </div>
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
      variant="console"
      data-testid="sofia-safety-readiness"
    >
      {(data) => (
        <div className={CONSOLE_CARD_CLASS} data-testid="sofia-safety-readiness-card">
          <SectionHeading
            icon={<ListChecks className="h-4.5 w-4.5" />}
            title="Readiness de producción"
            subtitle={`Próxima acción requerida: ${data.nextRequiredAction}`}
            variant="console"
            right={<StatusBadge tone={toneFromCheckStatus(data.status)} label={`Estado: ${data.status}`} variant="console" data-testid="sofia-safety-readiness-status" />}
          />

          {data.checklist.length === 0 ? (
            <EmptyStrip variant="console" title="Sin checklist" description="No hay elementos de readiness registrados." className="mt-3" />
          ) : (
            <ul className="mt-3.5 space-y-2" data-testid="sofia-safety-readiness-checklist">
              {data.checklist.map((item) => (
                <li
                  key={item.key}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-xl border border-l-4 border-white/10 bg-white/[0.04] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between',
                    CHECKLIST_ACCENT[item.status],
                  )}
                  data-testid={`sofia-safety-readiness-item-${item.key}`}
                >
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-white/85">{item.label}</p>
                    <p className="mt-0.5 text-[11.5px] text-white/70">{item.reason}</p>
                    {item.evidence ? <p className="mt-0.5 truncate text-[11px] text-white/70" title={item.evidence}>Evidencia: {item.evidence}</p> : null}
                  </div>
                  <StatusBadge tone={toneFromCheckStatus(item.status)} variant="console" className="shrink-0 self-start sm:self-center" />
                </li>
              ))}
            </ul>
          )}

          {(data.blockers.length > 0 || data.warnings.length > 0) && (
            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.blockers.length > 0 ? (
                <div className="rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-red-200">
                    <AlertTriangle className="h-3.5 w-3.5" /> Bloqueadores
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[12px] text-red-200">
                    {data.blockers.map((blocker) => (
                      <li key={blocker}>• {blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-200">
                    <ShieldAlert className="h-3.5 w-3.5" /> Advertencias
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[12px] text-amber-200">
                    {data.warnings.map((warning) => (
                      <li key={warning}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
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
      variant="console"
      data-testid="sofia-safety-events"
    >
      {(data) => (
        <div className={cn(CONSOLE_CARD_CLASS, 'h-full')} data-testid="sofia-safety-events-card">
          <SectionHeading icon={<History className="h-4.5 w-4.5" />} title="Timeline de eventos de gobernanza" tone="ink" variant="console" />
          {data.length === 0 ? (
            <EmptyStrip variant="console" title="Sin eventos" description="No se han registrado eventos de gobernanza todavía." className="mt-3" />
          ) : (
            <ol className="relative mt-3.5 space-y-0" data-testid="sofia-safety-events-list">
              {data.map((event, index) => (
                <li key={`${event.type}-${event.createdAt}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < data.length - 1 && (
                    <span className="absolute left-[0.9375rem] top-7 h-[calc(100%-1.25rem)] w-px bg-white/15" aria-hidden="true" />
                  )}
                  <span className="relative z-10 flex h-[1.875rem] w-[1.875rem] shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 shadow-sm">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-bold text-white">{event.type}</p>
                      <p className="text-[11px] text-white/70">{formatDateTime(event.createdAt)}</p>
                    </div>
                    <p className="mt-0.5 text-[11.5px] font-semibold text-white/85">{event.status}</p>
                    <p className="mt-0.5 text-[12px] text-white/70">{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
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
      variant="console"
      data-testid="sofia-safety-alerts"
    >
      {(data) => {
        const openCount = data.filter((alert) => alert.status === 'OPEN').length;
        return (
          <div className={cn(CONSOLE_CARD_CLASS, 'h-full')} data-testid="sofia-safety-alerts-card">
            <SectionHeading
              icon={<Bell className="h-4.5 w-4.5" />}
              title="Alertas"
              tone={openCount > 0 ? 'warning' : 'ink'}
              variant="console"
              right={<StatusBadge tone={openCount > 0 ? 'warning' : 'success'} label={`${openCount} abiertas`} variant="console" />}
            />
            {data.length === 0 ? (
              <EmptyStrip variant="console" title="Sin alertas abiertas" description="No hay alertas registradas para SOFIA en este momento." className="mt-3" />
            ) : (
              <ul className="mt-3.5 space-y-2.5" data-testid="sofia-safety-alerts-list">
                {data.map((alert) => (
                  <li
                    key={alert.id}
                    className={cn(
                      'rounded-xl border px-3.5 py-2.5',
                      alert.severity === 'CRITICAL'
                        ? 'border-red-400/25 bg-red-400/[0.08]'
                        : alert.severity === 'WARNING'
                          ? 'border-amber-400/25 bg-amber-400/[0.08]'
                          : 'border-white/10 bg-white/[0.04]',
                    )}
                    data-testid={`sofia-safety-alert-${alert.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12.5px] font-bold text-white">{alert.title}</p>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge tone={toneFromAlertSeverity(alert.severity)} label={alert.severity} variant="console" />
                        <StatusBadge tone={alert.status === 'RESOLVED' ? 'success' : alert.status === 'ACKNOWLEDGED' ? 'pending' : 'warning'} label={alert.status} variant="console" />
                      </div>
                    </div>
                    <p className="mt-1 text-[12px] text-white/85">{alert.message}</p>
                    <p className="mt-1 text-[11px] text-white/70">{formatDateTime(alert.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          variant="console"
          statusBadges={
            governanceStatus.data ? (
              <>
                <StatusBadge tone={governanceStatus.data.globalPaused ? 'blocked' : 'success'} label={governanceStatus.data.globalPaused ? 'SOFIA pausada' : 'SOFIA activa'} variant="console" />
                <StatusBadge tone={governanceStatus.data.killSwitchActive ? 'blocked' : 'success'} label={governanceStatus.data.killSwitchActive ? 'Kill-switch activo' : 'Kill-switch inactivo'} variant="console" />
                <StatusBadge tone="read_only" label="Producción bloqueada" variant="console" />
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
          variant="console"
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
          variant="console"
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
