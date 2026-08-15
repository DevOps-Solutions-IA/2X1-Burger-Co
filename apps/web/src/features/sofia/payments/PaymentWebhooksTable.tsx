'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { QueryStateBoundary, StatusBadge } from '@/components/sofia/workspace';
import { useSofiaAdminPaymentWebhooks } from '@/features/sofia/queries';
import { formatPaymentAmount, formatPaymentDateTime, truncateId } from './format';
import { webhookProcessedStatusTone } from './status';
import { PaginationBar } from '@/components/sofia/workspace';

const PAGE_SIZE = 20;

const th = 'px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-stone-600';
const td = 'px-3 py-3 align-top text-[12.5px] text-stone-700';

export function PaymentWebhooksTable() {
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

  const webhooks = useSofiaAdminPaymentWebhooks({
    page,
    limit: PAGE_SIZE,
    paymentIntentId: paymentIntentId || undefined,
  });

  return (
    <div className="space-y-3" data-testid="sofia-payments-webhooks-view">
      <Input
        value={intentIdInput}
        onChange={(event) => setIntentIdInput(event.target.value)}
        placeholder="Filtrar por ID de intento de pago…"
        className="sm:max-w-[320px]"
        data-testid="sofia-payments-webhooks-intent-filter"
      />

      <QueryStateBoundary
        isLoading={webhooks.isLoading}
        isError={webhooks.isError}
        error={webhooks.error}
        data={webhooks.data}
        loadingLabel="Cargando webhooks de pago…"
        errorTitle="No se pudieron cargar los webhooks de pago"
        data-testid="sofia-payments-webhooks-boundary"
      >
        {(result) =>
          result.items.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-[1.15rem] border border-stone-200 bg-white">
                <table className="w-full min-w-[760px] border-collapse text-left" data-testid="sofia-payments-webhooks-table">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className={th}>Estado procesado</th>
                      <th className={th}>Proveedor / Evento</th>
                      <th className={th}>Firma</th>
                      <th className={th}>Monto</th>
                      <th className={th}>Intentos</th>
                      <th className={th}>Intento de pago</th>
                      <th className={th}>Recibido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((webhook) => (
                      <tr
                        key={webhook.id}
                        className="border-t border-stone-100"
                        data-testid={`sofia-payments-webhook-row-${webhook.id}`}
                      >
                        <td className={td}>
                          <StatusBadge tone={webhookProcessedStatusTone(webhook.processedStatus)} label={webhook.processedStatus} />
                          {webhook.lastErrorCode && (
                            <p className="mt-1 text-[11px] font-medium text-stone-600">{webhook.lastErrorCode}</p>
                          )}
                        </td>
                        <td className={td}>
                          <p className="font-semibold text-ink">{webhook.provider ?? '—'}</p>
                          <p className="text-[11px] font-medium text-stone-600">{webhook.eventType ?? '—'}</p>
                        </td>
                        <td className={td}>
                          {webhook.signatureValid === undefined ? (
                            '—'
                          ) : (
                            <StatusBadge
                              tone={webhook.signatureValid ? 'success' : 'blocked'}
                              label={webhook.signatureValid ? 'Válida' : 'Inválida'}
                              withDot={false}
                            />
                          )}
                        </td>
                        <td className={td}>{formatPaymentAmount(webhook.amount, webhook.currency)}</td>
                        <td className={td}>{webhook.processingAttempts ?? '—'}</td>
                        <td className={td}>{truncateId(webhook.paymentIntentId)}</td>
                        <td className={td}>{formatPaymentDateTime(webhook.receivedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={result.page}
                limit={result.limit}
                total={result.total}
                itemsLabel="webhooks"
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => current + 1)}
                data-testid="sofia-payments-webhooks-pagination"
              />
            </>
          ) : (
            <EmptyState
              title="Sin webhooks"
              description={paymentIntentId ? 'No hay webhooks que coincidan con el filtro.' : 'Todavía no hay webhooks de pago registrados.'}
            />
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
