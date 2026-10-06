import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Paginación única, compartida por TODA la Torre de Control y el CRM.
 * La iteración anterior reimplementó este mismo patrón ~8 veces con
 * variaciones (paginación duplicada, hallazgo MEDIUM de la revisión
 * independiente) — este componente reemplaza todas esas copias.
 * Acepta ambos contratos de paginación del backend: `{page,limit,total}`
 * (Validación/SecureCommand/Casos) y `{page,limit,total,pages}` (CRM) —
 * si `pages` no viene, se calcula a partir de `total`/`limit`.
 *
 * `variant="console"`: botones y texto claros sobre fondo oscuro, para
 * usar dentro de las páginas de la Torre de Control.
 */
export function Pager({
  page,
  limit,
  total,
  pages,
  itemsLabel,
  onPrev,
  onNext,
  variant = 'light',
  'data-testid': testId,
}: {
  page: number;
  limit: number;
  total: number;
  pages?: number;
  itemsLabel: string;
  onPrev: () => void;
  onNext: () => void;
  variant?: 'light' | 'console';
  'data-testid'?: string;
}) {
  const totalPages = pages ?? Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;
  const isConsole = variant === 'console';

  return (
    <div
      className={cn('flex items-center justify-between gap-3 border-t pt-3', isConsole ? 'border-white/10' : 'border-stone-100')}
      data-testid={testId}
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={onPrev}
        className={isConsole ? 'bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.1]' : undefined}
        data-testid={testId ? `${testId}-prev` : undefined}
      >
        Anterior
      </Button>
      <span
        className={cn(
          'numeric-tabular text-[12px] font-medium [font-variant-numeric:tabular-nums]',
          isConsole ? 'text-white/65' : 'text-stone-600',
        )}
      >
        Página {page} de {totalPages} · {total} {itemsLabel}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={onNext}
        className={isConsole ? 'bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.1]' : undefined}
        data-testid={testId ? `${testId}-next` : undefined}
      >
        Siguiente
      </Button>
    </div>
  );
}
