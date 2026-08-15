import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PaginationBar, QueryStateBoundary, StatusBadge } from '@/components/sofia/workspace';
import { useSofiaCustomerServiceCases } from '@/features/sofia/queries';
import { humanizeCrmCode } from '@/features/sofia/crm-display';
import { customerServiceStatusLabel, customerServiceStatusTone } from '@/features/sofia/customer-service/constants';

const PAGE_SIZE = 10;

/** Casos de servicio al cliente reales de este cliente, filtrados por customerId. */
export function CasesPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const cases = useSofiaCustomerServiceCases({ page, limit: PAGE_SIZE, customerId });

  return (
    <Card data-testid="sofia-customer360-cases">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">Casos</p>
      <h2 className="text-[15px] font-semibold text-ink">Servicio al cliente</h2>

      <div className="mt-3">
        <QueryStateBoundary
          isLoading={cases.isLoading}
          isError={cases.isError}
          error={cases.error}
          data={cases.data}
          loadingLabel="Cargando casos del cliente…"
          errorTitle="No se pudieron cargar los casos"
          data-testid="sofia-customer360-cases-boundary"
        >
          {(result) =>
            result.items.length > 0 ? (
              <>
                <div className="space-y-2">
                  {result.items.map((serviceCase) => (
                    <Link
                      key={serviceCase.id}
                      href={`/sofia/customer-service/${encodeURIComponent(serviceCase.id)}`}
                      className="group flex items-center justify-between gap-3 rounded-[1.15rem] border border-stone-200 bg-white p-3 transition-colors hover:border-brand-200"
                      data-testid={`sofia-customer360-case-row-${serviceCase.id}`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-semibold text-ink">{humanizeCrmCode(serviceCase.category)}</p>
                          <StatusBadge tone={customerServiceStatusTone(serviceCase.status)} label={customerServiceStatusLabel(serviceCase.status)} />
                        </div>
                        <p className="mt-0.5 truncate text-[11px] font-medium text-stone-600">
                          {serviceCase.sanitizedSummary || 'Sin resumen registrado'}
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-stone-400 group-hover:text-brand-600" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
                <div className="mt-2">
                  <PaginationBar
                    page={result.page}
                    limit={result.limit}
                    total={result.total}
                    itemsLabel="casos"
                    onPrev={() => setPage((current) => Math.max(1, current - 1))}
                    onNext={() => setPage((current) => current + 1)}
                    data-testid="sofia-customer360-cases-pagination"
                  />
                </div>
              </>
            ) : (
              <EmptyState title="Sin casos" description="Este cliente no tiene casos de servicio al cliente registrados." />
            )
          }
        </QueryStateBoundary>
      </div>
    </Card>
  );
}
