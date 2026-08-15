'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { QueryStateBoundary, StatusBadge } from '@/components/sofia/workspace';
import { useSofiaAdminPaymentLinks } from '@/features/sofia/queries';
import { formatPaymentDateTime, truncateId } from './format';
import { linkStatusTone, PAYMENT_LINK_STATUS_OPTIONS } from './status';
import { PaginationBar } from '@/components/sofia/workspace';

const PAGE_SIZE = 20;

const th = 'px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-stone-600';
const td = 'px-3 py-3 align-top text-[12.5px] text-stone-700';

export function PaymentLinksTable() {
  const [status, setStatus] = useState('');
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

  const links = useSofiaAdminPaymentLinks({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    paymentIntentId: paymentIntentId || undefined,
  });

  return (
    <div className="space-y-3" data-testid="sofia-payments-links-view">
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-[220px]"
          data-testid="sofia-payments-links-status-filter"
          aria-label="Filtrar enlaces de pago por estado"
        >
          <option value="">Todos los estados</option>
          {PAYMENT_LINK_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input
          value={intentIdInput}
          onChange={(event) => setIntentIdInput(event.target.value)}
          placeholder="Filtrar por ID de intento de pago…"
          data-testid="sofia-payments-links-intent-filter"
        />
      </div>

      <QueryStateBoundary
        isLoading={links.isLoading}
        isError={links.isError}
        error={links.error}
        data={links.data}
        loadingLabel="Cargando enlaces de pago…"
        errorTitle="No se pudieron cargar los enlaces de pago"
        data-testid="sofia-payments-links-boundary"
      >
        {(result) =>
          result.items.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-[1.15rem] border border-stone-200 bg-white">
                <table className="w-full min-w-[640px] border-collapse text-left" data-testid="sofia-payments-links-table">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className={th}>Estado</th>
                      <th className={th}>Intento de pago</th>
                      <th className={th}>Abierto</th>
                      <th className={th}>Revocado</th>
                      <th className={th}>Vence</th>
                      <th className={th}>Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((link) => (
                      <tr key={link.id} className="border-t border-stone-100" data-testid={`sofia-payments-link-row-${link.id}`}>
                        <td className={td}>
                          <StatusBadge tone={linkStatusTone(link.status)} label={link.status} />
                        </td>
                        <td className={td}>{truncateId(link.paymentIntentId)}</td>
                        <td className={td}>{formatPaymentDateTime(link.openedAt)}</td>
                        <td className={td}>{formatPaymentDateTime(link.revokedAt)}</td>
                        <td className={td}>{formatPaymentDateTime(link.expiresAt)}</td>
                        <td className={td}>{formatPaymentDateTime(link.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={result.page}
                limit={result.limit}
                total={result.total}
                itemsLabel="enlaces"
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => current + 1)}
                data-testid="sofia-payments-links-pagination"
              />
            </>
          ) : (
            <EmptyState
              title="Sin enlaces de pago"
              description={status || paymentIntentId ? 'No hay enlaces que coincidan con el filtro.' : 'Todavía no hay enlaces de pago registrados.'}
            />
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
