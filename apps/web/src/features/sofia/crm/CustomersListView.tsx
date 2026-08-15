'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge, QueryStateBoundary } from '@/components/sofia/workspace';
import { useSofiaCrmCustomers } from '@/features/sofia/queries';
import { customerDisplayName } from '@/features/sofia/crm-display';

const PAGE_SIZE = 20;

export function CustomersListView() {
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setQuery(inputValue);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [inputValue]);

  const customers = useSofiaCrmCustomers({ q: query, page, limit: PAGE_SIZE });

  return (
    <div className="space-y-3" data-testid="sofia-crm-customers-view">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <Input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Buscar por nombre o identidad enmascarada…"
          className="pl-9"
          data-testid="sofia-crm-search-input"
        />
      </div>

      <QueryStateBoundary
        isLoading={customers.isLoading}
        isError={customers.isError}
        error={customers.error}
        data={customers.data}
        loadingLabel="Buscando clientes…"
        errorTitle="No se pudo cargar el directorio de clientes"
        data-testid="sofia-crm-customers"
      >
        {(result) =>
          result.data.length > 0 ? (
            <>
              <div className="space-y-2">
                {result.data.map((customer) => (
                  <Link
                    key={customer.id}
                    href={`/sofia/crm/customers/${encodeURIComponent(customer.id)}`}
                    className="group flex items-center justify-between gap-3 rounded-[1.15rem] border border-stone-200 bg-white p-3.5 transition-colors hover:border-sofia-200"
                    data-testid={`sofia-crm-customer-row-${customer.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-ink">{customerDisplayName(customer.displayName)}</p>
                      <p className="mt-0.5 text-[11.5px] font-medium text-stone-500">
                        {customer.identities.find((identity) => identity.isPrimary)?.valueMasked ?? 'Sin identidad primaria'}
                      </p>
                      {customer.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {customer.tags.map((tag) => (
                            <StatusBadge key={tag.id} tone="read_only" label={tag.name} withDot={false} />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge tone={customer.status === 'ACTIVE' ? 'success' : 'read_only'} label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'} withDot={false} />
                      <ArrowUpRight className="h-4 w-4 text-stone-400 group-hover:text-sofia-600" />
                    </div>
                  </Link>
                ))}
              </div>

              {result.pagination.pages > 1 && (
                <div className="flex items-center justify-between gap-3 pt-1" data-testid="sofia-crm-pagination">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Anterior
                  </Button>
                  <span className="text-[12px] font-medium text-stone-500">
                    Página {result.pagination.page} de {result.pagination.pages} · {result.pagination.total} clientes
                  </span>
                  <Button variant="secondary" size="sm" disabled={page >= result.pagination.pages} onClick={() => setPage((current) => current + 1)}>
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState title="Sin clientes" description={query ? 'No hay clientes que coincidan con la búsqueda.' : 'Todavía no hay clientes registrados en el CRM.'} />
          )
        }
      </QueryStateBoundary>
    </div>
  );
}
