'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type SofiaPillStatus =
  | 'PASS'
  | 'BLOCKED'
  | 'WARNING'
  | 'INFO'
  | 'RECEIVE_ONLY'
  | 'DRY_RUN'
  | 'HUMAN_REQUIRED'
  | 'SUGGESTED'
  | 'CONNECTED'
  | 'QR_READY'
  | 'DISCONNECTED'
  | 'NEUTRAL';

const pillStyles: Record<SofiaPillStatus, string> = {
  PASS: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  BLOCKED: 'border-red-200 bg-red-50 text-red-700',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-700',
  INFO: 'border-purple-200 bg-purple-50 text-purple-700',
  RECEIVE_ONLY: 'border-sky-200 bg-sky-50 text-sky-700',
  DRY_RUN: 'border-teal-200 bg-teal-50 text-teal-700',
  HUMAN_REQUIRED: 'border-orange-200 bg-orange-50 text-orange-700',
  SUGGESTED: 'border-violet-200 bg-violet-50 text-violet-700',
  CONNECTED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  QR_READY: 'border-purple-200 bg-purple-50 text-purple-700',
  DISCONNECTED: 'border-stone-200 bg-stone-100 text-stone-600',
  NEUTRAL: 'border-stone-200 bg-stone-100 text-stone-600',
};

const dotStyles: Record<SofiaPillStatus, string> = {
  PASS: 'bg-emerald-500',
  BLOCKED: 'bg-red-500',
  WARNING: 'bg-amber-500',
  INFO: 'bg-purple-500',
  RECEIVE_ONLY: 'bg-sky-500',
  DRY_RUN: 'bg-teal-500',
  HUMAN_REQUIRED: 'bg-orange-500',
  SUGGESTED: 'bg-violet-500',
  CONNECTED: 'bg-emerald-500',
  QR_READY: 'bg-purple-500',
  DISCONNECTED: 'bg-stone-400',
  NEUTRAL: 'bg-stone-400',
};

export type SofiaStatusPillProps = {
  status: SofiaPillStatus;
  label: string;
  withDot?: boolean;
  className?: string;
  'data-testid'?: string;
};

export function SofiaStatusPill({
  status,
  label,
  withDot = false,
  className,
  'data-testid': testId,
}: SofiaStatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-bold leading-none',
        pillStyles[status],
        className,
      )}
      data-testid={testId}
    >
      {withDot && <span className={cn('h-2 w-2 rounded-full', dotStyles[status])} />}
      {label}
    </span>
  );
}
