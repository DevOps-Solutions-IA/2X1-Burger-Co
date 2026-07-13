'use client';

import React, { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SofiaOperatorTone } from './SofiaOperatorConsole';
import { SofiaLiveStatusDot } from './SofiaLiveStatusDot';

export type SofiaLiveSignalCardProps = {
  icon: LucideIcon;
  title: string;
  tone: SofiaOperatorTone;
  statusLabel: string;
  chips?: string[];
  lastReading?: string;
  suggestedAction?: string;
  footer?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

const iconShell: Record<SofiaOperatorTone, string> = {
  safe: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  blocked: 'bg-red-100 text-red-700',
  off: 'bg-stone-100 text-stone-600',
  dryRun: 'bg-teal-100 text-teal-700',
  info: 'bg-sky-100 text-sky-700',
};

const statusText: Record<SofiaOperatorTone, string> = {
  safe: 'text-emerald-700',
  pending: 'text-amber-700',
  blocked: 'text-red-700',
  off: 'text-stone-600',
  dryRun: 'text-teal-700',
  info: 'text-sky-700',
};

export function SofiaLiveSignalCard({
  icon: Icon,
  title,
  tone,
  statusLabel,
  chips = [],
  lastReading,
  suggestedAction,
  footer,
  className,
  'data-testid': testId,
}: SofiaLiveSignalCardProps) {
  return (
    <div
      className={cn('flex flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-sm', className)}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', iconShell[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <SofiaLiveStatusDot tone={tone} pulse={tone === 'safe' || tone === 'dryRun'} />
      </div>

      <p className="mt-3 text-[11px] font-black uppercase tracking-[0.14em] text-stone-400">{title}</p>
      <p className={cn('mt-1 text-lg font-extrabold leading-tight', statusText[tone])}>{statusLabel}</p>

      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
              {chip}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3 text-[11px] font-semibold text-stone-400">
        {lastReading && <p>{lastReading}</p>}
        {suggestedAction && <p className="mt-0.5 text-stone-500">→ {suggestedAction}</p>}
      </div>

      {footer}
    </div>
  );
}
