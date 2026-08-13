import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  id: string;
  title: string;
  timestamp: string;
  description?: ReactNode;
  metadata?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

const markerTone = {
  neutral: 'border-line bg-panel text-muted',
  success: 'border-signal-success/30 bg-signal-success/10 text-signal-success',
  warning: 'border-signal-warning/30 bg-signal-warning/10 text-signal-warning',
  danger: 'border-signal-danger/30 bg-signal-danger/10 text-signal-danger',
  info: 'border-signal-info/30 bg-signal-info/10 text-signal-info',
};

export function Timeline({ items, label = 'Historial', className, density = 'comfortable' }: { items: readonly TimelineItem[]; label?: string; className?: string; density?: 'comfortable' | 'compact' }) {
  return (
    <ol aria-label={label} className={cn('space-y-0', className)}>
      {items.map((item, index) => (
        <li key={item.id} className={cn('relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 last:pb-0', density === 'compact' ? 'pb-3' : 'pb-6')}>
          {index < items.length - 1 ? <span className="absolute bottom-0 left-[1.34rem] top-11 w-px bg-line" aria-hidden="true" /> : null}
          <span
            className={cn(
              'relative z-10 flex h-11 w-11 items-center justify-center rounded-full border',
              markerTone[item.tone ?? 'neutral'],
            )}
            aria-hidden="true"
          >
            {item.icon ?? <span className="h-2 w-2 rounded-full bg-current" />}
          </span>
          <article className="min-w-0 pt-0.5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <h3 className="text-sm font-semibold leading-6 text-ink">{item.title}</h3>
              <time className="shrink-0 text-xs tabular-nums text-muted">{item.timestamp}</time>
            </div>
            {item.description ? <div className="mt-1 text-sm leading-6 text-muted">{item.description}</div> : null}
            {item.metadata ? <div className="mt-2">{item.metadata}</div> : null}
          </article>
        </li>
      ))}
    </ol>
  );
}
