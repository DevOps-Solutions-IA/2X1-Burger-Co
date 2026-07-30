'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ContactRound,
  Eraser,
  Search,
  ShieldCheck,
  Tags,
  UserRound,
} from 'lucide-react';
import {
  SofiaEmptyState,
  SofiaPageHero,
  SofiaPageShell,
  SofiaSectionCard,
  SofiaStatusPill,
} from '@/components/sofia';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { SofiaCrmCustomerSummary } from '@/features/sofia/contracts';
import { useSofiaCrmCustomers } from '@/features/sofia/queries';
import { formatDateTime } from '@/lib/format';
import {
  CrmErrorState,
  PaginationControls,
  customerDisplayName,
} from './_components/crm-ui';

const PAGE_SIZE = 25;

function CustomerTags({ customer }: { customer: SofiaCrmCustomerSummary }) {
  if (customer.tags.length === 0) {
    return <span className="text-xs font-semibold text-stone-400">Sin tags</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {customer.tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex rounded-full border border-sofia-100 bg-sofia-50 px-2.5 py-1 text-[11px] font-bold text-sofia-800"
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
}

function CustomerIdentities({ customer }: { customer: SofiaCrmCustomerSummary }) {
  if (customer.identities.length === 0) {
    return <span className="text-xs font-semibold text-stone-400">Sin identidad registrada</span>;
  }

  return (
    <div className="space-y-1">
      {customer.identities.map((identity) => (
        <p key={identity.id} className="font-mono text-xs font-bold tabular-nums text-stone-700">
          {identity.valueMasked}
          {identity.isPrimary ? <span className="ml-2 font-sans text-[10px] text-stone-400">Principal</span> : null}
        </p>
      ))}
    </div>
  );
}

function CustomerMobileCard({ customer }: { customer: SofiaCrmCustomerSummary }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sofia-100 text-sofia-700">
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="break-words text-sm font-extrabold text-stone-950">
              {customerDisplayName(customer.displayName)}
            </h3>
            <div className="mt-1.5">
              <CustomerIdentities customer={customer} />
            </div>
          </div>
        </div>
        <SofiaStatusPill
          status={customer.status === 'ACTIVE' ? 'PASS' : 'NEUTRAL'}
          label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'}
          className="px-2.5"
        />
      </div>
      <div className="mt-4 border-t border-stone-100 pt-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold text-stone-500">
          <Tags className="h-3.5 w-3.5" aria-hidden="true" />
          Tags
        </div>
        <CustomerTags customer={customer} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-stone-500">
          Actualizado {formatDateTime(customer.updatedAt)}
        </p>
        <Button asChild size="sm" className="min-w-0 px-4">
          <Link href={`/sofia/customers/${encodeURIComponent(customer.id)}`}>
            Ver detalle
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function CustomersLoading() {
  return (
    <div className="space-y-3" aria-label="Cargando clientes" role="status">
      <span className="sr-only">Cargando clientes CRM.</span>
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
    </div>
  );
}

export default function SofiaCustomersPage() {
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const customers = useSofiaCrmCustomers({ q: query, page, limit: PAGE_SIZE });

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

  const data = customers.data;
  const isEmpty = data?.data.length === 0;

  return (
    <SofiaPageShell data-testid="sofia-customers-page">
      <SofiaPageHero
        eyebrow="Sofía CRM"
        title="Clientes"
        description="Directorio canónico de perfiles CRM. Las identidades se reciben y muestran siempre enmascaradas."
        statusChips={
          <>
            <SofiaStatusPill status="INFO" label="Solo lectura" />
            <SofiaStatusPill status="PASS" label="Identidades protegidas" />
          </>
        }
      />

      <SofiaSectionCard
        eyebrow="Directorio"
        title="Buscar clientes"
        description="Busca por nombre o teléfono. El backend resuelve coincidencias sin devolver el número completo."
        icon={<Search className="h-4 w-4" aria-hidden="true" />}
      >
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" role="search" onSubmit={submitSearch}>
          <div className="min-w-0 flex-1">
            <label htmlFor="customer-search" className="mb-2 block text-xs font-extrabold text-stone-700">
              Nombre o teléfono
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
                aria-hidden="true"
              />
              <Input
                id="customer-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Ej. nombre del cliente"
                className="pl-11 text-base sm:text-sm"
                maxLength={100}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="min-w-0 flex-1 px-5 sm:min-w-[8.75rem]" disabled={customers.isFetching}>
              <Search className="h-4 w-4" aria-hidden="true" />
              Buscar
            </Button>
            {query ? (
              <Button
                type="button"
                variant="secondary"
                className="min-w-0 px-4"
                onClick={clearSearch}
                aria-label="Limpiar búsqueda"
              >
                <Eraser className="h-4 w-4" aria-hidden="true" />
                <span className="sm:hidden">Limpiar</span>
              </Button>
            ) : null}
          </div>
        </form>
      </SofiaSectionCard>

      <SofiaSectionCard
        eyebrow="Resultados reales"
        title={query ? `Coincidencias para “${query}”` : 'Directorio de clientes'}
        description={
          data
            ? `${data.pagination.total.toLocaleString('es-CO')} clientes encontrados por el backend.`
            : 'Los resultados aparecerán cuando el backend responda.'
        }
        icon={<ContactRound className="h-4 w-4" aria-hidden="true" />}
        actions={
          customers.isFetching && !customers.isPending ? (
            <span className="text-xs font-bold text-sofia-700" role="status">Actualizando…</span>
          ) : null
        }
      >
        {customers.isPending ? <CustomersLoading /> : null}

        {customers.isError ? (
          <CrmErrorState
            title="No se pudo cargar el directorio CRM"
            description={
              customers.error instanceof Error
                ? customers.error.message
                : 'El backend no respondió con datos CRM válidos. No se muestran datos de respaldo.'
            }
            onRetry={() => void customers.refetch()}
          />
        ) : null}

        {!customers.isError && isEmpty ? (
          <SofiaEmptyState
            icon={query ? Search : ContactRound}
            title={query ? 'No hay coincidencias' : 'Aún no hay clientes CRM'}
            description={
              query
                ? 'Revisa el nombre o teléfono. La búsqueda no expone identidades completas.'
                : 'El backend devolvió un directorio vacío. No se crean perfiles ni métricas de ejemplo.'
            }
            action={query ? <Button type="button" variant="secondary" onClick={clearSearch}>Limpiar búsqueda</Button> : undefined}
          />
        ) : null}

        {!customers.isError && data && data.data.length > 0 ? (
          <>
            <div className="space-y-3 md:hidden">
              {data.data.map((customer) => (
                <CustomerMobileCard key={customer.id} customer={customer} />
              ))}
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-stone-200 md:block">
              <table className="w-full table-fixed text-left">
                <caption className="sr-only">Clientes CRM con identidades enmascaradas, tags y estado</caption>
                <thead className="bg-stone-50">
                  <tr className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-stone-500">
                    <th scope="col" className="w-[29%] px-5 py-3">Cliente</th>
                    <th scope="col" className="w-[21%] px-5 py-3">Identidad protegida</th>
                    <th scope="col" className="w-[25%] px-5 py-3">Tags</th>
                    <th scope="col" className="w-[13%] px-5 py-3">Estado</th>
                    <th scope="col" className="w-[12%] px-5 py-3"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 bg-white">
                  {data.data.map((customer) => (
                    <tr key={customer.id} className="transition-colors hover:bg-stone-50/80">
                      <td className="px-5 py-4 align-top">
                        <p className="break-words text-sm font-extrabold text-stone-950">
                          {customerDisplayName(customer.displayName)}
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-stone-500">
                          Actualizado {formatDateTime(customer.updatedAt)}
                        </p>
                      </td>
                      <td className="px-5 py-4 align-top"><CustomerIdentities customer={customer} /></td>
                      <td className="px-5 py-4 align-top"><CustomerTags customer={customer} /></td>
                      <td className="px-5 py-4 align-top">
                        <SofiaStatusPill
                          status={customer.status === 'ACTIVE' ? 'PASS' : 'NEUTRAL'}
                          label={customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'}
                          className="px-2.5"
                        />
                      </td>
                      <td className="px-5 py-3 text-right align-middle">
                        <Link
                          href={`/sofia/customers/${encodeURIComponent(customer.id)}`}
                          className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-extrabold text-sofia-700 transition-colors hover:bg-sofia-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sofia-100"
                          aria-label={`Ver detalle de ${customerDisplayName(customer.displayName)}`}
                        >
                          Ver
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5">
              <PaginationControls
                page={data.pagination.page}
                pages={data.pagination.pages}
                total={data.pagination.total}
                onPageChange={setPage}
                disabled={customers.isFetching}
                itemLabel="clientes"
              />
            </div>
          </>
        ) : null}

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-900">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />
          <p className="text-xs font-semibold leading-5">
            Esta superficie es de consulta. No crea campañas, mensajes, pedidos, pagos ni cambios operativos.
          </p>
        </div>
      </SofiaSectionCard>
    </SofiaPageShell>
  );
}
