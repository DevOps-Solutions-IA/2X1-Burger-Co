'use client';

import { useSofiaQrStatus } from '@/features/sofia/queries';
import { QrStatusCard } from '@/features/sofia/whatsapp-qr/QrStatusCard';
import { OperatorWorkspaceFrame, QueryStateBoundary, StatusBadge, WorkspaceHeader } from '@/components/sofia/workspace';

export default function SofiaWhatsappQrPage() {
  const status = useSofiaQrStatus();

  return (
    <OperatorWorkspaceFrame>
      <QueryStateBoundary
        isLoading={status.isLoading}
        isError={status.isError}
        error={status.error}
        data={status.data}
        loadingLabel="Cargando estado de vinculación WhatsApp…"
        errorTitle="No se pudo cargar el estado de WhatsApp"
        data-testid="sofia-whatsapp-qr"
      >
        {(data) => (
          <div className="space-y-4" data-testid="sofia-whatsapp-qr-page">
            <WorkspaceHeader
              eyebrow="WhatsApp QR Gateway"
              title="Vinculación receive-only"
              description="Sofía recibe y analiza mensajes de este canal. El envío real permanece bloqueado."
              statusBadges={
                <>
                  <StatusBadge tone={data.adapterReal ? 'success' : 'warning'} label={data.adapterReal ? 'Adapter real' : 'Adapter pendiente'} />
                  <StatusBadge tone="read_only" label="Receive-only" />
                  <StatusBadge tone="blocked" label="Envío real OFF" />
                </>
              }
              data-testid="sofia-qr-hero"
            />
            <QrStatusCard status={data} />
          </div>
        )}
      </QueryStateBoundary>
    </OperatorWorkspaceFrame>
  );
}
