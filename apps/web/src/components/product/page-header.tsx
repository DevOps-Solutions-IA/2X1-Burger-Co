import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  className?: string;
  density?: 'comfortable' | 'compact';
}

export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
  breadcrumbs,
  className,
  density = 'comfortable',
}: PageHeaderProps) {
  return (
    <header className={cn('border-b border-line', density === 'compact' ? 'pb-4' : 'pb-5 md:pb-6', className)}>
      {breadcrumbs ? <div className={cn('text-sm text-muted', density === 'compact' ? 'mb-2' : 'mb-4')}>{breadcrumbs}</div> : null}
      <div className={cn('flex flex-col lg:flex-row lg:items-end lg:justify-between', density === 'compact' ? 'gap-3' : 'gap-4')}>
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow ? (
              <p className="font-heading text-xs font-semibold uppercase tracking-[0.18em] text-brand-800">
                {eyebrow}
              </p>
            ) : null}
            {status}
          </div>
          <h1 className={cn('font-heading font-bold tracking-tight text-ink', density === 'compact' ? 'mt-1 text-xl sm:text-2xl' : 'mt-2 text-2xl sm:text-3xl')}>{title}</h1>
          {description ? (
            <p className={cn('max-w-[68ch] text-muted', density === 'compact' ? 'mt-1 text-sm leading-6' : 'mt-2 text-base leading-7')}>{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
      </div>
    </header>
  );
}
