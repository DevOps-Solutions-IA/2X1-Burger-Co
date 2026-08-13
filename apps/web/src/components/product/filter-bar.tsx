import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export function FilterBar({
  search,
  filters,
  actions,
  activeCount = 0,
  label = 'Filtros',
  className,
  density = 'comfortable',
}: {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  activeCount?: number;
  label?: string;
  className?: string;
  density?: 'comfortable' | 'compact';
}) {
  return (
    <section
      aria-label={label}
      className={cn('rounded-2xl border border-line bg-panel shadow-sm', density === 'compact' ? 'p-2.5 md:p-3' : 'p-3 md:p-4', className)}
    >
      <div className={cn('flex flex-col xl:flex-row xl:items-center', density === 'compact' ? 'gap-2' : 'gap-3')}>
        <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
          {search ? <div className="min-w-0 flex-1">{search}</div> : null}
          {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
        </div>
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-t border-line pt-3 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
          {activeCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {activeCount} {activeCount === 1 ? 'filtro activo' : 'filtros activos'}
            </span>
          ) : null}
          {actions}
        </div>
      </div>
    </section>
  );
}
