'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { QueryStateBoundary, StatusBadge } from '@/components/sofia/workspace';
import { useSofiaAdminPaymentIntents } from '@/features/sofia/queries';
import { formatPaymentAmount, formatPaymentDateTime, truncateId } from './format';
import { intentStatusTone, PAYMENT_INTENT_STATUS_OPTIONS } from './status';
import { PaginationBar } from '@/components/sofia/workspace';

const PAGE_SIZE = 20;

const th = 'px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-stone-600';
const td = 'px-3 py-3 align-top text-[12.5px] text-stone-700';

export function PaymentIntentsTable() {
  const [status, setStatus] = useState('');
  const [checkoutIdInput, setCheckoutIdInput] = useState('');
  const [checkoutId, setCheckoutId] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setCheckoutId(checkoutIdInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [checkoutIdInput]);

  const intents = useSofiaAdminPaymentIntents({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    checkoutId: checkoutId || undefined,
  });

  return (
    <div className="space-y-3" data-testid="sofia-payments-intents-view">
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-[220px]"
          data-testid="sofia-payments-intents-status-filter"
          aria-label="Filtrar intentos de pago por estado"
        >
          <option value="">Todos los estados</option>
          {PAYMENT_INTENT_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input
          value={checkoutIdInput}
          onChange={(event) => setCheckoutIdInput(event.target.value)}
          placeholder="Filtrar por ID de checkout…"
          data-testid="sofia-payments-intents-checkout-filter"
        />
      </div>

      <QueryStateBoundary
        isLoading={intents.isLoading}
        isError={intents.isError}
        error={intents.error}
        data={intents.data}
        loadingLabel="Cargando intentos de pago…"
        errorTitle="No se pudieron cargar los intentos de pago"
        data-testid="sofia-payments-intents-boundary"
      >
        {(result) =>
          result.items.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-[1.15rem] border border-stone-200 bg-white">
                <table className="w-full min-w-[720px] border-collapse text-left" data-testid="sofia-payments-intents-table">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className={th}>Estado</th>
                      <th className={th}>Proveedor</th>
                      <th className={th}>Monto</th>
                      <th className={th}>Checkout</th>
                      <th className={th}>Falla</th>
                      <th className={th}>Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((intent) => (
                      <tr key={intent.id} className="border-t border-stone-100" data-testid={`sofia-payments-intent-row-${intent.id}`}>
                        <td className={td}>
                          <StatusBadge tone={intentStatusTone(intent.status)} label={intent.status} />
                          <p className="mt-1 text-[11px] font-medium text-stone-600">{truncateId(intent.id)}</p>
                        </td>
                        <td className={td}>{intent.provider}</td>
                        <td className={td}>{formatPaymentAmount(intent.amount, intent.currency)}</td>
                        <td className={td}>
                          {intent.checkoutId ? (
                            <>
                              <p className="font-semibold text-ink">{truncateId(intent.checkoutId)}</p>
                              {intent.checkout && typeof intent.checkout.status === 'string' && (
                                <p className="text-[11px] font-medium text-stone-600">{intent.checkout.status}</p>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={td}>{intent.failureCode ?? '—'}</td>
                        <td className={td}>{formatPaymentDateTime(intent.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={result.page}
                limit={result.limit}
                total={result.total}
                itemsLabel="intentos"
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => current + 1)}
                data-testid="sofia-payments-intents-pagination"
              />
            </>
          ) : (
            <EmptyState
              title="Sin intentos de pago"
              description={status || checkoutId ? 'No hay intentos que coincidan con el filtro.' : 'Todavía no hay intentos de pago registrados.'}
            />
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
