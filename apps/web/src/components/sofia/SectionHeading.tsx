import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const ICON_TONE_CLASS = {
  brand: 'border-brand-100 bg-brand-50 text-brand-700',
  success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-100 bg-red-50 text-red-700',
  ink: 'border-stone-200 bg-stone-100 text-ink',
} as const;

/**
 * Encabezado de sección con chip de icono, usado dentro de cada `Card` de
 * la Torre de Control para dar jerarquía visual consistente (icono +
 * título + subtítulo opcional + slot derecho para badges/acciones).
 * Complementa a `PageHeader`, que sigue siendo la única fuente de la
 * descripción de página — el `subtitle` aquí debe ser información nueva
 * de la sección, no una paráfrasis de esa descripción.
 */
export function SectionHeading({
  icon,
  title,
  subtitle,
  right,
  tone = 'brand',
  className,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  tone?: keyof typeof ICON_TONE_CLASS;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', ICON_TONE_CLASS[tone])}
          aria-hidden="true"
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold leading-tight text-ink">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11.5px] leading-5 text-stone-600">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{right}</div>}
    </div>
  );
}
