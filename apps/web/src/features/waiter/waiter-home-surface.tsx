'use client';

import { memo } from 'react';
import Image from 'next/image';
import { LogOut, RefreshCw, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { formatCurrency } from '@/lib/format';
import type { ActiveOrder, DiningTable } from './waiter-types';

type ServiceMetrics = {
  free: number;
  inService: number;
  myTables: number;
};

type QueryState = {
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
};

type WaiterHomeSurfaceProps = {
  waiterName: string;
  shiftStartedLabel: string;
  serviceMetrics: ServiceMetrics;
  isOnline: boolean;
  pendingQueueCount: number;
  streamStatus: 'connecting' | 'open' | 'closed';
  cashState: { label: string; className: string };
  cashOpen: boolean;
  operationalDataUnavailable: boolean;
  visibleTables: DiningTable[];
  tableOrderMap: ReadonlyMap<string, ActiveOrder>;
  selectedTableId: string;
  tables: QueryState & { hasData: boolean };
  allQueriesFetching: boolean;
  onOpenComposer: (tableId: string) => void;
  onRetry: () => void;
  onLogout: () => void;
};

function WaiterHomeSurfaceComponent({
  waiterName,
  shiftStartedLabel,
  serviceMetrics,
  isOnline,
  pendingQueueCount,
  streamStatus,
  cashState,
  cashOpen,
  operationalDataUnavailable,
  visibleTables,
  tableOrderMap,
  selectedTableId,
  tables,
  allQueriesFetching,
  onOpenComposer,
  onRetry,
  onLogout,
}: WaiterHomeSurfaceProps) {
  return (
    <>
      <div className="-mx-3.5 -mt-3.5 mb-4 rounded-b-2xl bg-black px-4 py-4 sm:-mx-5 sm:-mt-5 sm:px-5 lg:-mx-6 lg:-mt-6 lg:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/brand/sidebar-logo.png" alt="2X1 Burger Co." width={40} height={40} className="h-10 w-10 rounded-xl object-contain" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-400">Servicio de mesas</p>
              <h1 className="truncate text-lg font-extrabold leading-tight text-white">{waiterName}</h1>
              <p className="mt-0.5 text-xs text-stone-300">Turno {shiftStartedLabel} · {serviceMetrics.free} mesas libres</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isOnline ? <span className="rounded-full bg-red-500/20 px-2.5 py-1 text-[11px] font-bold text-red-300">Sin red</span> : null}
            <span className={`hidden rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline-flex ${cashState.className}`}>{cashState.label}</span>
            <button type="button" onClick={onLogout} className="ml-1 flex h-11 w-11 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/30" aria-label="Cerrar sesión de mesero">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:hidden">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${cashState.className}`}>{cashState.label}</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-stone-200">
            {streamStatus === 'open' ? 'Actualización en vivo' : streamStatus === 'connecting' ? 'Reconectando' : 'Sin canal en vivo'}
          </span>
        </div>
      </div>

      {!isOnline ? <StatusBanner tone="warning" title="Trabajando sin conexión" description={pendingQueueCount ? `${pendingQueueCount} cambio(s) permanecen en cola hasta recuperar red.` : 'La última información guardada sigue visible. Los cambios seguros se sincronizarán al volver la red.'} /> : null}

      {operationalDataUnavailable ? (
        <StatusBanner tone="danger" title="Información operativa incompleta" description="No asumimos que una mesa esté libre ni que la caja esté cerrada cuando un servicio no responde. Reintenta antes de guardar." action={<Button variant="secondary" size="sm" onClick={onRetry} disabled={allQueriesFetching}><RefreshCw className={`h-4 w-4 ${allQueriesFetching ? 'animate-spin' : ''}`} />Reintentar</Button>} />
      ) : null}

      {!cashOpen && !operationalDataUnavailable ? <StatusBanner tone="warning" title="La caja esta cerrada" description="Abre caja para registrar pedidos." /> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold text-stone-600" aria-label="Resumen de mesas">
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500" />{serviceMetrics.free} libres</span>
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-amber-800"><span className="h-2 w-2 rounded-full bg-amber-500" />{serviceMetrics.inService} en servicio</span>
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-brand-50 px-3 text-brand-800"><span className="h-2 w-2 rounded-full bg-brand-500" />{serviceMetrics.myTables} mías</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy={tables.isLoading}>
        {tables.isLoading && !tables.hasData ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="min-h-[7.5rem] animate-pulse rounded-2xl border border-stone-200 bg-stone-100" aria-hidden="true" />) : null}
        {!tables.isLoading && !tables.isError && !visibleTables.length ? (
          <div className="col-span-2 rounded-2xl border border-dashed border-stone-200 bg-white p-5 text-center sm:col-span-3 lg:col-span-4">
            <UtensilsCrossed className="mx-auto h-6 w-6 text-stone-400" />
            <p className="mt-2 text-sm font-extrabold text-ink">No tienes mesas asignadas</p>
            <p className="mt-1 text-sm text-stone-500">Consulta con el administrador del turno.</p>
          </div>
        ) : null}
        {visibleTables.map((table) => {
          const activeOrder = tableOrderMap.get(table.id) ?? null;
          return (
            <button key={table.id} type="button" onClick={() => onOpenComposer(table.id)} data-testid={`waiter-table-${table.label.toLowerCase().replace(/\s+/g, '-')}`} className={`group relative flex min-h-[7.5rem] flex-col overflow-hidden rounded-2xl border text-left transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 ${table.id === selectedTableId ? 'border-brand-300 bg-brand-50/40 ring-1 ring-brand-200 shadow-sm' : 'border-stone-200 bg-white hover:border-stone-300 hover:shadow-sm'}`}>
              <div className="h-1 w-full shrink-0" style={{ backgroundColor: activeOrder ? (table.group?.color ?? '#e7e5e4') : 'transparent' }} />
              <div className="flex flex-1 flex-col items-center justify-center px-3 py-3 text-center">
                <p className="text-[1.5rem] font-black leading-none text-ink">{table.label}</p>
                <span className={`mt-1.5 inline-block rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${activeOrder ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>{activeOrder ? 'Con servicio' : 'Libre'}</span>
                {activeOrder ? <p className="mt-2 text-[17px] font-extrabold text-ink tabular-nums">{formatCurrency(activeOrder.subtotal)}</p> : null}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

export const WaiterHomeSurface = memo(WaiterHomeSurfaceComponent);
