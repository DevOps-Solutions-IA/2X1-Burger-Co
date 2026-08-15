import { CustomersListView } from '@/features/sofia/crm/CustomersListView';
import { WorkspaceHeader } from '@/components/sofia/workspace';

export default function SofiaCrmCustomersPage() {
  return (
    <div className="space-y-4" data-testid="sofia-crm-page">
      <WorkspaceHeader
        eyebrow="CRM Sofía"
        title="Clientes"
        description="Directorio de clientes con identidades enmascaradas, tags y consentimientos reales."
      />
      <CustomersListView />
    </div>
  );
}
