'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { QueryStateBoundary, StatusBadge } from '@/components/sofia/workspace';
import { useSofiaAdminPaymentTransitions } from '@/features/sofia/queries';
import { formatPaymentDateTime, truncateId } from './format';
import { intentStatusTone } from './status';
import { PaginationBar } from '@/components/sofia/workspace';

const PAGE_SIZE = 20;

const th = 'px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-stone-600';
const td = 'px-3 py-3 align-top text-[12.5px] text-stone-700';

export function PaymentTransitionsTable() {
  const [intentIdInput, setIntentIdInput] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPaymentIntentId(intentIdInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [intentIdInput]);

  const transitions = useSofiaAdminPaymentTransitions({
    page,
    limit: PAGE_SIZE,
    paymentIntentId: paymentIntentId || undefined,
  });

  return (
    <div className="space-y-3" data-testid="sofia-payments-transitions-view">
      <Input
        value={intentIdInput}
        onChange={(event) => setIntentIdInput(event.target.value)}
        placeholder="Filtrar por ID de intento de pago…"
        className="sm:max-w-[320px]"
        data-testid="sofia-payments-transitions-intent-filter"
      />

      <QueryStateBoundary
        isLoading={transitions.isLoading}
        isError={transitions.isError}
        error={transitions.error}
        data={transitions.data}
        loadingLabel="Cargando transiciones de pago…"
        errorTitle="No se pudieron cargar las transiciones de pago"
        data-testid="sofia-payments-transitions-boundary"
      >
        {(result) =>
          result.items.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-[1.15rem] border border-stone-200 bg-white">
                <table className="w-full min-w-[640px] border-collapse text-left" data-testid="sofia-payments-transitions-table">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className={th}>Transición</th>
                      <th className={th}>Motivo</th>
                      <th className={th}>Intento de pago</th>
                      <th className={th}>Actor</th>
                      <th className={th}>Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((transition) => (
                      <tr
                        key={transition.id}
                        className="border-t border-stone-100"
                        data-testid={`sofia-payments-transition-row-${transition.id}`}
                      >
                        <td className={td}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {transition.fromStatus ? (
                              <StatusBadge tone={intentStatusTone(transition.fromStatus)} label={transition.fromStatus} />
                            ) : (
                              <span className="text-[11px] font-medium text-stone-600">Origen —</span>
                            )}
                            <ArrowRight className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
                            <StatusBadge tone={intentStatusTone(transition.toStatus)} label={transition.toStatus} />
                          </div>
                        </td>
                        <td className={td}>{transition.reasonCode ?? '—'}</td>
                        <td className={td}>{truncateId(transition.paymentIntentId)}</td>
                        <td className={td}>{transition.actorId ? truncateId(transition.actorId) : 'Sistema'}</td>
                        <td className={td}>{formatPaymentDateTime(transition.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={result.page}
                limit={result.limit}
                total={result.total}
                itemsLabel="transiciones"
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => current + 1)}
                data-testid="sofia-payments-transitions-pagination"
              />
            </>
          ) : (
            <EmptyState
              title="Sin transiciones"
              description={paymentIntentId ? 'No hay transiciones que coincidan con el filtro.' : 'Todavía no hay transiciones de pago registradas.'}
            />
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
