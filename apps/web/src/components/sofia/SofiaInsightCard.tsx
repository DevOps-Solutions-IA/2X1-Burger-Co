'use client';

import React from 'react';
import { GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

export type InsightItem = {
  type: string;
  count: number;
  recommendation: string;
};

export type SofiaInsightCardProps = {
  insights: InsightItem[];
  feedbackCount?: number;
  emptyMessage?: string;
  className?: string;
  'data-testid'?: string;
};

export function SofiaInsightCard({
  insights,
  feedbackCount,
  emptyMessage = 'Sin recomendaciones todavía.',
  className,
  'data-testid': testId,
}: SofiaInsightCardProps) {
  const visible = insights.length > 0 ? insights : [{ type: 'SIN_INSIGHTS', count: 0, recommendation: emptyMessage }];

  return (
    <div
      className={cn(
        'rounded-[1.75rem] border border-stone-200/80 bg-white p-5 shadow-sm md:p-6',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
          <GraduationCap className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">
            Learning controlado
          </p>
          {feedbackCount !== undefined && (
            <p className="text-xs font-medium text-stone-500">
              {feedbackCount} registros de feedback
            </p>
          )}
        </div>
      </div>

      <h3 className="mt-4 text-base font-extrabold text-stone-900">
        Feedback humano e insights
      </h3>
      <p className="mt-1.5 text-xs font-medium text-stone-500">
        No entrena modelos externos, no cambia prompt ni catálogo automáticamente.
      </p>

      <div className="mt-5 space-y-2">
        {visible.slice(0, 4).map((item) => (
          <div
            key={`${item.type}-${item.count}`}
            className="rounded-xl border border-purple-100/50 bg-purple-50/20 px-4 py-3 transition-colors hover:bg-purple-50/40"
          >
            <p className="text-xs font-extrabold text-stone-800">
              {item.type} · {item.count}
            </p>
            <p className="mt-1 text-[11px] font-medium text-stone-500">
              {item.recommendation}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
