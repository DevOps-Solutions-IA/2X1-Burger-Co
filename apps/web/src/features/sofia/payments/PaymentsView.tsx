'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PaymentIntentsTable } from './PaymentIntentsTable';
import { PaymentLinksTable } from './PaymentLinksTable';
import { PaymentTransitionsTable } from './PaymentTransitionsTable';
import { PaymentWebhooksTable } from './PaymentWebhooksTable';

type PaymentsTabId = 'intents' | 'links' | 'transitions' | 'webhooks';

const TABS: { id: PaymentsTabId; label: string }[] = [
  { id: 'intents', label: 'Intentos' },
  { id: 'links', label: 'Enlaces' },
  { id: 'transitions', label: 'Transiciones' },
  { id: 'webhooks', label: 'Webhooks' },
];

/**
 * Dashboard de solo lectura/observabilidad de Pagos. SOFIA nunca marca
 * pagos como PAID, nunca crea pagos reales ni reintenta cobros desde aquí —
 * por eso este dominio no usa `useMutation` en ningún archivo.
 */
export function PaymentsView() {
  const [tab, setTab] = useState<PaymentsTabId>('intents');

  return (
    <div className="space-y-4" data-testid="sofia-payments-view">
      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Vistas de pagos"
        data-testid="sofia-payments-tabs"
      >
        {TABS.map((item) => {
          const isActive = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(item.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                isActive
                  ? 'border-brand-500 bg-brand-500 text-ink shadow-soft'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-brand-200 hover:text-brand-700',
              )}
              data-testid={`sofia-payments-tab-${item.id}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'intents' && <PaymentIntentsTable />}
      {tab === 'links' && <PaymentLinksTable />}
      {tab === 'transitions' && <PaymentTransitionsTable />}
      {tab === 'webhooks' && <PaymentWebhooksTable />}
    </div>
  );
}
