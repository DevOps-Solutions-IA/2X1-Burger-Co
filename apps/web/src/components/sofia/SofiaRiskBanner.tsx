'use client';

import React, { type ReactNode } from 'react';
import { type LucideIcon, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SofiaRiskBannerTone = 'blocked' | 'warning' | 'info';

const toneStyles: Record<SofiaRiskBannerTone, { shell: string; icon: string }> = {
  blocked: { shell: 'border-red-200 bg-red-50/80 text-red-900', icon: 'bg-red-100 text-red-600' },
  warning: { shell: 'border-amber-200 bg-amber-50/80 text-amber-900', icon: 'bg-amber-100 text-amber-600' },
  info: { shell: 'border-sofia-200 bg-sofia-50/80 text-sofia-900', icon: 'bg-sofia-100 text-sofia-600' },
};

export type SofiaRiskBannerProps = {
  tone?: SofiaRiskBannerTone;
  icon?: LucideIcon;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

export function SofiaRiskBanner({
  tone = 'blocked',
  icon: Icon = ShieldAlert,
  title,
  description,
  actions,
  className,
  'data-testid': testId,
}: SofiaRiskBannerProps) {
  const styles = toneStyles[tone];
  return (
    <section
      className={cn('flex items-start gap-3 rounded-xl border p-4', styles.shell, className)}
      data-testid={testId}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', styles.icon)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-extrabold">{title}</p>
        <div className="mt-1 text-xs font-semibold leading-5 opacity-90">{description}</div>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}
