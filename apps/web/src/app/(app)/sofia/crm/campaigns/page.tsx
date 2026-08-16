import { CrmFrame, PageHeader } from '@/components/sofia';
import { CampaignsView } from '@/features/sofia/crm/campaigns/CampaignsView';

export default function SofiaCrmCampaignsPage() {
  return (
    <CrmFrame>
      <div className="space-y-4" data-testid="sofia-crm-campaigns-page">
        <PageHeader
          eyebrow="CRM"
          title="Campañas"
          description="Campañas de WhatsApp por segmento, con conteo de entregas y registro auditable de cada intento de envío. El envío real permanece siempre bloqueado por diseño."
          data-testid="sofia-crm-campaigns-header"
        />
        <CampaignsView />
      </div>
    </CrmFrame>
  );
}
