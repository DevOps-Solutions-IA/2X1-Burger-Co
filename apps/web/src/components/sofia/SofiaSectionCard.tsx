'use client';

import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SofiaSectionHeader } from './SofiaSectionHeader';

export type SofiaSectionCardProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  'data-testid'?: string;
};

export function SofiaSectionCard({
  eyebrow,
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  'data-testid': testId,
}: SofiaSectionCardProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm md:p-6',
        className,
      )}
      data-testid={testId}
    >
      {title && (
        <SofiaSectionHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          icon={icon}
          actions={actions}
        />
      )}
      <div className={cn(title ? 'mt-5' : undefined, bodyClassName)}>{children}</div>
    </section>
  );
}
