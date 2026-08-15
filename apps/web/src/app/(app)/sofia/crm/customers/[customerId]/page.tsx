'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useSofiaCrmCustomer } from '@/features/sofia/queries';
import { IdentityPanel } from '@/features/sofia/crm/customer-360/IdentityPanel';
import { TagsPanel } from '@/features/sofia/crm/customer-360/TagsPanel';
import { ConsentsPanel } from '@/features/sofia/crm/customer-360/ConsentsPanel';
import { ActivityTimeline } from '@/features/sofia/crm/customer-360/ActivityTimeline';
import { CasesPanel } from '@/features/sofia/crm/customer-360/CasesPanel';
import { SOFIA_CUSTOMER_360_SECTIONS, type SofiaCustomer360SectionKey } from '@/features/sofia/workspace/architecture';
import { Customer360Tabs, PhaseBoundaryNotice, QueryStateBoundary, WorkspaceHeader } from '@/components/sofia/workspace';
import { customerDisplayName } from '@/features/sofia/crm-display';

export default function SofiaCustomer360Page() {
  const params = useParams<{ customerId: string }>();
  const customerId = params?.customerId ?? '';
  const customer = useSofiaCrmCustomer(customerId);
  const [activeTab, setActiveTab] = useState<SofiaCustomer360SectionKey>('identity');

  return (
    <div className="space-y-4" data-testid="sofia-customer360-page">
      <Link href="/sofia/crm" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 hover:text-brand-900" data-testid="sofia-customer360-back">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Volver a clientes
      </Link>

      <QueryStateBoundary
        isLoading={customer.isLoading}
        isError={customer.isError}
        error={customer.error}
        data={customer.data}
        loadingLabel="Cargando cliente…"
        errorTitle="No se pudo cargar el cliente"
        data-testid="sofia-customer360"
      >
        {(data) => (
          <>
            <WorkspaceHeader eyebrow="Customer 360" title={customerDisplayName(data.displayName)} description="Vista agregada del cliente a partir de datos reales del backend." />

            <Customer360Tabs sections={SOFIA_CUSTOMER_360_SECTIONS} active={activeTab} onSelect={setActiveTab} data-testid="sofia-customer360-tabs" />

            {activeTab === 'identity' && <IdentityPanel customer={data} />}
            {activeTab === 'tags' && <TagsPanel customer={data} />}
            {activeTab === 'consents' && <ConsentsPanel customer={data} />}
            {activeTab === 'activity' && <ActivityTimeline customerId={customerId} />}
            {activeTab === 'cases' && <CasesPanel customerId={customerId} />}
            {(['conversations', 'orders', 'payments', 'deliveries', 'notes'] as const).map(
              (key) =>
                activeTab === key && (
                  <PhaseBoundaryNotice
                    key={key}
                    title={`${SOFIA_CUSTOMER_360_SECTIONS.find((s) => s.key === key)?.label} disponible en una fase posterior`}
                    description={SOFIA_CUSTOMER_360_SECTIONS.find((s) => s.key === key)?.description ?? ''}
                    pendingPhase={SOFIA_CUSTOMER_360_SECTIONS.find((s) => s.key === key)?.pendingPhase ?? ''}
                    data-testid={`sofia-customer360-${key}-boundary`}
                  />
                ),
            )}
          </>
        )}
      </QueryStateBoundary>
    </div>
  );
}
