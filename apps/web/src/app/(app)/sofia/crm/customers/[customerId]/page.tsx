'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader, QueryStateBoundary, StatusBadge, Customer360Tabs } from '@/components/sofia';
import { SOFIA_CUSTOMER_360_SECTIONS, type SofiaCustomer360SectionKey } from '@/features/sofia/navigation';
import { useSofiaCrmCustomer } from '@/features/sofia/queries';
import { customerDisplayName } from '@/features/sofia/crm-display';
import { IdentityPanel } from '@/features/sofia/crm/customer-360/IdentityPanel';
import { TagsPanel } from '@/features/sofia/crm/customer-360/TagsPanel';
import { SegmentsPanel } from '@/features/sofia/crm/customer-360/SegmentsPanel';
import { ConsentsPanel } from '@/features/sofia/crm/customer-360/ConsentsPanel';
import { ActivityTimeline } from '@/features/sofia/crm/customer-360/ActivityTimeline';
import { LeadPanel } from '@/features/sofia/crm/customer-360/LeadPanel';
import { TasksPanel } from '@/features/sofia/crm/customer-360/TasksPanel';
import { NotesPanel } from '@/features/sofia/crm/customer-360/NotesPanel';
import { CasesPanel } from '@/features/sofia/crm/customer-360/CasesPanel';

export default function SofiaCustomer360Page() {
  const params = useParams<{ customerId: string }>();
  const customerId = params?.customerId ?? '';
  const [activeSection, setActiveSection] = useState<SofiaCustomer360SectionKey>('identity');

  const customer = useSofiaCrmCustomer(customerId);

  return (
    <div className="space-y-4" data-testid="sofia-customer360-page">
      <Link
        href="/sofia/crm"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-700 hover:text-brand-900"
        data-testid="sofia-customer360-back-link"
      >
        <ArrowLeft className="h-4 w-4" />
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
            <PageHeader
              eyebrow="CRM · Customer 360"
              title={customerDisplayName(data.displayName)}
              description="Vista completa del cliente en el CRM: identidad, tags, segmentos, consentimientos, actividad, pipeline, tareas, notas y casos de servicio."
              statusBadges={
                <StatusBadge tone={data.status === 'ACTIVE' ? 'success' : 'read_only'} label={data.status === 'ACTIVE' ? 'Activo' : 'Archivado'} />
              }
              data-testid="sofia-customer360-header"
            />

            <Customer360Tabs
              sections={SOFIA_CUSTOMER_360_SECTIONS}
              active={activeSection}
              onSelect={setActiveSection}
              data-testid="sofia-customer360-tabs"
            />

            <div data-testid={`sofia-customer360-panel-${activeSection}`}>
              {activeSection === 'identity' && <IdentityPanel customer={data} />}
              {activeSection === 'tags' && <TagsPanel customer={data} />}
              {activeSection === 'segments' && <SegmentsPanel customer={data} />}
              {activeSection === 'consents' && <ConsentsPanel customer={data} />}
              {activeSection === 'activity' && <ActivityTimeline customer={data} />}
              {activeSection === 'lead' && <LeadPanel customerId={customerId} />}
              {activeSection === 'tasks' && <TasksPanel customerId={customerId} />}
              {activeSection === 'notes' && <NotesPanel customerId={customerId} />}
              {activeSection === 'cases' && <CasesPanel customerId={customerId} />}
            </div>
          </>
        )}
      </QueryStateBoundary>
    </div>
  );
}
