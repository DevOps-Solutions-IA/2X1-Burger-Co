'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search, Tags, UserRound, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Pager, QueryStateBoundary, StatCard, StatusBadge } from '@/components/sofia';
import { customerDisplayName, customerInitials } from '@/features/sofia/crm-display';
import { useSofiaCrmCustomers } from '@/features/sofia/queries';
import { formatDate, formatNumber } from '@/lib/format';

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
    <div className="space-y-4">
      <Card className="p-0" data-testid="sofia-crm-customers-search">
        <div className="px-5 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar cliente por nombre o identidad…"
              className="pl-9 pr-9"
              data-testid="sofia-crm-customers-search-input"
            />
            {searchInput.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                aria-label="Limpiar búsqueda"
                data-testid="sofia-crm-customers-search-clear"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </Card>

      <QueryStateBoundary
        isLoading={customers.isLoading}
        isError={customers.isError}
        error={customers.error}
        data={customers.data}
        loadingLabel="Cargando clientes…"
        errorTitle="No se pudo cargar el directorio de clientes"
        data-testid="sofia-crm-customers"
      >
        {(result) => {
          const withTags = result.data.filter((customer) => customer.tags.length > 0).length;
          return (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard
                  label="Clientes en el CRM"
                  value={formatNumber(result.pagination.total)}
                  hint={debouncedSearch ? 'Total que coincide con la búsqueda.' : 'Directorio completo, sin filtros.'}
                  icon={<Users className="h-4 w-4" aria-hidden="true" />}
                  accent="brand"
                  data-testid="sofia-crm-customers-stat-total"
                />
                <StatCard
                  label="En esta página"
                  value={formatNumber(result.data.length)}
                  hint={`Página ${result.pagination.page} de ${Math.max(1, result.pagination.pages)}.`}
                  icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
                  accent="ink"
                  data-testid="sofia-crm-customers-stat-page"
                />
                <StatCard
                  label="Con tags en esta página"
                  value={formatNumber(withTags)}
                  hint="Clientes con al menos un tag asignado."
                  icon={<Tags className="h-4 w-4" aria-hidden="true" />}
                  accent="warning"
                  data-testid="sofia-crm-customers-stat-tags"
                />
              </div>

              <Card className="overflow-hidden p-0" data-testid="sofia-crm-customers-list">
                {result.data.length === 0 ? (
                  <div className="p-8">
                    <EmptyState
                      icon={<Users className="h-5 w-5" aria-hidden="true" />}
                      title="Sin clientes"
                      description={debouncedSearch ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes registrados en el CRM.'}
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100">
                    {result.data.map((customer) => {
                      const primaryIdentity = customer.identities.find((identity) => identity.isPrimary) ?? customer.identities[0];
                      const name = customerDisplayName(customer.displayName);
                      return (
                        <Link
                          key={customer.id}
                          href={`/sofia/crm/customers/${customer.id}`}
                          className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-stone-50"
                          data-testid="sofia-crm-customer-row"
                        >
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-[12.5px] font-extrabold text-brand-800"
                            aria-hidden="true"
                          >
                            {customerInitials(customer.displayName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-[14px] font-extrabold text-ink">{name}</p>
                              <StatusBadge tone={customer.status === 'ACTIVE' ? 'success' : 'read_only'} label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'} />
                            </div>
                            <p className="mt-0.5 truncate text-[12px] text-stone-600">
                              {primaryIdentity ? primaryIdentity.valueMasked : 'Sin identidad registrada'} &middot; Cliente desde {formatDate(customer.createdAt)}
                            </p>
                            {customer.tags.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {customer.tags.map((tag) => (
                                  <Badge key={tag.id} tone="neutral">
                                    {tag.name}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Pager
                page={result.pagination.page}
                limit={result.pagination.limit}
                total={result.pagination.total}
                pages={result.pagination.pages}
                itemsLabel="clientes"
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => Math.min(Math.max(1, result.pagination.pages), current + 1))}
                data-testid="sofia-crm-customers-pagination"
              />
            </div>
          );
        }}
      </QueryStateBoundary>
    </div>
  );
}
