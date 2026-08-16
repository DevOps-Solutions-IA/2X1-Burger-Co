import { Button } from '@/components/ui/button';

/**
 * Paginación única, compartida por TODA la Torre de Control y el CRM.
 * La iteración anterior reimplementó este mismo patrón ~8 veces con
 * variaciones (paginación duplicada, hallazgo MEDIUM de la revisión
 * independiente) — este componente reemplaza todas esas copias.
 * Acepta ambos contratos de paginación del backend: `{page,limit,total}`
 * (Validación/SecureCommand/Casos) y `{page,limit,total,pages}` (CRM) —
 * si `pages` no viene, se calcula a partir de `total`/`limit`.
 */
export function Pager({
  page,
  limit,
  total,
  pages,
  itemsLabel,
  onPrev,
  onNext,
  'data-testid': testId,
}: {
  page: number;
  limit: number;
  total: number;
  pages?: number;
  itemsLabel: string;
  onPrev: () => void;
  onNext: () => void;
  'data-testid'?: string;
}) {
  const totalPages = pages ?? Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-3" data-testid={testId}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev} data-testid={testId ? `${testId}-prev` : undefined}>
        Anterior
      </Button>
      <span className="numeric-tabular text-[12px] font-medium text-stone-600 [font-variant-numeric:tabular-nums]">
        Página {page} de {totalPages} · {total} {itemsLabel}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={onNext} data-testid={testId ? `${testId}-next` : undefined}>
        Siguiente
      </Button>
    </div>
  );
}
