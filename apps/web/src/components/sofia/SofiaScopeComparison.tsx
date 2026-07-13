'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type SofiaScopeComparisonRow = {
  label: string;
  real: number;
  internal: number;
};

export type SofiaScopeComparisonProps = {
  rows: SofiaScopeComparisonRow[];
  realLabel?: string;
  internalLabel?: string;
  note?: string;
  className?: string;
  'data-testid'?: string;
};

function Bar({ value, max, tone }: { value: number; max: number; tone: 'real' | 'internal' }) {
  const pct = max > 0 ? Math.max(value > 0 ? 6 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          tone === 'real' ? 'bg-sofia-600' : 'bg-stone-400',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SofiaScopeComparison({
  rows,
  realLabel = 'Operación real',
  internalLabel = 'Validación interna',
  note,
  className,
  'data-testid': testId,
}: SofiaScopeComparisonProps) {
  return (
    <div className={cn('rounded-2xl border border-stone-200 bg-white p-5 shadow-sm', className)} data-testid={testId}>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">Operación real vs. validación interna</p>
        <div className="flex items-center gap-3 text-[10px] font-bold text-stone-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sofia-600" />{realLabel}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-stone-400" />{internalLabel}</span>
        </div>
      </div>

      <div className="grid gap-4">
        {rows.map((row) => {
          const max = Math.max(row.real, row.internal, 1);
          return (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between text-xs font-bold text-stone-600">
                <span>{row.label}</span>
              </div>
              <div className="grid gap-1">
                <div className="flex items-center gap-2">
                  <Bar value={row.real} max={max} tone="real" />
                  <span className="w-8 shrink-0 text-right text-xs font-extrabold text-sofia-700 tabular-nums">{row.real}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Bar value={row.internal} max={max} tone="internal" />
                  <span className="w-8 shrink-0 text-right text-xs font-extrabold text-stone-500 tabular-nums">{row.internal}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {note && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">{note}</p>}
    </div>
  );
}
