'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { QueryStateBoundary, StatusBadge } from '@/components/sofia';
import { customerDisplayName } from '@/features/sofia/crm-display';
import { useSofiaCrmCustomers } from '@/features/sofia/queries';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export function CustomersListView() {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const customers = useSofiaCrmCustomers({ q: debouncedSearch, page, limit: PAGE_SIZE });

  return (
    <Card className="overflow-hidden p-0" data-testid="sofia-crm-customers-list">
      <div className="space-y-3 border-b border-stone-100 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">Directorio de clientes</h2>
          <p className="mt-0.5 text-[12px] text-stone-600">Identidad enmascarada, estado y tags del CRM.</p>
        </div>
        <div className="relative" data-testid="sofia-crm-customers-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar cliente por nombre o identidad…"
            className="pl-9"
            data-testid="sofia-crm-customers-search-input"
          />
        </div>
      </div>

      <QueryStateBoundary
        isLoading={customers.isLoading}
        isError={customers.isError}
        error={customers.error}
        data={customers.data}
        loadingLabel="Cargando clientes…"
        errorTitle="No se pudo cargar el directorio de clientes"
        data-testid="sofia-crm-customers"
      >
        {(result) => (
          <>
            <div className="hide-scrollbar divide-y divide-stone-100">
              {result.data.map((customer) => {
                const primaryIdentity = customer.identities.find((identity) => identity.isPrimary) ?? customer.identities[0];
                return (
                  <Link
                    key={customer.id}
                    href={`/sofia/crm/customers/${customer.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-stone-50"
                    data-testid="sofia-crm-customer-row"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[14px] font-extrabold text-ink">{customerDisplayName(customer.displayName)}</p>
                        <StatusBadge tone={customer.status === 'ACTIVE' ? 'success' : 'read_only'} label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'} />
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-stone-600">
                        {primaryIdentity ? primaryIdentity.valueMasked : 'Sin identidad registrada'} &middot; Cliente desde {formatDate(customer.createdAt)}
                      </p>
                      {customer.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {customer.tags.map((tag) => (
                            <Badge key={tag.id} tone="neutral">{tag.name}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>

            {result.data.length === 0 && (
              <div className="p-8">
                <EmptyState
                  icon={<Users className="h-5 w-5" />}
                  title="Sin clientes"
                  description={debouncedSearch ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes registrados en el CRM.'}
                />
              </div>
            )}

            {result.pagination.pages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-5 py-3.5" data-testid="sofia-crm-customers-pagination">
                <p className="text-[12px] font-semibold text-stone-600">
                  Página {result.pagination.page} de {result.pagination.pages} &middot; {result.pagination.total} clientes
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    data-testid="sofia-crm-customers-prev"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page >= result.pagination.pages}
                    onClick={() => setPage((current) => Math.min(result.pagination.pages, current + 1))}
                    data-testid="sofia-crm-customers-next"
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </QueryStateBoundary>
    </Card>
  );
}
