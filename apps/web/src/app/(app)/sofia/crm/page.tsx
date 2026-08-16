'use client';

import { CrmFrame, PageHeader } from '@/components/sofia';
import { CustomersListView } from '@/features/sofia/crm/CustomersListView';

export default function SofiaCrmCustomersPage() {
  return (
    <CrmFrame>
      <div className="space-y-4" data-testid="sofia-crm-customers-page">
        <PageHeader
          eyebrow="CRM"
          title="Clientes"
          description="Directorio de clientes del CRM: identidad enmascarada, estado, tags y acceso al Customer 360 de cada cliente."
          data-testid="sofia-crm-customers-header"
        />
        <CustomersListView />
      </div>
    </CrmFrame>
  );
}
