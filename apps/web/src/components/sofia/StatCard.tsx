import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CONSOLE_ACCENT_ICON_CLASS, CONSOLE_CARD_CLASS } from './console-theme';

const ACCENT_CLASS = {
  brand: 'border-brand-100 bg-brand-50 text-brand-700',
  success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-100 bg-red-50 text-red-700',
  ink: 'border-stone-200 bg-stone-100 text-ink',
} as const;

const ACCENT_BAR_CLASS = {
  brand: 'bg-brand-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  ink: 'bg-white/25',
} as const;

/**
 * Tarjeta de KPI para la Torre de Control/CRM. Variante de `MetricCard`
 * (mismos tokens de marca) que NUNCA trunca la etiqueta con ellipsis —
 * las etiquetas en español pueden ser largas ("Productos desconocidos")
 * y truncarlas se leyó como un bug visual real en la iteración anterior.
 * En vez de truncar, la etiqueta envuelve hasta 2 líneas.
 *
 * `variant="console"`: tarjeta oscura con barra de acento lateral y chip
 * de icono con halo — usada solo dentro del shell de la Torre de Control.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = 'brand',
  variant = 'light',
  className,
  'data-testid': testId,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  accent?: keyof typeof ACCENT_CLASS;
  variant?: 'light' | 'console';
  className?: string;
  'data-testid'?: string;
}) {
  const isConsole = variant === 'console';

  if (isConsole) {
    return (
      <div className={cn(CONSOLE_CARD_CLASS, 'relative overflow-hidden p-0', className)} data-testid={testId}>
        <div className={cn('absolute inset-y-0 left-0 w-1', ACCENT_BAR_CLASS[accent])} aria-hidden="true" />
        <div className="flex h-full items-start justify-between gap-3 p-4.5 pl-5.5 md:p-5 md:pl-6">
          <div className="flex min-h-full min-w-0 flex-1 flex-col justify-between gap-2">
            <div>
              <p className="line-clamp-2 text-[10px] font-bold uppercase leading-[1.35] tracking-[0.09em] text-white/55">{label}</p>
              <p className="numeric-tabular mt-1.5 break-words text-[1.55rem] font-bold leading-tight tracking-tight text-white [font-variant-numeric:tabular-nums]">
                {value}
              </p>
            </div>
            {hint && <p className="break-words text-[11.5px] leading-snug text-white/60">{hint}</p>}
          </div>
          {icon && (
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', CONSOLE_ACCENT_ICON_CLASS[accent])} aria-hidden="true">
              {icon}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className={cn('min-h-[6.75rem] bg-white p-4', className)} data-testid={testId}>
      <div className="flex h-full items-start justify-between gap-3">
        <div className="flex min-h-full min-w-0 flex-1 flex-col justify-between gap-2">
          <div>
            <p className="line-clamp-2 text-[10px] font-bold uppercase leading-[1.35] tracking-[0.09em] text-stone-600">{label}</p>
            <p className="numeric-tabular mt-1.5 break-words text-[1.28rem] font-bold leading-tight tracking-tight text-ink [font-variant-numeric:tabular-nums]">
              {value}
            </p>
          </div>
          {hint && <p className="break-words text-[11.5px] leading-snug text-stone-600">{hint}</p>}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
              ACCENT_CLASS[accent],
            )}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
