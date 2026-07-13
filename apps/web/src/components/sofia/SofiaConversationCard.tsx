'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { SofiaConversationStateBadge, SofiaModeBadge, SofiaSafetyDecisionBadge } from './SofiaOperatorConsole';

export type SofiaConversationCardScope = 'real' | 'internal_validation' | 'sandbox' | 'historical';

export type SofiaConversationCardProps = {
  customerLabel: string;
  phoneMasked: string | null;
  phoneHash?: string | null;
  scope: SofiaConversationCardScope;
  scopeLabel: string;
  lastMessagePreview: string | null;
  operationalState: string;
  mode: string;
  recommendedAction: string;
  aiDryRun?: boolean;
  sentFalseExpected?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  'data-testid'?: string;
};

const scopeTone: Record<SofiaConversationCardScope, 'success' | 'warning' | 'info' | 'neutral'> = {
  real: 'success',
  internal_validation: 'warning',
  sandbox: 'info',
  historical: 'neutral',
};

export function SofiaConversationCard({
  customerLabel,
  phoneMasked,
  phoneHash,
  scope,
  scopeLabel,
  lastMessagePreview,
  operationalState,
  mode,
  recommendedAction,
  aiDryRun,
  sentFalseExpected,
  selected,
  onClick,
  className,
  'data-testid': testId,
}: SofiaConversationCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl border p-4 text-left transition-all duration-200',
        selected
          ? 'border-sofia-300 bg-sofia-50/40 shadow-sm ring-1 ring-sofia-200'
          : 'border-stone-200 bg-white hover:border-sofia-200 hover:shadow-sm',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-extrabold text-stone-900" title={customerLabel}>
            {customerLabel}
          </p>
          <p className="text-xs font-medium text-stone-500">
            {phoneMasked ?? 'Teléfono no disponible'}
            {phoneHash ? ` · hash ${phoneHash}` : ''}
          </p>
        </div>
        <Badge tone={scopeTone[scope]}>{scopeLabel}</Badge>
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-stone-600">
        {lastMessagePreview || 'Sin preview sanitizado'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <SofiaConversationStateBadge state={operationalState} />
        <SofiaModeBadge label={mode} tone={mode === 'receive_only' ? 'info' : 'pending'} />
        {aiDryRun ? <SofiaSafetyDecisionBadge status="DeepSeek dry-run" /> : null}
        {sentFalseExpected ? <SofiaModeBadge label="sent=false" tone="blocked" /> : null}
      </div>
      <p className="mt-3 text-xs font-bold text-stone-500">
        Acción recomendada: {recommendedAction}
      </p>
    </button>
  );
}
