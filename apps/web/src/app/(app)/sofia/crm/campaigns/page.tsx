import { CrmFrame, PageHeader } from '@/components/sofia';
import { CampaignsView } from '@/features/sofia/crm/campaigns/CampaignsView';

export default function SofiaCrmCampaignsPage() {
  return (
    <CrmFrame>
      <div className="space-y-4" data-testid="sofia-crm-campaigns-page">
        <PageHeader
          eyebrow="CRM SOFIA"
          title="Campañas"
          description="Campañas de WhatsApp por segmento. El envío real está siempre bloqueado por diseño: cada intento queda registrado como evidencia de auditoría, nunca despacha mensajes reales."
          data-testid="sofia-crm-campaigns-header"
        />
        <CampaignsView />
      </div>
    </CrmFrame>
  );
}
