import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Reemplazo compacto de `EmptyState` para gráficos/paneles de la Torre de
 * Control cuando el rango seleccionado no tiene actividad todavía. La
 * versión anterior (`EmptyState`, caja grande centrada con icono de 9x9)
 * repetida 5-6 veces en una misma página hacía que la Torre de Control se
 * viera "rota"/vacía en el entorno de revisión sin datos reales — esta es
 * una franja de una sola línea, sin inventar ningún dato.
 */
export function EmptyStrip({
  title,
  description,
  icon,
  className,
  'data-testid': testId,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-xl border border-dashed border-stone-200 bg-stone-50/70 px-3.5 py-3', className)} data-testid={testId}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-stone-400" aria-hidden="true">
        {icon ?? <Inbox className="h-3.5 w-3.5" />}
      </span>
      <p className="min-w-0 text-[12px] leading-snug text-stone-600">
        <span className="font-semibold text-ink">{title}</span>
        {description ? <span> — {description}</span> : null}
      </p>
    </div>
  );
}
