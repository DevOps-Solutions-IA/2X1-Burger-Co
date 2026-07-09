'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

type PosOrderReadinessBannerProps = {
  orderIssues: string[];
  hasActiveOrder: boolean;
};

export function PosOrderReadinessBanner({
  orderIssues,
  hasActiveOrder,
}: PosOrderReadinessBannerProps) {
  if (orderIssues.length) {
    return (
      <div className="mt-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900">Hay datos pendientes antes de continuar</p>
            {orderIssues.map((issue) => (
              <p key={issue} className="text-[13px] leading-6 text-amber-900">
                {issue}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-700" />
        <p className="text-[13px] font-medium text-emerald-900">
          {hasActiveOrder ? 'Comanda lista para actualizar o cobrar.' : 'Comanda lista para abrirse.'}
        </p>
      </div>
    </div>
  );
}
