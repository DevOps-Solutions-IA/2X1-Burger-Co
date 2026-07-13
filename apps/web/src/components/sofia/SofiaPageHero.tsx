'use client';

import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SofiaPageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  statusChips?: ReactNode;
  actions?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

export function SofiaPageHero({
  eyebrow,
  title,
  description,
  statusChips,
  actions,
  className,
  'data-testid': testId,
}: SofiaPageHeroProps) {
  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-[1.5rem] border border-sofia-200/30 p-6 text-white shadow-lg md:p-8',
        className,
      )}
      style={{
        background: 'linear-gradient(135deg, #16072F 0%, #24104A 35%, #37156F 65%, #1c1917 100%)',
      }}
      data-testid={testId}
    >
      {/* Decorative blurs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 70%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 left-1/4 h-48 w-48 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(109,61,235,0.4) 0%, transparent 60%)' }}
      />

      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-sofia-200/90">
            {eyebrow}
          </span>
          <h1 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-white md:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-sofia-100/80">
            {description}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
          {statusChips && (
            <div className="flex flex-wrap gap-1.5">{statusChips}</div>
          )}
          {actions && (
            <div className="flex flex-wrap gap-2">{actions}</div>
          )}
        </div>
      </div>
    </header>
  );
}
