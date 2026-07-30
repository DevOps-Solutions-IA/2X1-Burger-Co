'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { SofiaStatusPill, type SofiaPillStatus } from './SofiaStatusPill';

export type ReadinessItem = {
  key: string;
  label: string;
  status: 'PASS' | 'WARNING' | 'BLOCKED';
  reason: string;
  evidence?: string;
  group: 'core' | 'security' | 'whatsapp' | 'ai' | 'operations';
};

export type SofiaReadinessGridProps = {
  items: ReadinessItem[];
  overallStatus: 'PASS' | 'WARNING' | 'BLOCKED';
  overallLabel: string;
  className?: string;
  'data-testid'?: string;
};

const groupLabels: Record<ReadinessItem['group'], string> = {
  core: 'Core Sofía',
  security: 'Seguridad',
  whatsapp: 'WhatsApp / QR',
  ai: 'IA',
  operations: 'Operación protegida',
};

const groupOrder: ReadinessItem['group'][] = ['core', 'security', 'whatsapp', 'ai', 'operations'];

function toPillStatus(s: 'PASS' | 'WARNING' | 'BLOCKED'): SofiaPillStatus {
  return s;
}

export function SofiaReadinessGrid({
  items,
  overallStatus,
  overallLabel,
  className,
  'data-testid': testId,
}: SofiaReadinessGridProps) {
  const grouped = groupOrder
    .map((group) => ({
      group,
      label: groupLabels[group],
      items: items.filter((item) => item.group === group),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div
      className={cn(
        'rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm md:p-6',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-sofia-700">
            Readiness checklist
          </p>
          <h2 className="mt-1 text-lg font-extrabold text-stone-900">{overallLabel}</h2>
        </div>
        <SofiaStatusPill status={toPillStatus(overallStatus)} label={overallStatus} />
      </div>

      <div className="mt-6 space-y-5">
        {grouped.map(({ group, label, items: groupItems }) => (
          <div key={group}>
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-stone-600">
              {label}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {groupItems.map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-stone-100 bg-stone-50/70 px-4 py-3"
                  data-testid={`sofia-readiness-${item.key}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        item.status === 'PASS' && 'bg-emerald-500',
                        item.status === 'WARNING' && 'bg-amber-500',
                        item.status === 'BLOCKED' && 'bg-red-500',
                      )}
                    />
                    <p className="text-xs font-extrabold text-stone-800">{item.label}</p>
                    <SofiaStatusPill
                      status={toPillStatus(item.status)}
                      label={item.status}
                      className="ml-auto"
                    />
                  </div>
                  <p className="mt-1.5 pl-4 text-[11px] font-medium text-stone-500">
                    {item.reason}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
