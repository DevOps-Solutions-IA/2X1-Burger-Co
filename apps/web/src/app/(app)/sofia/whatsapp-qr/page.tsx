'use client';

import { ControlTowerFrame, PageHeader, QueryStateBoundary } from '@/components/sofia';
import { useSofiaQrStatus } from '@/features/sofia/queries';
import { QrStatusCard } from '@/features/sofia/whatsapp-qr/QrStatusCard';

export default function SofiaWhatsappQrPage() {
  const status = useSofiaQrStatus();

  return (
    <ControlTowerFrame>
      <div className="space-y-4" data-testid="sofia-whatsapp-qr-page">
        <PageHeader
          eyebrow="Canal WhatsApp"
          title="Vinculación QR — receive-only"
          description="SOFIA recibe y analiza mensajes de este canal. El envío real de WhatsApp permanece bloqueado en todo el sistema."
          data-testid="sofia-whatsapp-qr-header"
        />

        <QueryStateBoundary
          isLoading={status.isLoading}
          isError={status.isError}
          error={status.error}
          data={status.data}
          loadingLabel="Cargando estado de vinculación de WhatsApp…"
          errorTitle="No se pudo cargar el estado del canal"
          data-testid="sofia-whatsapp-qr"
        >
          {(data) => <QrStatusCard status={data} />}
        </QueryStateBoundary>
      </div>
    </ControlTowerFrame>
  );
}
