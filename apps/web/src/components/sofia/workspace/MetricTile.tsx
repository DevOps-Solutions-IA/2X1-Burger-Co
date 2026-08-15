import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONE_ICON_CLASS = {
  neutral: 'bg-stone-100 text-stone-600',
  sofia: 'bg-sofia-100 text-sofia-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  success: 'bg-emerald-100 text-emerald-700',
} as const;

/** Tile de una métrica real proveniente del backend. Nunca recibe valores fabricados. */
export function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
  className,
  'data-testid': testId,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONE_ICON_CLASS;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div
      className={cn('rounded-[1.15rem] border border-stone-200/80 bg-white p-3.5', className)}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-stone-600">{label}</span>
        {Icon && (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.65rem]', TONE_ICON_CLASS[tone])}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="mt-2 text-[1.55rem] font-bold leading-none tracking-tight text-ink">{value}</p>
      {detail && <p className="mt-1.5 text-[11.5px] font-medium leading-snug text-stone-500">{detail}</p>}
    </div>
  );
}
