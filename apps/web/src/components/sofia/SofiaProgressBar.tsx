'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { SofiaOperatorTone } from './SofiaOperatorConsole';

export type SofiaProgressBarProps = {
  value: number;
  tone: SofiaOperatorTone;
  label?: string;
  valueLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
};

const trackColor: Record<SofiaOperatorTone, string> = {
  safe: 'bg-emerald-100',
  pending: 'bg-amber-100',
  blocked: 'bg-red-100',
  off: 'bg-stone-100',
  dryRun: 'bg-teal-100',
  info: 'bg-sky-100',
};

const fillColor: Record<SofiaOperatorTone, string> = {
  safe: 'bg-emerald-500',
  pending: 'bg-amber-500',
  blocked: 'bg-red-500',
  off: 'bg-stone-400',
  dryRun: 'bg-teal-500',
  info: 'bg-sky-500',
};

export function SofiaProgressBar({
  value,
  tone,
  label,
  valueLabel,
  size = 'md',
  className,
  'data-testid': testId,
}: SofiaProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  const height = size === 'sm' ? 'h-1.5' : 'h-2';
  return (
    <div className={cn('w-full', className)} data-testid={testId}>
      {(label || valueLabel) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-bold text-stone-500">
          {label && <span>{label}</span>}
          {valueLabel && <span className="font-extrabold text-stone-700">{valueLabel}</span>}
        </div>
      )}
      <div
        className={cn('w-full overflow-hidden rounded-full', height, trackColor[tone])}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', fillColor[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
