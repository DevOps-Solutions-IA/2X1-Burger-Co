'use client';

import { ChevronLeft, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function PaginationControls({
  page,
  pages,
  total,
  onPageChange,
  disabled = false,
  itemLabel = 'registros',
}: {
  page: number;
  pages: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  itemLabel?: string;
}) {
  const visiblePages = Math.max(pages, 1);

  return (
    <nav
      className="flex flex-col gap-3 border-t border-stone-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
      aria-label="Paginación"
    >
      <p className="text-sm font-semibold text-stone-500" aria-live="polite">
        {total.toLocaleString('es-CO')} {itemLabel} · Página {page} de {visiblePages}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1 sm:min-w-[7.25rem]"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Anterior
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1 sm:min-w-[7.25rem]"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= visiblePages || pages === 0}
        >
          Siguiente
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

export function CrmErrorState({
  title,
  description,
  onRetry,
  className,
}: {
  title: string;
  description: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-8 text-center',
        className,
      )}
      role="alert"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-700">
        <TriangleAlert className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-extrabold text-red-950">{title}</h2>
      <p className="mt-2 max-w-md text-sm font-medium leading-6 text-red-700">{description}</p>
      <Button type="button" variant="secondary" className="mt-5" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Reintentar
      </Button>
    </div>
  );
}

export function customerDisplayName(displayName: string | null) {
  return displayName?.trim() || 'Cliente sin nombre registrado';
}

export function humanizeCrmCode(value: string) {
  const normalized = value.replace(/_/g, ' ').toLocaleLowerCase('es-CO');
  return normalized.charAt(0).toLocaleUpperCase('es-CO') + normalized.slice(1);
}
