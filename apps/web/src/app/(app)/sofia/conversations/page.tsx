'use client';

import { useMemo, useState } from 'react';
import { useSofiaConversationsInbox } from '@/features/sofia/queries';
import type { SofiaConversationsInbox } from '@/features/sofia/contracts';
import { ConversationListPanel } from '@/features/sofia/conversations/ConversationListPanel';
import { ConversationDetailPanel } from '@/features/sofia/conversations/ConversationDetailPanel';
import { OperatorWorkspaceFrame, QueryStateBoundary, StatusBadge, WorkspaceHeader } from '@/components/sofia/workspace';

export default function SofiaConversationsPage() {
  const inbox = useSofiaConversationsInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <OperatorWorkspaceFrame>
      <QueryStateBoundary
        isLoading={inbox.isLoading}
        isError={inbox.isError}
        error={inbox.error}
        data={inbox.data}
        loadingLabel="Cargando conversaciones…"
        errorTitle="No se pudo cargar la bandeja de conversaciones"
        data-testid="sofia-conversations"
      >
        {(data) => <ConversationsView data={data} selectedId={selectedId} onSelect={setSelectedId} />}
      </QueryStateBoundary>
    </OperatorWorkspaceFrame>
  );
}

function ConversationsView({
  data,
  selectedId,
  onSelect,
}: {
  data: SofiaConversationsInbox;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const allConversations = useMemo(
    () => [...data.real.conversations, ...data.internalValidation.conversations, ...data.sandbox.conversations, ...data.historical.conversations],
    [data],
  );
  const selected = allConversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4" data-testid="sofia-conversations-page">
      <WorkspaceHeader
        eyebrow="Sofía Conversations"
        title="Inbox receive-only con supervisión humana"
        description="Sofía sugiere; el operador decide. Esta fase es de solo lectura — pausar, tomar o liberar conversaciones llega en Fase F."
        statusBadges={
          <>
            <StatusBadge tone="read_only" label="Receive-only" />
            <StatusBadge tone={data.security.autoReplyEnabled ? 'warning' : 'blocked'} label={data.security.autoReplyEnabled ? 'Auto reply activo' : 'Auto reply OFF'} />
            <StatusBadge tone="blocked" label="Envío real OFF" />
          </>
        }
        data-testid="sofia-conversations-hero"
      />

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.4fr]">
        <ConversationListPanel inbox={data} selectedId={selectedId} onSelect={onSelect} data-testid="sofia-conversation-list" />
        <ConversationDetailPanel conversation={selected} data-testid="sofia-conversation-detail" />
      </div>
    </div>
  );
}
