'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SofiaCommandCardProps = {
  href: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  className?: string;
  'data-testid'?: string;
};

export function SofiaCommandCard({
  href,
  label,
  icon: Icon,
  description,
  className,
  'data-testid': testId,
}: SofiaCommandCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center justify-between rounded-[1.25rem] border border-stone-200/80 bg-white p-4 text-sm font-bold text-stone-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-md',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-purple-600 transition-colors group-hover:bg-purple-200">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <span className="text-sm font-extrabold text-stone-800">{label}</span>
          {description && (
            <p className="text-xs font-medium text-stone-500">{description}</p>
          )}
        </div>
      </div>
      <ArrowUpRight className="h-4 w-4 text-stone-400 transition-colors group-hover:text-purple-500" />
    </Link>
  );
}
