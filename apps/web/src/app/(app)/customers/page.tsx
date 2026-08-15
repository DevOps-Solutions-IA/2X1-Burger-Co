'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ContactRound, Search, ShieldCheck, UsersRound } from 'lucide-react';
import {
  DataTableShell,
  FilterBar,
  MetricSurface,
  ModuleTabs,
  PageHeader,
  QueryState,
  StatusBadge,
  type DataTableColumn,
} from '@/components/product';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-provider';
import { hasPermission } from '@/features/auth/access-control';
import type { SofiaCrmCustomerSummary } from '@/features/sofia/contracts';
import { Pagination, PrivacyNotice } from '@/features/customer-operations/components';
import { customerDisplayName } from '@/features/customer-operations/model';
import { useCustomerDirectory } from '@/features/customer-operations/queries';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 25;

const columns: ReadonlyArray<DataTableColumn<SofiaCrmCustomerSummary>> = [
  {
    id: 'customer',
    header: 'Cliente',
    cell: (customer) => (
      <div className="min-w-0">
        <Link
          href={`/customers/${encodeURIComponent(customer.id)}`}
          className="font-semibold text-ink underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {customerDisplayName(customer.displayName)}
        </Link>
        <p className="mt-1 font-mono text-xs text-muted">
          {customer.identities.find((identity) => identity.isPrimary)?.valueMasked ?? 'Identidad no disponible'}
        </p>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Estado',
    cell: (customer) => (
      <StatusBadge
        status={customer.status}
        label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'}
        tone={customer.status === 'ACTIVE' ? 'success' : 'neutral'}
      />
    ),
  },
  {
    id: 'tags',
    header: 'Etiquetas',
    cell: (customer) =>
      customer.tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {customer.tags.slice(0, 3).map((tag) => (
            <span key={tag.id} className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-ink">
              {tag.name}
            </span>
          ))}
          {customer.tags.length > 3 ? <span className="text-xs text-muted">+{customer.tags.length - 3}</span> : null}
        </div>
      ) : (
        <span className="text-sm text-muted">Sin etiquetas</span>
      ),
  },
  {
    id: 'updated',
    header: 'Actualizado',
    cell: (customer) => <span className="text-sm tabular-nums text-muted">{formatDateTime(customer.updatedAt)}</span>,
  },
];

export default function CustomersPage() {
  const { user } = useAuth();
  const canRead = hasPermission(user?.permissions, 'orders.read');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const customers = useCustomerDirectory({ q: query, page, limit: PAGE_SIZE }, canRead);
  const data = customers.data;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchInput.trim());
    setPage(1);
  }

  function clearSearch() {
    setSearchInput('');
    setQuery('');
    setPage(1);
  }

  const queryStatus = !canRead
    ? 'permission_denied'
    : customers.isPending
      ? 'loading'
      : customers.isError || !data
        ? 'error'
        : data.data.length === 0
          ? 'empty'
          : 'ready';

  return (
    <div className="space-y-6" data-testid="customers-page">
      <PageHeader
        eyebrow="Customer operations"
        title="Clientes"
        description="Directorio canónico de clientes con identidades protegidas, consentimiento y trazabilidad. Nunca se muestran teléfonos completos."
        status={<StatusBadge status="PROTECTED" label="Identidades protegidas" tone="success" />}
      />

      <ModuleTabs
        label="Navegación de clientes"
        items={[
          { id: 'directory', label: 'Directorio', href: '/customers', active: true },
          { id: 'conversations', label: 'Conversaciones', href: '/conversations' },
        ]}
      />

      {data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricSurface label="Clientes encontrados" value={data.pagination.total.toLocaleString('es-CO')} icon={<UsersRound className="h-5 w-5" />} />
          <MetricSurface label="Página actual" value={`${data.pagination.page} / ${Math.max(data.pagination.pages, 1)}`} context={`${data.data.length} perfiles visibles`} icon={<ContactRound className="h-5 w-5" />} />
          <MetricSurface label="Privacidad del contrato" value="Protegida" context="Identidades enmascaradas y timeline sanitizado" icon={<ShieldCheck className="h-5 w-5" />} />
        </div>
      ) : null}

      <FilterBar
        activeCount={query ? 1 : 0}
        search={
          <form className="flex flex-col gap-2 sm:flex-row" role="search" onSubmit={submitSearch}>
            <div className="min-w-0 flex-1">
              <label htmlFor="customer-directory-search" className="sr-only">Buscar cliente por nombre o teléfono</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <Input
                  id="customer-directory-search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Buscar por nombre o teléfono"
                  autoComplete="off"
                  maxLength={100}
                  className="pl-10 text-base sm:text-sm"
                />
              </div>
            </div>
            <Button type="submit" size="sm" className="min-h-11">Buscar</Button>
          </form>
        }
        actions={query ? <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={clearSearch}>Limpiar</Button> : undefined}
      />

      <PrivacyNotice>
        La búsqueda por teléfono se resuelve de forma segura en el backend. Esta interfaz solo recibe la identidad enmascarada.
      </PrivacyNotice>

      <QueryState
        status={queryStatus}
        title={customers.isError ? 'No se pudo cargar el directorio' : undefined}
        description={customers.isError ? 'El directorio CRM no está disponible. No se reemplaza con clientes de ejemplo.' : undefined}
        onRetry={customers.isError ? () => void customers.refetch() : undefined}
      >
        {data ? (
          <div className="space-y-4">
            <DataTableShell
              rows={data.data}
              columns={columns}
              rowKey={(customer) => customer.id}
              caption="Directorio de clientes CRM"
              rowActions={(customer) => (
                <Button asChild variant="ghost" size="sm" className="min-h-11">
                  <Link href={`/customers/${encodeURIComponent(customer.id)}`} aria-label={`Abrir perfil de ${customerDisplayName(customer.displayName)}`}>
                    Ver perfil <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              )}
            />
            <Pagination
              page={data.pagination.page}
              pages={data.pagination.pages}
              total={data.pagination.total}
              onChange={setPage}
              disabled={customers.isFetching}
            />
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}
