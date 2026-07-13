'use client';

import React from 'react';
import { type LucideIcon, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SofiaEmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
};

export function SofiaEmptyState({
  icon: Icon = Sparkles,
  title,
  description,
  action,
  className,
  'data-testid': testId,
}: SofiaEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-sofia-200 bg-sofia-50/30 p-10 text-center',
        className,
      )}
      data-testid={testId}
    >
      <Icon className="mb-4 h-10 w-10 text-sofia-300" />
      <p className="text-base font-extrabold text-stone-700">{title}</p>
      {description && (
        <p className="mt-2 max-w-sm text-sm font-medium text-stone-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
