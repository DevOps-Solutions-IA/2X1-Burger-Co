'use client';

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/sofia/workspace';
import { humanizeCrmCode } from '@/features/sofia/crm-display';
import {
  useSofiaGovernanceStatus,
  useSofiaGovernanceMetrics,
  useSofiaRuntimeSafety,
  useSofiaPauseGlobal,
  useSofiaResumeGlobal,
  useSofiaActivateKillSwitch,
  useSofiaDeactivateKillSwitch,
} from '@/features/sofia/queries';
import type { SofiaRuntimeSafety } from '@/features/sofia/contracts';

const DECLARED_LABELS: Record<keyof SofiaRuntimeSafety['state']['declared'], string> = {
  realSendingEnabled: 'Envío real',
  autoReplyEnabled: 'Auto reply',
  autoSafeEnabled: 'Auto Safe',
  productionEnabled: 'Producción',
};

const EFFECTIVE_LABELS: Record<keyof SofiaRuntimeSafety['state']['effective'], string> = {
  realSendingEnabled: 'Envío real',
  autoReplyEnabled: 'Auto reply',
  autoSafeEnabled: 'Auto Safe',
  productionEnabled: 'Producción',
  whatsappCanMarkPaid: 'WhatsApp puede marcar PAID',
};

const COUNTER_LABELS: Record<keyof SofiaRuntimeSafety['counters'], string> = {
  messages_received_total: 'Mensajes recibidos',
  messages_blocked_total: 'Mensajes bloqueados',
  send_attempts_total: 'Intentos de envío',
  send_blocked_total: 'Envíos bloqueados',
  duplicate_events_total: 'Eventos duplicados',
  payment_sensitive_total: 'Pago sensible',
  human_escalations_total: 'Escalados a humano',
  auto_reply_attempts_total: 'Intentos auto reply',
  auto_safe_attempts_total: 'Intentos Auto Safe',
  timeout_total: 'Timeouts',
  allowlist_denied_total: 'Denegados por allowlist',
};

function FlagRow({ label, active, 'data-testid': testId }: { label: string; active: boolean; 'data-testid'?: string }) {
  return (
    <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2" data-testid={testId}>
      <span className="text-[12px] font-medium text-stone-600">{label}</span>
      <StatusBadge tone={active ? 'warning' : 'blocked'} label={active ? 'Activo' : 'OFF'} withDot={false} />
    </div>
  );
}

function extractErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Sección de gobernanza del Centro de Control: controles explícitos de
 * operador (admin/supervisor) para pausar SOFIA globalmente o activar el
 * kill-switch de emergencia. Nunca acciones de SOFIA — son guardas de
 * seguridad operadas por humanos y protegidas por rol en el backend.
 */
export function OverviewGovernancePanel() {
  const status = useSofiaGovernanceStatus();
  const metrics = useSofiaGovernanceMetrics();
  const runtimeSafety = useSofiaRuntimeSafety();

  const pauseGlobal = useSofiaPauseGlobal();
  const resumeGlobal = useSofiaResumeGlobal();
  const activateKillSwitch = useSofiaActivateKillSwitch();
  const deactivateKillSwitch = useSofiaDeactivateKillSwitch();

  const [actionError, setActionError] = useState<string | null>(null);

  if (status.isLoading || runtimeSafety.isLoading) {
    return (
      <Card data-testid="sofia-overview-governance-panel">
        <p className="text-[12px] font-medium text-stone-600">Cargando control de gobernanza…</p>
      </Card>
    );
  }

  if (status.isError || !status.data || runtimeSafety.isError || !runtimeSafety.data) {
    return (
      <Card data-testid="sofia-overview-governance-panel">
        <p className="text-[12px] font-medium text-red-700">No se pudo cargar el control de gobernanza.</p>
      </Card>
    );
  }

  const governance = status.data;
  const safety = runtimeSafety.data;

  function handlePause() {
    if (!window.confirm('¿Pausar SOFIA globalmente? Esto detiene toda automatización de SOFIA. No afecta POS, Caja, Stock ni Domicilios.')) return;
    setActionError(null);
    pauseGlobal.mutate('Pausa manual desde Centro de Control', {
      onError: (error) => setActionError(extractErrorMessage(error, 'No se pudo pausar SOFIA.')),
    });
  }

  function handleResume() {
    if (!window.confirm('¿Reanudar SOFIA globalmente?')) return;
    setActionError(null);
    resumeGlobal.mutate('Reanudación manual desde Centro de Control', {
      onError: (error) => setActionError(extractErrorMessage(error, 'No se pudo reanudar SOFIA.')),
    });
  }

  function handleActivateKillSwitch() {
    if (!window.confirm('¿Activar el kill-switch de emergencia? Esto bloquea de inmediato toda automatización de SOFIA.')) return;
    setActionError(null);
    activateKillSwitch.mutate('Kill-switch activado desde Centro de Control', {
      onError: (error) => setActionError(extractErrorMessage(error, 'No se pudo activar el kill-switch.')),
    });
  }

  function handleDeactivateKillSwitch() {
    if (!window.confirm('¿Desactivar el kill-switch de emergencia?')) return;
    setActionError(null);
    deactivateKillSwitch.mutate('Kill-switch desactivado desde Centro de Control', {
      onError: (error) => setActionError(extractErrorMessage(error, 'No se pudo desactivar el kill-switch.')),
    });
  }

  return (
    <Card className="space-y-4" data-testid="sofia-overview-governance-panel">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[0.65rem] bg-brand-100 text-brand-700">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Control de gobernanza</p>
          <h3 className="text-[14px] font-semibold text-ink">Pausa global y kill-switch</h3>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="sofia-overview-governance-status-badges">
        <StatusBadge tone={governance.globalPaused ? 'blocked' : 'success'} label={governance.globalPaused ? 'Sofía pausada' : 'Sofía activa'} />
        <StatusBadge tone={governance.killSwitchActive ? 'blocked' : 'success'} label={governance.killSwitchActive ? 'Kill-switch activo' : 'Kill-switch inactivo'} />
        <StatusBadge tone="read_only" label={`Fase: ${governance.phase}`} withDot={false} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div data-testid="sofia-overview-governance-declared">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">Declarado en config</p>
          <div className="mt-1.5 space-y-1.5">
            {(Object.keys(DECLARED_LABELS) as Array<keyof SofiaRuntimeSafety['state']['declared']>).map((key) => (
              <FlagRow key={key} label={DECLARED_LABELS[key]} active={safety.state.declared[key]} />
            ))}
          </div>
        </div>
        <div data-testid="sofia-overview-governance-effective">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">Efectivo en runtime</p>
          <div className="mt-1.5 space-y-1.5">
            {(Object.keys(EFFECTIVE_LABELS) as Array<keyof SofiaRuntimeSafety['state']['effective']>).map((key) => (
              <FlagRow key={key} label={EFFECTIVE_LABELS[key]} active={Boolean(safety.state.effective[key])} />
            ))}
          </div>
        </div>
      </div>

      <p className="rounded-[0.9rem] bg-stone-50 px-3 py-2.5 text-[11.5px] font-medium text-stone-600">
        Lo declarado en configuración no implica que esté activo: todo lo &ldquo;Efectivo en runtime&rdquo; debe leerse OFF mientras producción está bloqueada.
      </p>

      {safety.state.precedence.length > 0 && (
        <div data-testid="sofia-overview-governance-precedence">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">Orden de precedencia</p>
          <ol className="mt-1.5 flex flex-wrap gap-1.5">
            {safety.state.precedence.map((rule, index) => (
              <li key={rule} className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                {index + 1}. {humanizeCrmCode(rule)}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div data-testid="sofia-overview-governance-counters">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-stone-600">Contadores del día</p>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {(Object.keys(COUNTER_LABELS) as Array<keyof SofiaRuntimeSafety['counters']>).map((key) => (
            <div key={key} className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
              <span className="text-[11.5px] font-medium text-stone-600">{COUNTER_LABELS[key]}</span>
              <span className="text-[12px] font-semibold text-ink">{safety.counters[key]}</span>
            </div>
          ))}
          {metrics.data && (
            <>
              <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
                <span className="text-[11.5px] font-medium text-stone-600">Bloqueos SafetyGuard</span>
                <span className="text-[12px] font-semibold text-ink">{metrics.data.safetyBlocks}</span>
              </div>
              <div className="flex items-center justify-between rounded-[0.9rem] bg-stone-50 px-3 py-2">
                <span className="text-[11.5px] font-medium text-stone-600">Requieren humano</span>
                <span className="text-[12px] font-semibold text-ink">{metrics.data.humanRequired}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <p className="rounded-[0.9rem] border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-800" role="alert">
          {actionError}
        </p>
      )}

      <div className="flex flex-wrap gap-2.5 border-t border-stone-100 pt-3.5">
        {governance.globalPaused ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleResume}
            disabled={resumeGlobal.isPending}
            data-testid="sofia-overview-governance-resume-btn"
          >
            {resumeGlobal.isPending ? 'Reanudando…' : 'Reanudar SOFIA'}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePause}
            disabled={pauseGlobal.isPending}
            data-testid="sofia-overview-governance-pause-btn"
          >
            {pauseGlobal.isPending ? 'Pausando…' : 'Pausar SOFIA globalmente'}
          </Button>
        )}

        {governance.killSwitchActive ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleDeactivateKillSwitch}
            disabled={deactivateKillSwitch.isPending}
            data-testid="sofia-overview-governance-kill-deactivate-btn"
          >
            {deactivateKillSwitch.isPending ? 'Desactivando…' : 'Desactivar kill-switch'}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleActivateKillSwitch}
            disabled={activateKillSwitch.isPending}
            className="bg-red-600 text-white shadow-soft hover:bg-red-700 active:bg-red-800"
            data-testid="sofia-overview-governance-kill-activate-btn"
          >
            {activateKillSwitch.isPending ? 'Activando…' : 'Activar kill-switch'}
          </Button>
        )}
      </div>
    </Card>
  );
}
