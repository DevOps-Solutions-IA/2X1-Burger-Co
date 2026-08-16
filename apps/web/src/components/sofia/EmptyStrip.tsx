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
  variant = 'light',
  className,
  'data-testid': testId,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  variant?: 'light' | 'console';
  className?: string;
  'data-testid'?: string;
}) {
  const isConsole = variant === 'console';
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl border border-dashed px-3.5 py-3',
        isConsole ? 'border-white/12 bg-white/[0.02]' : 'border-stone-200 bg-stone-50/70',
        className,
      )}
      data-testid={testId}
    >
      <span
        className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', isConsole ? 'bg-white/[0.06] text-white/45' : 'bg-white text-stone-400')}
        aria-hidden="true"
      >
        {icon ?? <Inbox className="h-3.5 w-3.5" />}
      </span>
      <p className={cn('min-w-0 text-[12px] leading-snug', isConsole ? 'text-white/60' : 'text-stone-600')}>
        <span className={cn('font-semibold', isConsole ? 'text-white/80' : 'text-ink')}>{title}</span>
        {description ? <span> — {description}</span> : null}
      </p>
    </div>
  );
}
