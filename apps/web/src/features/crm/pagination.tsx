'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clampCrmPage } from './pagination-model';

export function CrmPagination({
  page,
  pages,
  total,
  noun = 'registros',
  disabled = false,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  noun?: string;
  disabled?: boolean;
  onChange: (page: number) => void;
}) {
  const safePage = clampCrmPage(page, pages);
  const safePages = Math.max(pages, 1);

  return (
    <nav aria-label="Paginación CRM" aria-busy={disabled} className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted" aria-live="polite">
        {disabled ? 'Actualizando… · ' : ''}{total.toLocaleString('es-CO')} {noun} · página {safePage} de {safePages}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11"
          disabled={disabled || safePage <= 1}
          onClick={() => onChange(safePage - 1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11"
          disabled={disabled || pages === 0 || safePage >= pages}
          onClick={() => onChange(safePage + 1)}
        >
          Siguiente <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
