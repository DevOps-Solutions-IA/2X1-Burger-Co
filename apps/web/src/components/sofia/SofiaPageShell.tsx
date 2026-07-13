'use client';

import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SofiaPageShellProps = {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
};

export function SofiaPageShell({ children, className, 'data-testid': testId }: SofiaPageShellProps) {
  return (
    <div className={cn('space-y-6 pb-10', className)} data-testid={testId}>
      {children}
    </div>
  );
}
