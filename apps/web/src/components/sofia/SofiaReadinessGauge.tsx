'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type SofiaReadinessGaugeProps = {
  passed: number;
  total: number;
  title?: string;
  subtitle?: string;
  topBlockers?: string[];
  className?: string;
  'data-testid'?: string;
};

const ringColor: Record<'safe' | 'pending' | 'blocked', string> = {
  safe: '#10b981',
  pending: '#f59e0b',
  blocked: '#ef4444',
};

const trackColor: Record<'safe' | 'pending' | 'blocked', string> = {
  safe: '#d1fae5',
  pending: '#fef3c7',
  blocked: '#fee2e2',
};

const textTone: Record<'safe' | 'pending' | 'blocked', string> = {
  safe: 'text-emerald-700',
  pending: 'text-amber-700',
  blocked: 'text-red-700',
};

export function SofiaReadinessGauge({
  passed,
  total,
  title = 'Preparación para preproducción',
  subtitle,
  topBlockers = [],
  className,
  'data-testid': testId,
}: SofiaReadinessGaugeProps) {
  const safeTotal = Math.max(total, 1);
  const pct = Math.round((passed / safeTotal) * 100);
  const severity: 'safe' | 'pending' | 'blocked' = pct >= 100 ? 'safe' : topBlockers.length > 0 ? 'blocked' : 'pending';

  const size = 128;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;

  return (
    <div
      className={cn(
        'flex flex-col gap-5 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center',
        className,
      )}
      data-testid={testId}
    >
      <div className="relative mx-auto h-32 w-32 shrink-0 sm:mx-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor[severity]} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor[severity]}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap="round"
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-2xl font-extrabold leading-none', textTone[severity])}>{passed}/{total}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">checks</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">Readiness</p>
        <h2 className="mt-1 text-lg font-black text-stone-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm font-semibold text-stone-500">{subtitle}</p>}

        {topBlockers.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topBlockers.slice(0, 4).map((item) => (
              <span
                key={item}
                className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700"
              >
                {item}
              </span>
            ))}
            {topBlockers.length > 4 && (
              <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold text-stone-500">
                +{topBlockers.length - 4} más
              </span>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm font-bold text-emerald-700">Sin bloqueadores activos.</p>
        )}
      </div>
    </div>
  );
}
