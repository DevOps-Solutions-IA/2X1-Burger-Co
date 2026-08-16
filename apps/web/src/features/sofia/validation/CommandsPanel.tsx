'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge, QueryStateBoundary, toneFromCommandStatus } from '@/components/sofia';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import {
  useSecureCommands,
  useSecureCommand,
  useSecureCommandApprove,
  useSecureCommandReject,
} from '@/features/sofia/queries';
import { secureCommandStatusSchema, secureCommandTypeSchema, type SecureCommandDetail } from '@/features/sofia/contracts';
import { isSecureCommandActionable, secureCommandStatusLabel, secureCommandTypeLabel } from './labels';
import { Pager } from './Pager';

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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="sofia-validation-commands-panel">
      <Card data-testid="sofia-validation-commands-list-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[11rem]">
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-600" htmlFor="sofia-validation-commands-filter-status">
              Estado
            </label>
            <Select
              id="sofia-validation-commands-filter-status"
              className="mt-1"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
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
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-600" htmlFor="sofia-validation-commands-filter-type">
              Tipo de comando
            </label>
            <Select
              id="sofia-validation-commands-filter-type"
              className="mt-1"
              value={commandType}
              onChange={(event) => {
                setCommandType(event.target.value);
                setPage(1);
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

        <div className="mt-4">
          <QueryStateBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            data={query.data}
            loadingLabel="Cargando comandos gobernados…"
            errorTitle="No se pudieron cargar los comandos"
            data-testid="sofia-validation-commands-list"
          >
            {(data) =>
              data.items.length === 0 ? (
                <div data-testid="sofia-validation-commands-empty">
                  <EmptyState
                    title="No hay comandos en esta cola"
                    description="Cuando SOFIA someta un comando gobernado (por ejemplo, envío de WhatsApp) que requiera revisión, aparecerá aquí."
                  />
                </div>
              ) : (
                <>
                  <ul className="space-y-2" data-testid="sofia-validation-commands-rows">
                    {data.items.map((command) => {
                      const isActive = command.id === selectedId;
                      return (
                        <li key={command.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(command.id)}
                            className={
                              'flex w-full flex-col gap-1.5 rounded-[1.1rem] border px-3.5 py-3 text-left transition-colors sm:flex-row sm:items-center sm:justify-between ' +
                              (isActive
                                ? 'border-brand-400 bg-brand-50/70 shadow-soft'
                                : 'border-stone-200 bg-white hover:border-brand-200 hover:bg-brand-50/40')
                            }
                            data-testid={`sofia-validation-command-row-${command.id}`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-ink">{secureCommandTypeLabel(command.commandType)}</p>
                              <p className="mt-0.5 truncate text-[12px] text-stone-600">
                                Alcance: {command.scope} · Origen: {command.source}
                              </p>
                              <p className="mt-0.5 text-[11px] text-stone-600">{formatDateTime(command.completedAt ?? command.claimedAt)}</p>
                            </div>
                            <StatusBadge tone={toneFromCommandStatus(command.status)} label={secureCommandStatusLabel(command.status)} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <Pager page={data.page} limit={data.limit} total={data.total} onPageChange={setPage} data-testid="sofia-validation-commands-pager" />
                </>
              )
            }
          </QueryStateBoundary>
        </div>
      </Card>

      {selectedId ? (
        <CommandDetail id={selectedId} onClosed={() => setSelectedId(null)} />
      ) : (
        <Card data-testid="sofia-validation-command-detail-placeholder">
          <EmptyState title="Ningún comando seleccionado" description="Elige un comando de la lista para ver su detalle y, si aplica, aprobarlo o rechazarlo." />
        </Card>
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
    <Card data-testid="sofia-validation-command-detail">
      <QueryStateBoundary
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        error={detailQuery.error}
        data={detailQuery.data}
        loadingLabel="Cargando detalle del comando…"
        errorTitle="No se pudo cargar el comando"
      >
        {(detail: SecureCommandDetail) => {
          const { command, approvals } = detail;
          const actionable = isSecureCommandActionable(command.status);
          return (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">Comando</p>
                  <h2 className="mt-0.5 truncate text-[15px] font-bold text-ink">{secureCommandTypeLabel(command.commandType)}</h2>
                </div>
                <button type="button" onClick={onClosed} className="text-[11px] font-semibold text-stone-600 hover:text-ink" data-testid="sofia-validation-command-detail-close">
                  Cerrar
                </button>
              </div>

              <StatusBadge tone={toneFromCommandStatus(command.status)} label={secureCommandStatusLabel(command.status)} />

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                <DetailField label="Alcance" value={command.scope} />
                <DetailField label="Origen" value={command.source} />
                <DetailField label="Actor" value={`${command.actorId} (${command.actorType})`} />
                <DetailField label="Objetivo" value={command.targetType} />
                <DetailField label="Id objetivo" value={command.targetId ?? '—'} />
                <DetailField label="Correlación" value={command.correlationId ?? '—'} />
                <DetailField label="Reclamado" value={formatDateTime(command.claimedAt)} />
                <DetailField label="Completado" value={formatDateTime(command.completedAt)} />
                <DetailField label="Expira" value={formatDateTime(command.expiresAt)} />
                <DetailField label="Versión" value={String(command.version)} />
                {command.failureClass && <DetailField label="Clase de falla" value={command.failureClass} />}
                {command.failureCode && <DetailField label="Código de falla" value={command.failureCode} />}
              </dl>

              {command.result && (
                <div className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-600">Resultado</p>
                  <p className="mt-1 text-[12.5px] font-semibold text-ink">{command.result.resultCode}</p>
                  {command.result.domainReferenceIds.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {command.result.domainReferenceIds.map((refId) => (
                        <Badge key={refId} tone="neutral">
                          {refId}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-600">Aprobaciones</p>
                {approvals.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-stone-600">Sin aprobaciones registradas todavía.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {approvals.map((approval) => (
                      <li key={approval.id} className="rounded-[0.9rem] border border-stone-200 bg-white px-3 py-2 text-[12px]">
                        <p className="font-semibold text-ink">
                          {approval.approverActorId} · {approval.status}
                        </p>
                        <p className="mt-0.5 text-stone-600">
                          Motivo: {approval.reasonCode} · Política: {approval.policyReference}
                        </p>
                        <p className="mt-0.5 text-stone-600">Otorgada: {formatDateTime(approval.grantedAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {actionable ? (
                <div className="space-y-4 border-t border-stone-200 pt-4">
                  <form onSubmit={handleApprove} className="space-y-2" data-testid="sofia-validation-command-approve-form">
                    <p className="text-[12px] font-semibold text-ink">Aprobar comando</p>
                    <Input
                      value={approveReason}
                      onChange={(event) => setApproveReason(event.target.value)}
                      placeholder="reasonCode, ej. OPERATOR_APPROVED_NOTIFICATION"
                      data-testid="sofia-validation-command-approve-reason"
                    />
                    <Input
                      value={policyReference}
                      onChange={(event) => setPolicyReference(event.target.value)}
                      placeholder="policyReference, ej. SOFIA_WHATSAPP_POLICY_V1"
                      data-testid="sofia-validation-command-approve-policy"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={approve.isPending || !approveReason.trim() || !policyReference.trim()}
                      data-testid="sofia-validation-command-approve-submit"
                    >
                      {approve.isPending ? 'Aprobando…' : 'Aprobar comando'}
                    </Button>
                  </form>

                  <form onSubmit={handleReject} className="space-y-2" data-testid="sofia-validation-command-reject-form">
                    <p className="text-[12px] font-semibold text-ink">Rechazar comando</p>
                    <Input
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      placeholder="reasonCode, ej. OPERATOR_REJECTED_CONTENT"
                      data-testid="sofia-validation-command-reject-reason"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={reject.isPending || !rejectReason.trim()}
                      className="border border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                      data-testid="sofia-validation-command-reject-submit"
                    >
                      {reject.isPending ? 'Rechazando…' : 'Rechazar comando'}
                    </Button>
                  </form>
                </div>
              ) : (
                <p className="rounded-[1rem] border border-stone-200 bg-stone-50 px-3 py-2.5 text-[12px] text-stone-600" data-testid="sofia-validation-command-not-actionable">
                  Este comando está en estado «{secureCommandStatusLabel(command.status)}» y no admite aprobación ni rechazo desde aquí.
                </p>
              )}
            </div>
          );
        }}
      </QueryStateBoundary>
    </Card>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-600">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-ink">{value}</dd>
    </div>
  );
}
