'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { customerDisplayName } from '@/features/sofia/crm-display';
import { useSofiaCrmCustomers } from '@/features/sofia/queries';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Buscador simple de clientes reales del CRM para seleccionar un `customerId`
 * al crear un lead. Nunca permite fabricar un id — siempre viene de un
 * resultado real de `useSofiaCrmCustomers`.
 */
export function CustomerPicker({
  selectedCustomerId,
  selectedCustomerLabel,
  onSelect,
  onClear,
}: {
  selectedCustomerId: string | null;
  selectedCustomerLabel: string | null;
  onSelect: (customerId: string, label: string) => void;
  onClear: () => void;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const customers = useSofiaCrmCustomers({ q: debouncedSearch, page: 1, limit: 6 });

  if (selectedCustomerId) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5"
        data-testid="sofia-crm-pipeline-customer-selected"
      >
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-ink">{selectedCustomerLabel ?? customerDisplayName(null)}</p>
          <p className="truncate text-[11px] text-stone-600">{selectedCustomerId}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-stone-200 hover:text-ink"
          aria-label="Cambiar cliente"
          data-testid="sofia-crm-pipeline-customer-clear"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Buscar cliente por nombre o identidad…"
          className="pl-9"
          data-testid="sofia-crm-pipeline-customer-search"
        />
      </div>
      {debouncedSearch.length > 0 && (
        <div className="max-h-52 overflow-y-auto rounded-2xl border border-stone-200 bg-white shadow-sm" data-testid="sofia-crm-pipeline-customer-results">
          {customers.isLoading && <p className="px-3 py-2.5 text-[12px] text-stone-600">Buscando…</p>}
          {customers.isError && <p className="px-3 py-2.5 text-[12px] text-red-700">No se pudo buscar clientes.</p>}
          {customers.data && customers.data.data.length === 0 && (
            <p className="px-3 py-2.5 text-[12px] text-stone-600">Ningún cliente coincide con la búsqueda.</p>
          )}
          {customers.data?.data.map((customer) => {
            const primaryIdentity = customer.identities.find((identity) => identity.isPrimary) ?? customer.identities[0];
            const label = customerDisplayName(customer.displayName);
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => onSelect(customer.id, label)}
                className="flex w-full items-center justify-between gap-2 border-b border-stone-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-stone-50"
                data-testid="sofia-crm-pipeline-customer-result"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{label}</p>
                  <p className="truncate text-[11px] text-stone-600">{primaryIdentity ? primaryIdentity.valueMasked : 'Sin identidad registrada'}</p>
                </div>
                <Badge tone={customer.status === 'ACTIVE' ? 'success' : 'neutral'}>{customer.status === 'ACTIVE' ? 'Activo' : 'Archivado'}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
