'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { SofiaOperatorTone } from './SofiaOperatorConsole';

export type SofiaLiveStatusDotProps = {
  tone: SofiaOperatorTone;
  pulse?: boolean;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
};

const dotColor: Record<SofiaOperatorTone, string> = {
  safe: 'bg-emerald-500',
  pending: 'bg-amber-500',
  blocked: 'bg-red-500',
  off: 'bg-stone-400',
  dryRun: 'bg-teal-500',
  info: 'bg-sky-500',
};

const ringColor: Record<SofiaOperatorTone, string> = {
  safe: 'bg-emerald-400',
  pending: 'bg-amber-400',
  blocked: 'bg-red-400',
  off: 'bg-stone-300',
  dryRun: 'bg-teal-400',
  info: 'bg-sky-400',
};

export function SofiaLiveStatusDot({ tone, pulse = true, size = 'md', label, className }: SofiaLiveStatusDotProps) {
  const dim = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', dim, className)} role="status">
      {pulse && (
        <span
          className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', ringColor[tone])}
          aria-hidden="true"
        />
      )}
      <span className={cn('relative inline-flex rounded-full', dim, dotColor[tone])} aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
