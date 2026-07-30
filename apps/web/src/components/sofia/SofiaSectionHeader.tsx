'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type SofiaSectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
};

export function SofiaSectionHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
  className,
  'data-testid': testId,
}: SofiaSectionHeaderProps) {
  return (
    <div
      className={cn('flex items-start justify-between gap-4', className)}
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sofia-100 text-sofia-600">
            {icon}
          </span>
        )}
        <div>
          {eyebrow && (
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-sofia-700">
              {eyebrow}
            </p>
          )}
          <h2 className="text-lg font-extrabold tracking-tight text-stone-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm font-medium leading-relaxed text-stone-500">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
