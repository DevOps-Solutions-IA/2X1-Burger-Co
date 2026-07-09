'use client';

import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SofiaStatusPill, type SofiaPillStatus } from './SofiaStatusPill';

export type SecurityRow = {
  label: string;
  value: string;
  status: SofiaPillStatus;
  detail?: string;
};

export type SofiaSecurityPanelProps = {
  title?: string;
  rows: SecurityRow[];
  blockers?: string[];
  className?: string;
  'data-testid'?: string;
};

export function SofiaSecurityPanel({
  title = 'Seguridad',
  rows,
  blockers,
  className,
  'data-testid': testId,
}: SofiaSecurityPanelProps) {
  return (
    <div
      className={cn(
        'rounded-[1.75rem] border border-stone-200/80 bg-white p-5 shadow-sm md:p-6',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-100 text-red-600">
          <LockKeyhole className="h-4 w-4" />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">
          {title}
        </p>
      </div>

      <div className="mt-5 space-y-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-stone-50"
          >
            <div>
              <p className="text-sm font-bold text-stone-700">{row.label}</p>
              {row.detail && (
                <p className="mt-0.5 text-xs font-medium text-stone-500">{row.detail}</p>
              )}
            </div>
            <SofiaStatusPill status={row.status} label={row.value} />
          </div>
        ))}
      </div>

      {blockers && blockers.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5" data-testid={`${testId}-blockers`}>
          {blockers.map((blocker) => (
            <span
              key={blocker}
              className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-extrabold text-red-700"
            >
              {blocker}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
