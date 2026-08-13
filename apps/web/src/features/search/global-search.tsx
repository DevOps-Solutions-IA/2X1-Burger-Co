'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { CommandSearch, DetailDialog, QueryState, StatusBadge } from '@/components/product';
import { Input } from '@/components/ui/input';
import { apiFetchSchema } from '@/lib/api';

const searchSchema = z.object({
  query: z.string(),
  items: z.array(z.object({
    kind: z.enum(['CUSTOMER', 'ORDER', 'PAYMENT', 'CONVERSATION', 'CASE']),
    id: z.string(),
    label: z.string(),
    context: z.string(),
    status: z.string(),
    href: z.string().startsWith('/'),
  })),
  dataPolicy: z.object({
    piiMasked: z.literal(true),
    financialHashesExcluded: z.literal(true),
    rawPayloadExcluded: z.literal(true),
  }),
});

const kindLabel = {
  CUSTOMER: 'Cliente',
  ORDER: 'Pedido',
  PAYMENT: 'Pago',
  CONVERSATION: 'Conversacion',
  CASE: 'Caso',
} as const;

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const query = useDeferredValue(input.trim());
  const results = useQuery({
    queryKey: ['global-search', query],
    queryFn: () => apiFetchSchema(`/admin/search?q=${encodeURIComponent(query)}&limit=5`, searchSchema),
    enabled: open && query.length >= 2,
    staleTime: 15_000,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <CommandSearch className="max-w-md border-white/10 bg-white/[0.06] text-stone-300 shadow-none hover:border-brand-400/60 hover:text-white" onOpen={() => setOpen(true)} />
      <DetailDialog open={open} onClose={() => setOpen(false)} title="Busqueda global" description="Consulta datos autorizados de clientes, pedidos, pagos, conversaciones y casos." mode="dialog">
        <label htmlFor="global-search-input" className="text-sm font-semibold text-ink">Buscar</label>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            id="global-search-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Cliente, pedido, pago, conversacion o caso"
            className="min-h-12 pl-10"
            autoComplete="off"
            maxLength={80}
          />
        </div>
        <div className="mt-5">
          {query.length < 2 ? (
            <QueryState status="empty" title="Escribe al menos dos caracteres" description="La busqueda respeta los permisos de tu sesion y devuelve identidades protegidas." />
          ) : (
            <QueryState
              status={results.isPending ? 'loading' : results.isError ? 'error' : results.data?.items.length ? 'ready' : 'empty'}
              title={results.isError ? 'No se pudo completar la busqueda' : 'Sin coincidencias'}
              onRetry={results.isError ? () => void results.refetch() : undefined}
              skeletonRows={4}
            >
              <ul className="divide-y divide-line rounded-2xl border border-line bg-panel">
                {results.data?.items.map((item) => (
                  <li key={`${item.kind}:${item.id}`}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex min-h-16 items-center gap-3 px-4 py-3 transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                    >
                      <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{kindLabel[item.kind]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{item.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{item.context}</span>
                      </span>
                      <StatusBadge status={item.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </QueryState>
          )}
        </div>
      </DetailDialog>
    </>
  );
}
