'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SofiaPillStatus } from './SofiaStatusPill';

export type TimelineEvent = {
  type: string;
  status: string;
  detail: string;
  createdAt: string;
  pillStatus?: SofiaPillStatus;
};

export type SofiaTimelineProps = {
  events: TimelineEvent[];
  maxItems?: number;
  emptyMessage?: string;
  className?: string;
  'data-testid'?: string;
};

function formatTime(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

export function SofiaTimeline({
  events,
  maxItems = 6,
  emptyMessage = 'Sin eventos recientes',
  className,
  'data-testid': testId,
}: SofiaTimelineProps) {
  const visible = events.slice(0, maxItems);
  const hasEvents = visible.length > 0;

  return (
    <div
      className={cn(
        'rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm md:p-6',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sofia-100 text-sofia-600">
          <Clock className="h-4 w-4" />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">
          Últimos eventos
        </p>
      </div>

      <div className="mt-5 space-y-2">
        {hasEvents ? (
          visible.map((event, index) => (
            <div
              key={`${event.type}-${event.createdAt}-${index}`}
              className="flex flex-col gap-1 rounded-xl border border-sofia-100/50 bg-sofia-50/20 px-4 py-3 transition-colors hover:bg-sofia-50/40 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-extrabold text-stone-800">
                    {event.type}
                  </p>
                  <span className="text-[11px] font-bold text-stone-400">·</span>
                  <p className="text-xs font-bold text-stone-500">{event.status}</p>
                </div>
                <p className="mt-0.5 truncate text-xs font-medium text-stone-500">
                  {event.detail}
                </p>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-stone-400">
                {formatTime(event.createdAt)}
              </span>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Clock className="mb-3 h-8 w-8 text-stone-300" />
            <p className="text-sm font-medium text-stone-500">{emptyMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
