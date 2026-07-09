import type { ReactNode } from 'react';
import { Card } from './card';
import { cn } from '@/lib/utils';

export function MetricCard({
  label,
  value,
  hint,
  icon,
  accent = 'brand',
  className,
  compact = false,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  accent?: 'brand' | 'success' | 'danger' | 'ink' | 'warning';
  className?: string;
  compact?: boolean;
}) {
  return (
    <Card className={cn(compact ? 'min-h-[6.9rem] bg-white p-3.5' : 'min-h-[8.15rem] bg-white p-4.5', className)}>
      <div className={cn('flex h-full items-start justify-between', compact ? 'gap-3' : 'gap-4')}>
        <div className={cn('flex min-h-full min-w-0 flex-1 flex-col justify-between', compact ? 'gap-2' : 'gap-3')}>
          <div>
            <p className={cn('truncate font-semibold uppercase text-stone-500', compact ? 'text-[9px] tracking-[0.12em]' : 'text-[10px] tracking-[0.16em]')}>
              {label}
            </p>
            <p
              className={cn(
                'numeric-tabular mt-1.5 min-w-0 break-words font-bold tracking-tight text-ink [font-variant-numeric:tabular-nums]',
                compact ? 'text-[0.95rem] leading-tight lg:text-[1.02rem]' : 'text-[1.08rem] leading-tight lg:text-[1.2rem]',
              )}
            >
              {value}
            </p>
          </div>
          {hint ? (
            <p className={cn('min-w-0 break-words text-stone-500', compact ? 'text-[11px] leading-4.5' : 'text-[12.5px] leading-5')}>
              {hint}
            </p>
          ) : null}
        </div>
        {icon ? (
          <div
            className={cn(
              compact
                ? 'flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-[0.95rem] border'
                : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-[1.1rem] border',
              accent === 'brand' && 'bg-brand-50 text-brand-700',
              accent === 'success' && 'border-emerald-100 bg-emerald-50 text-emerald-700',
              accent === 'warning' && 'border-amber-200 bg-amber-50 text-amber-800',
              accent === 'danger' && 'border-red-100 bg-red-50 text-red-700',
              accent === 'ink' && 'border-stone-200 bg-stone-100 text-ink',
              accent === 'brand' && 'border-brand-100 bg-brand-50 text-brand-700',
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
