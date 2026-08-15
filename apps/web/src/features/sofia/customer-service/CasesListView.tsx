'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { StatusBadge, QueryStateBoundary } from '@/components/sofia/workspace';
import { useSofiaCustomerServiceCases } from '@/features/sofia/queries';
import { customerDisplayName, humanizeCrmCode } from '@/features/sofia/crm-display';
import {
  CUSTOMER_SERVICE_CASE_CATEGORIES,
  CUSTOMER_SERVICE_STATUS_LABEL,
  CUSTOMER_SERVICE_STATUS_SEQUENCE,
  customerServiceStatusLabel,
  customerServiceStatusTone,
} from './constants';

const PAGE_SIZE = 20;

export function CasesListView() {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const cases = useSofiaCustomerServiceCases({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    category: category || undefined,
  });

  const totalPages = cases.data ? Math.max(1, Math.ceil(cases.data.total / cases.data.limit)) : 1;

  return (
    <div className="space-y-3" data-testid="sofia-customer-service-list-view">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filtrar por estado"
          data-testid="sofia-customer-service-filter-status"
        >
          <option value="">Todos los estados</option>
          {CUSTOMER_SERVICE_STATUS_SEQUENCE.map((value) => (
            <option key={value} value={value}>
              {CUSTOMER_SERVICE_STATUS_LABEL[value]}
            </option>
          ))}
        </Select>
        <Select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
          aria-label="Filtrar por categoría"
          data-testid="sofia-customer-service-filter-category"
        >
          <option value="">Todas las categorías</option>
          {CUSTOMER_SERVICE_CASE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {humanizeCrmCode(value)}
            </option>
          ))}
        </Select>
      </div>

      <QueryStateBoundary
        isLoading={cases.isLoading}
        isError={cases.isError}
        error={cases.error}
        data={cases.data}
        loadingLabel="Cargando casos de servicio al cliente…"
        errorTitle="No se pudo cargar la lista de casos"
        data-testid="sofia-customer-service-cases"
      >
        {(result) =>
          result.items.length > 0 ? (
            <>
              <div className="space-y-2">
                {result.items.map((serviceCase) => (
                  <Link
                    key={serviceCase.id}
                    href={`/sofia/customer-service/${encodeURIComponent(serviceCase.id)}`}
                    className="group flex items-center justify-between gap-3 rounded-[1.15rem] border border-stone-200 bg-white p-3.5 transition-colors hover:border-brand-200"
                    data-testid={`sofia-customer-service-case-row-${serviceCase.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13.5px] font-semibold text-ink">{humanizeCrmCode(serviceCase.category)}</p>
                        <StatusBadge
                          tone={customerServiceStatusTone(serviceCase.status)}
                          label={customerServiceStatusLabel(serviceCase.status)}
                        />
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] font-medium text-stone-600">
                        {serviceCase.sanitizedSummary || 'Sin resumen registrado'}
                      </p>
                      <p className="mt-1 text-[10.5px] font-medium text-stone-600">
                        {serviceCase.customer ? customerDisplayName(serviceCase.customer.displayName) : 'Sin cliente vinculado'} ·{' '}
                        {humanizeCrmCode(serviceCase.source)} · {new Date(serviceCase.createdAt).toLocaleString('es-CO')}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-stone-400 group-hover:text-brand-600" aria-hidden="true" />
                  </Link>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 pt-1" data-testid="sofia-customer-service-pagination">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Anterior
                  </Button>
                  <span className="text-[12px] font-medium text-stone-600">
                    Página {result.page} de {totalPages} · {result.total} casos
                  </span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title="Sin casos"
              description="No hay casos de servicio al cliente que coincidan con los filtros seleccionados."
            />
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
