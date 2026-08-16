'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, LifeBuoy } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pager, QueryStateBoundary, StatusBadge, type SofiaStatusTone } from '@/components/sofia';
import { useSofiaCustomerServiceCases } from '@/features/sofia/queries';
import { formatDateTime } from '@/lib/format';

const CASE_STATUS_TONE: Record<string, SofiaStatusTone> = {
  OPEN: 'pending',
  HUMAN_REQUIRED: 'human_required',
  HUMAN_TAKEN: 'warning',
  RESOLVED: 'success',
  CLOSED: 'read_only',
};

const CASE_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Abierto',
  HUMAN_REQUIRED: 'Requiere humano',
  HUMAN_TAKEN: 'Tomado por humano',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
};

const PAGE_SIZE = 10;

export function CasesPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const cases = useSofiaCustomerServiceCases({ customerId, page, limit: PAGE_SIZE });

  return (
    <Card data-testid="sofia-customer360-cases-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-extrabold text-ink">Casos de servicio al cliente</h3>
          <p className="mt-0.5 text-[12px] text-stone-600">
            Casos escalados por SOFIA a un humano. La transición de estado se hace en{' '}
            <Link href="/sofia/validation" className="font-semibold text-brand-700 hover:text-brand-900">
              Validación
            </Link>
            .
          </p>
        </div>
        <LifeBuoy className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
      </div>

      <QueryStateBoundary
        isLoading={cases.isLoading}
        isError={cases.isError}
        error={cases.error}
        data={cases.data}
        loadingLabel="Cargando casos del cliente…"
        errorTitle="No se pudo cargar los casos"
      >
        {(result) => {
          const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
          return (
            <>
              {result.items.length === 0 ? (
                <div className="mt-3">
                  <EmptyState icon={<LifeBuoy className="h-5 w-5" aria-hidden="true" />} title="Sin casos" description="Este cliente no tiene casos de servicio registrados." />
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {result.items.map((serviceCase) => (
                    <li key={serviceCase.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[13px] font-bold text-ink">{serviceCase.category}</p>
                        <StatusBadge tone={CASE_STATUS_TONE[serviceCase.status] ?? 'read_only'} label={CASE_STATUS_LABEL[serviceCase.status] ?? serviceCase.status} />
                      </div>
                      {serviceCase.sanitizedSummary && <p className="mt-1 text-[12px] leading-5 text-stone-600">{serviceCase.sanitizedSummary}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-stone-600">
                          Fuente: {serviceCase.source} &middot; {formatDateTime(serviceCase.createdAt)}
                        </p>
                        <Link
                          href="/sofia/validation"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-900"
                          data-testid="sofia-customer360-case-validation-link"
                        >
                          Ver en Validación
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Pager
                  page={page}
                  limit={result.limit}
                  total={result.total}
                  pages={totalPages}
                  itemsLabel="casos"
                  onPrev={() => setPage((current) => Math.max(1, current - 1))}
                  onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
                  data-testid="sofia-customer360-cases-pagination"
                />
              </div>
            </>
          );
        }}
      </QueryStateBoundary>
    </Card>
  );
}
