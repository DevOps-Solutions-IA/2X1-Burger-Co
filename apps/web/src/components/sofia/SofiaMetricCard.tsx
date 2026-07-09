'use client';

import React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SofiaMetricTone = 'default' | 'purple' | 'emerald' | 'amber' | 'red' | 'sky';

const iconBgStyles: Record<SofiaMetricTone, string> = {
  default: 'bg-stone-100 text-stone-600',
  purple: 'bg-purple-100 text-purple-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  amber: 'bg-amber-100 text-amber-600',
  red: 'bg-red-100 text-red-600',
  sky: 'bg-sky-100 text-sky-600',
};

const valueColorStyles: Record<SofiaMetricTone, string> = {
  default: 'text-stone-900',
  purple: 'text-purple-800',
  emerald: 'text-emerald-800',
  amber: 'text-amber-800',
  red: 'text-red-800',
  sky: 'text-sky-800',
};

export type SofiaMetricCardProps = {
  title: string;
  value: string | number;
  label: string;
  icon: LucideIcon;
  tone?: SofiaMetricTone;
  className?: string;
  'data-testid'?: string;
};

export function SofiaMetricCard({
  title,
  value,
  label,
  icon: Icon,
  tone = 'default',
  className,
  'data-testid': testId,
}: SofiaMetricCardProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col rounded-[1.5rem] border border-stone-200/80 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.10em] text-stone-400">
          {title}
        </span>
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', iconBgStyles[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={cn('mt-4 text-[2rem] font-extrabold leading-none tracking-tight', valueColorStyles[tone])}>
        {value}
      </p>
      <p className="mt-2 text-xs font-semibold text-stone-500">{label}</p>
    </div>
  );
}
