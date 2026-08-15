import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  statusBadges,
  actions,
  className,
  'data-testid': testId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  statusBadges?: ReactNode;
  actions?: ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-[1.5rem] border border-sofia-200/60 bg-gradient-to-br from-sofia-950 via-sofia-900 to-sofia-800 px-5 py-4.5 text-white md:px-6 md:py-5',
        className,
      )}
      data-testid={testId}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.6) 0%, transparent 70%)' }}
      />
      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sofia-100">
            {eyebrow}
          </span>
          <h1 className="mt-2 text-xl font-bold leading-tight tracking-tight text-white md:text-2xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-sofia-100/85">{description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          {statusBadges && <div className="flex flex-wrap gap-1.5">{statusBadges}</div>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  );
}
