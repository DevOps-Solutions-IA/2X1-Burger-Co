'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ListFilter, X, XCircle } from 'lucide-react';
import { StatusBadge, QueryStateBoundary, Pager, EmptyStrip, CONSOLE_CARD_CLASS, toneFromCommandStatus } from '@/components/sofia';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useSecureCommands,
  useSecureCommand,
  useSecureCommandApprove,
  useSecureCommandReject,
} from '@/features/sofia/queries';
import { secureCommandStatusSchema, secureCommandTypeSchema, type SecureCommandDetail } from '@/features/sofia/contracts';
import {
  isSecureCommandActionable,
  secureCommandStatusLabel,
  secureCommandTypeIcon,
  secureCommandTypeLabel,
  truncateReferenceId,
  TONE_AVATAR_CLASS_CONSOLE,
} from './labels';

const PAGE_SIZE = 10;

export function CommandsPanel() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [commandType, setCommandType] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useSecureCommands({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    commandType: commandType || undefined,
  });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_25rem]" data-testid="sofia-validation-commands-panel">
      <div className={cn(CONSOLE_CARD_CLASS)} data-testid="sofia-validation-commands-list-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 pb-2.5 text-white/55">
              <ListFilter className="h-4 w-4" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">Filtros</span>
            </div>
            <div className="min-w-[11rem]">
              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70" htmlFor="sofia-validation-commands-filter-status">
                Estado
              </label>
              <Select
                id="sofia-validation-commands-filter-status"
                className="mt-1 border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                  setSelectedId(null);
                }}
                data-testid="sofia-validation-commands-filter-status"
              >
                <option value="">Todos</option>
                {secureCommandStatusSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {secureCommandStatusLabel(option)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[13rem]">
              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70" htmlFor="sofia-validation-commands-filter-type">
                Tipo de comando
              </label>
              <Select
                id="sofia-validation-commands-filter-type"
                className="mt-1 border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
                value={commandType}
                onChange={(event) => {
                  setCommandType(event.target.value);
                  setPage(1);
                  setSelectedId(null);
                }}
                data-testid="sofia-validation-commands-filter-type"
              >
                <option value="">Todos</option>
                {secureCommandTypeSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {secureCommandTypeLabel(option)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <QueryStateBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            data={query.data}
            loadingLabel="Cargando comandos gobernados…"
            errorTitle="No se pudieron cargar los comandos"
            variant="console"
            data-testid="sofia-validation-commands-list"
          >
            {(data) =>
              data.items.length === 0 ? (
                <div data-testid="sofia-validation-commands-empty">
                  <EmptyStrip
                    variant="console"
                    title="No hay comandos en esta cola"
                    description="Cuando SOFIA someta un comando gobernado (por ejemplo, envío de WhatsApp) que requiera revisión, aparecerá aquí para su aprobación o rechazo."
                  />
                </div>
              ) : (
                <>
                  <p className="mb-2.5 text-[11.5px] font-medium text-white/55" data-testid="sofia-validation-commands-count">
                    {data.total} {data.total === 1 ? 'comando' : 'comandos'} con los filtros actuales
                  </p>
                  <ul className="space-y-2" data-testid="sofia-validation-commands-rows">
                    {data.items.map((command) => {
                      const isActive = command.id === selectedId;
                      const tone = toneFromCommandStatus(command.status);
                      const Icon = secureCommandTypeIcon(command.commandType);
                      return (
                        <li key={command.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(command.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={cn(
                              'flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow]',
                              isActive
                                ? 'border-brand-400 bg-brand-400/[0.08] shadow-soft'
                                : 'border-white/10 bg-white/[0.04] hover:border-brand-400/40 hover:bg-white/[0.06]',
                            )}
                            data-testid={`sofia-validation-command-row-${command.id}`}
                          >
                            <span
                              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', TONE_AVATAR_CLASS_CONSOLE[tone])}
                              aria-hidden="true"
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-[13px] font-semibold text-white">{secureCommandTypeLabel(command.commandType)}</p>
                                <StatusBadge tone={tone} label={secureCommandStatusLabel(command.status)} variant="console" className="shrink-0" />
                              </div>
                              <p className="mt-0.5 truncate text-[12px] text-white/70">
                                Alcance: {command.scope} · Origen: {command.source}
                              </p>
                              <p className="mt-1 text-[11px] text-white/55">{formatDateTime(command.completedAt ?? command.claimedAt)}</p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3">
                    <Pager
                      page={data.page}
                      limit={data.limit}
                      total={data.total}
                      itemsLabel={data.total === 1 ? 'comando' : 'comandos'}
                      onPrev={() => setPage((current) => Math.max(1, current - 1))}
                      onNext={() => setPage((current) => current + 1)}
                      variant="console"
                      data-testid="sofia-validation-commands-pager"
                    />
                  </div>
                </>
              )
            }
          </QueryStateBoundary>
        </div>
      </div>

      {selectedId ? (
        <div className="lg:sticky lg:top-4 lg:self-start">
          <CommandDetail id={selectedId} onClosed={() => setSelectedId(null)} />
        </div>
      ) : (
        <div className={cn(CONSOLE_CARD_CLASS, 'lg:sticky lg:top-4 lg:self-start')} data-testid="sofia-validation-command-detail-placeholder">
          <EmptyStrip
            variant="console"
            title="Ningún comando seleccionado"
            description="Elige un comando de la lista para ver su detalle y, si aplica, aprobarlo o rechazarlo."
          />
        </div>
      )}
    </div>
  );
}

function CommandDetail({ id, onClosed }: { id: string; onClosed: () => void }) {
  const detailQuery = useSecureCommand(id);
  const approve = useSecureCommandApprove();
  const reject = useSecureCommandReject();

  const [approveReason, setApproveReason] = useState('');
  const [policyReference, setPolicyReference] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  function handleApprove(event: React.FormEvent) {
    event.preventDefault();
    if (!approveReason.trim() || !policyReference.trim()) return;
    approve.mutate(
      { id, reasonCode: approveReason.trim(), policyReference: policyReference.trim() },
      {
        onSuccess: () => {
          toast.success('Comando aprobado');
          setApproveReason('');
          setPolicyReference('');
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo aprobar el comando.'),
      },
    );
  }

  function handleReject(event: React.FormEvent) {
    event.preventDefault();
    if (!rejectReason.trim()) return;
    reject.mutate(
      { id, reasonCode: rejectReason.trim() },
      {
        onSuccess: () => {
          toast.success('Comando rechazado');
          setRejectReason('');
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo rechazar el comando.'),
      },
    );
  }

  return (
    <div className={cn(CONSOLE_CARD_CLASS)} data-testid="sofia-validation-command-detail">
      <QueryStateBoundary
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        error={detailQuery.error}
        data={detailQuery.data}
        loadingLabel="Cargando detalle del comando…"
        errorTitle="No se pudo cargar el comando"
        variant="console"
      >
        {(detail: SecureCommandDetail) => {
          const { command, approvals } = detail;
          const actionable = isSecureCommandActionable(command.status);
          const tone = toneFromCommandStatus(command.status);
          const Icon = secureCommandTypeIcon(command.commandType);
          return (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border', TONE_AVATAR_CLASS_CONSOLE[tone])} aria-hidden="true">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">Comando gobernado</p>
                    <h2 className="mt-0.5 truncate text-[15px] font-bold text-white">{secureCommandTypeLabel(command.commandType)}</h2>
                    <div className="mt-1.5">
                      <StatusBadge tone={tone} label={secureCommandStatusLabel(command.status)} variant="console" />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClosed}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-[background-color] hover:bg-white/10"
                  aria-label="Cerrar detalle del comando"
                  data-testid="sofia-validation-command-detail-close"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 text-[12px]">
                <DetailField label="Alcance" value={command.scope} />
                <DetailField label="Origen" value={command.source} />
                <DetailField label="Actor" value={`${command.actorId} (${command.actorType})`} />
                <DetailField label="Objetivo" value={command.targetType} />
                <DetailField label="Id objetivo" value={command.targetId ? truncateReferenceId(command.targetId) : '—'} />
                <DetailField label="Correlación" value={command.correlationId ? truncateReferenceId(command.correlationId) : '—'} />
                <DetailField label="Reclamado" value={formatDateTime(command.claimedAt)} />
                <DetailField label="Completado" value={formatDateTime(command.completedAt)} />
                <DetailField label="Expira" value={formatDateTime(command.expiresAt)} />
                <DetailField label="Versión" value={String(command.version)} />
                {command.failureClass && <DetailField label="Clase de falla" value={command.failureClass} />}
                {command.failureCode && <DetailField label="Código de falla" value={command.failureCode} />}
              </dl>

              {command.result && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3" data-testid="sofia-validation-command-result">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">Resultado</p>
                  <p className="mt-1 text-[12.5px] font-semibold text-white">{command.result.resultCode}</p>
                  {command.result.domainReferenceIds.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {command.result.domainReferenceIds.map((refId) => (
                        <Badge key={refId} tone="neutral">
                          {truncateReferenceId(refId)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">Aprobaciones</p>
                {approvals.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-white/70">Sin aprobaciones registradas todavía.</p>
                ) : (
                  <ol className="mt-2.5 space-y-3 border-l border-white/10 pl-4">
                    {approvals.map((approval) => {
                      const approved = approval.status === 'APPROVED';
                      return (
                        <li key={approval.id} className="relative text-[12px]">
                          <span
                            className={cn(
                              'absolute -left-[1.32rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white',
                              approved ? 'bg-emerald-500' : 'bg-stone-400',
                            )}
                            aria-hidden="true"
                          />
                          <p className="font-semibold text-white">
                            {approval.approverActorId} · {approval.status}
                          </p>
                          <p className="mt-0.5 text-white/70">
                            Motivo: {approval.reasonCode} · Política: {approval.policyReference}
                          </p>
                          <p className="mt-0.5 text-white/55">Otorgada: {formatDateTime(approval.grantedAt)}</p>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              {actionable ? (
                <div className="grid grid-cols-1 gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
                  <form
                    onSubmit={handleApprove}
                    className="space-y-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.08] p-3.5"
                    data-testid="sofia-validation-command-approve-form"
                  >
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-200">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Aprobar comando
                    </p>
                    <Input
                      value={approveReason}
                      onChange={(event) => setApproveReason(event.target.value)}
                      placeholder="reasonCode, ej. OPERATOR_APPROVED_NOTIFICATION"
                      className="border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
                      data-testid="sofia-validation-command-approve-reason"
                    />
                    <Input
                      value={policyReference}
                      onChange={(event) => setPolicyReference(event.target.value)}
                      placeholder="policyReference, ej. SOFIA_WHATSAPP_POLICY_V1"
                      className="border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
                      data-testid="sofia-validation-command-approve-policy"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
                      disabled={approve.isPending || !approveReason.trim() || !policyReference.trim()}
                      data-testid="sofia-validation-command-approve-submit"
                    >
                      {approve.isPending ? 'Aprobando…' : 'Aprobar'}
                    </Button>
                  </form>

                  <form
                    onSubmit={handleReject}
                    className="space-y-2 rounded-2xl border border-red-400/25 bg-red-400/[0.08] p-3.5"
                    data-testid="sofia-validation-command-reject-form"
                  >
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-red-200">
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      Rechazar comando
                    </p>
                    <Input
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      placeholder="reasonCode, ej. OPERATOR_REJECTED_CONTENT"
                      className="border-white/15 bg-white/[0.04] text-white placeholder:text-white/40"
                      data-testid="sofia-validation-command-reject-reason"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={reject.isPending || !rejectReason.trim()}
                      className="w-full border border-red-400/25 bg-red-400/[0.08] text-red-200 hover:bg-red-400/[0.14]"
                      data-testid="sofia-validation-command-reject-submit"
                    >
                      {reject.isPending ? 'Rechazando…' : 'Rechazar'}
                    </Button>
                  </form>
                </div>
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-[12px] text-white/70" data-testid="sofia-validation-command-not-actionable">
                  Este comando está en estado «{secureCommandStatusLabel(command.status)}» y no admite aprobación ni rechazo desde aquí.
                </p>
              )}
            </div>
          );
        }}
      </QueryStateBoundary>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-white">{value}</dd>
    </div>
  );
}
