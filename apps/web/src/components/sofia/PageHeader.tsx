import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Marca de identidad puntual del agente SOFIA — único uso legítimo del acento violeta `sofia-*`. */
function SofiaModuleTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sofia-200 bg-sofia-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sofia-700">
      SOFIA
    </span>
  );
}

export function PageHeader({
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
        'flex flex-col gap-3 rounded-[1.45rem] border border-stone-200/90 bg-white p-4.5 shadow-soft md:p-5 lg:flex-row lg:items-end lg:justify-between',
        className,
      )}
      data-testid={testId}
    >
      <div className="min-w-0 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-900">{eyebrow}</p>
          <SofiaModuleTag />
        </div>
        <h1 className="mt-2 text-[1.66rem] font-bold tracking-tight text-ink lg:text-[1.86rem]">{title}</h1>
        <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-5.5 text-stone-600 lg:text-[13.5px] lg:leading-6">{description}</p>
        {statusBadges && <div className="mt-3 flex flex-wrap gap-1.5">{statusBadges}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}
