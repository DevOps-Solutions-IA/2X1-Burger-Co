'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calendar, Fingerprint, Layers, Tags } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageHeader, QueryStateBoundary, StatusBadge, Customer360Tabs } from '@/components/sofia';
import { SOFIA_CUSTOMER_360_SECTIONS, type SofiaCustomer360SectionKey } from '@/features/sofia/navigation';
import { useSofiaCrmCustomer } from '@/features/sofia/queries';
import { customerDisplayName, customerInitials } from '@/features/sofia/crm-display';
import { formatDate } from '@/lib/format';
import { IdentityPanel } from '@/features/sofia/crm/customer-360/IdentityPanel';
import { TagsPanel } from '@/features/sofia/crm/customer-360/TagsPanel';
import { SegmentsPanel } from '@/features/sofia/crm/customer-360/SegmentsPanel';
import { ConsentsPanel } from '@/features/sofia/crm/customer-360/ConsentsPanel';
import { ActivityPanel } from '@/features/sofia/crm/customer-360/ActivityPanel';
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
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
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

            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="sofia-customer360-profile-summary">
              <div className="flex min-w-0 items-center gap-3.5">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-[18px] font-extrabold text-brand-800"
                  aria-hidden="true"
                >
                  {customerInitials(data.displayName)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-extrabold text-ink">{customerDisplayName(data.displayName)}</p>
                  <p className="mt-0.5 truncate text-[12px] text-stone-600">ID {data.id}</p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-3 text-right sm:gap-5">
                <div className="flex flex-col items-end gap-1">
                  <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-stone-500">
                    <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
                    Identidades
                  </dt>
                  <dd className="numeric-tabular text-[15px] font-bold text-ink">{data.identities.length}</dd>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-stone-500">
                    <Tags className="h-3.5 w-3.5" aria-hidden="true" />
                    Tags
                  </dt>
                  <dd className="numeric-tabular text-[15px] font-bold text-ink">{data.tags.length}</dd>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-stone-500">
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    Segmentos
                  </dt>
                  <dd className="numeric-tabular text-[15px] font-bold text-ink">{data.segments.length}</dd>
                </div>
              </dl>
              <div className="hidden shrink-0 items-center gap-1.5 text-[11px] text-stone-500 sm:flex">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                Cliente desde {formatDate(data.createdAt)}
              </div>
            </Card>

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
              {activeSection === 'activity' && <ActivityPanel customerId={customerId} />}
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
