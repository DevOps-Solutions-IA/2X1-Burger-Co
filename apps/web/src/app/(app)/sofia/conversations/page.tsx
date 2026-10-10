'use client';

import { ControlTowerFrame, PageHeader, QueryStateBoundary, StatusBadge } from '@/components/sofia';
import { useSofiaConversationsInbox } from '@/features/sofia/queries';
import { ConversationsInboxView } from '@/features/sofia/conversations/ConversationsInboxView';
import { formatDateTime, formatNumber } from '@/lib/format';

export default function SofiaConversationsPage() {
  const inbox = useSofiaConversationsInbox();

  return (
    <ControlTowerFrame>
      <div className="space-y-4" data-testid="sofia-conversations-page">
        <PageHeader
          eyebrow="Torre de Control"
          title="Conversaciones"
          description="Bandeja de solo lectura de conversaciones reales, de validación interna, sandbox e históricas. SOFIA opera en modo receive-only: esta vista no envía ni modifica mensajes."
          statusBadges={
            inbox.data ? (
              <>
                <StatusBadge tone="read_only" label={`Total: ${formatNumber(inbox.data.summary.totalConversations)}`} />
                <StatusBadge
                  tone={inbox.data.summary.pendingReview > 0 ? 'warning' : 'success'}
                  label={`Pendientes de revisión: ${formatNumber(inbox.data.summary.pendingReview)}`}
                />
                <StatusBadge tone="read_only" label="Solo lectura" />
              </>
            ) : undefined
          }
          actions={
            inbox.data ? <span className="text-[11px] text-stone-600">Actualizado: {formatDateTime(inbox.data.generatedAt)}</span> : undefined
          }
          data-testid="sofia-conversations-header"
        />

        <QueryStateBoundary
          isLoading={inbox.isLoading}
          isError={inbox.isError}
          error={inbox.error}
          data={inbox.data}
          loadingLabel="Cargando bandeja de conversaciones…"
          errorTitle="No se pudo cargar la bandeja de conversaciones"
          data-testid="sofia-conversations-boundary"
        >
          {(data) => <ConversationsInboxView inbox={data} />}
        </QueryStateBoundary>
      </div>
    </ControlTowerFrame>
  );
}
