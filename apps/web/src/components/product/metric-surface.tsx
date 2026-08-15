import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function MetricSurface({
  label,
  value,
  context,
  icon,
  status,
  unavailable = false,
  className,
  density = 'comfortable',
}: {
  label: string;
  value?: ReactNode;
  context?: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  unavailable?: boolean;
  className?: string;
  density?: 'comfortable' | 'compact';
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-panel shadow-sm', density === 'compact' ? 'min-h-28 p-3' : 'min-h-36 p-4', className)} aria-label={label}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
        {icon ? <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-canvas text-brand-800" aria-hidden="true">{icon}</span> : null}
      </div>
      <div className={cn('flex items-end justify-between gap-3', density === 'compact' ? 'mt-2.5' : 'mt-4')}>
        <div className="min-w-0">
          <p className={cn('font-heading font-bold tracking-tight text-ink tabular-nums', density === 'compact' ? 'text-xl' : 'text-2xl', unavailable && 'text-muted')}>
            {unavailable ? 'No disponible' : value}
          </p>
          {context ? <div className="mt-1.5 text-sm leading-5 text-muted">{context}</div> : null}
        </div>
        {status}
      </div>
    </section>
  );
}

export function ReadinessSurface({
  title,
  description,
  state,
  details,
  action,
  className,
}: {
  title: string;
  description: string;
  state: 'ready' | 'degraded' | 'blocked' | 'unknown';
  details?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const stateLabel = {
    ready: 'Listo',
    degraded: 'Degradado',
    blocked: 'Bloqueado',
    unknown: 'Sin verificar',
  }[state];
  const stateClass = {
    ready: 'bg-signal-success',
    degraded: 'bg-signal-warning',
    blocked: 'bg-signal-danger',
    unknown: 'bg-muted',
  }[state];

  return (
    <section className={cn('rounded-2xl border border-line bg-panel p-4 shadow-sm', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 rounded-full', stateClass)} aria-hidden="true" />
            <h3 className="font-heading text-base font-semibold text-ink">{title}</h3>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-muted">{description}</p>
          {details ? <div className="mt-3 border-t border-line pt-3 text-sm text-muted">{details}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink">{stateLabel}</span>
          {action}
        </div>
      </div>
    </section>
  );
}
