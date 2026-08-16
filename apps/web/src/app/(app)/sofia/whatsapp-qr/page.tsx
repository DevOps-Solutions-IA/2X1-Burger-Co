'use client';

import { ControlTowerFrame, PageHeader, QueryStateBoundary, StatusBadge } from '@/components/sofia';
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
          description="Estado del canal WhatsApp QR: conectado, esperando escaneo o desconectado. SOFIA recibe y analiza mensajes de este canal; el envío real permanece bloqueado en todo el sistema."
          variant="console"
          statusBadges={
            status.data ? (
              <>
                <StatusBadge tone={status.data.connected ? 'success' : 'blocked'} label={status.data.connected ? 'Canal conectado' : 'Canal no conectado'} variant="console" />
                <StatusBadge tone="read_only" label="Receive-only" variant="console" />
              </>
            ) : undefined
          }
          data-testid="sofia-whatsapp-qr-header"
        />

        <QueryStateBoundary
          isLoading={status.isLoading}
          isError={status.isError}
          error={status.error}
          data={status.data}
          loadingLabel="Cargando estado de vinculación de WhatsApp…"
          errorTitle="No se pudo cargar el estado del canal"
          variant="console"
          data-testid="sofia-whatsapp-qr"
        >
          {(data) => <QrStatusCard status={data} />}
        </QueryStateBoundary>
      </div>
    </ControlTowerFrame>
  );
}
