'use client';

import React from 'react';
import { Ban, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SofiaBlockerItem = {
  label: string;
  tone: 'blocked' | 'pending';
};

export type SofiaBlockerChecklistProps = {
  items: SofiaBlockerItem[];
  emptyLabel?: string;
  maxItems?: number;
  className?: string;
  'data-testid'?: string;
};

const rowStyles: Record<'blocked' | 'pending', string> = {
  blocked: 'border-red-100 bg-red-50/60 text-red-800',
  pending: 'border-amber-100 bg-amber-50/60 text-amber-800',
};

const priorityLabel: Record<'blocked' | 'pending', string> = {
  blocked: 'Alto',
  pending: 'Medio',
};

const priorityBadge: Record<'blocked' | 'pending', string> = {
  blocked: 'bg-red-600 text-white',
  pending: 'bg-amber-500 text-white',
};

export function SofiaBlockerChecklist({
  items,
  emptyLabel = 'Sin pendientes reportados por backend.',
  maxItems = 10,
  className,
  'data-testid': testId,
}: SofiaBlockerChecklistProps) {
  const visible = items.slice(0, maxItems);
  return (
    <div className={cn('grid gap-2', className)} data-testid={testId}>
      {visible.map((item) => {
        const Icon = item.tone === 'blocked' ? Ban : Clock;
        return (
          <div
            key={item.label}
            className={cn('flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-sm font-semibold', rowStyles[item.tone])}
          >
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.06em]',
                priorityBadge[item.tone],
              )}
            >
              {priorityLabel[item.tone]}
            </span>
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </div>
        );
      })}
      {visible.length === 0 && (
        <div className="rounded-2xl border border-stone-100 bg-stone-50 p-3 text-sm font-semibold text-stone-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
