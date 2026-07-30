import type { ReactNode } from 'react';
export function SectionTitle({
  eyebrow,
  title,
  description,
  actions,
  status,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-900">{eyebrow}</p>
          {status}
        </div>
        <h1 className="mt-2 text-[1.66rem] font-bold tracking-tight text-ink lg:text-[1.86rem]">{title}</h1>
        <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-5.5 text-stone-600 lg:text-[13.5px] lg:leading-6">
          {description}
        </p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
