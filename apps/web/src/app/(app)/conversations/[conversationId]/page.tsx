'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader, QueryState, StatusBadge } from '@/components/product';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { hasPermission } from '@/features/auth/access-control';
import { ActorBadge, ConversationDetail, PrivacyNotice } from '@/features/customer-operations/components';
import { scopeLabel, scopeTone, type TimelineActor } from '@/features/customer-operations/model';
import { useConversationDetail } from '@/features/customer-operations/queries';

const actors: TimelineActor[] = ['CUSTOMER', 'SOFIA', 'HUMAN_AGENT', 'SYSTEM_EVENT'];

export default function ConversationDetailPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params?.conversationId ?? '';
  const { user } = useAuth();
  const canRead = hasPermission(user?.permissions, 'orders.read');
  const canGovern = Boolean(
    user?.roles.some((role) => role === 'admin' || role === 'supervisor')
    && hasPermission(user?.permissions, 'orders.update'),
  );
  const detail = useConversationDetail(conversationId, canRead);
  const conversation = detail.data;

  const queryStatus = !canRead
    ? 'permission_denied'
      : detail.isPending
        ? 'loading'
      : detail.isError
        ? 'error'
        : conversation
          ? 'ready'
          : 'empty';

  return (
    <div className="space-y-6" data-testid="conversation-detail-page">
      <PageHeader
        eyebrow="Conversation operations"
        title={conversation?.customerLabel ?? 'Detalle de conversación'}
        description={conversation ? `${conversation.phoneMasked ?? 'Identidad no disponible'} · ${conversation.provider} · ${conversation.mode}` : 'Detalle operacional sanitizado.'}
        status={conversation ? <StatusBadge status={conversation.scope} label={scopeLabel(conversation.scope)} tone={scopeTone(conversation.scope)} /> : undefined}
        actions={<Button asChild variant="secondary"><Link href="/conversations"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver a la bandeja</Link></Button>}
      />

      <div className="flex flex-wrap items-center gap-2" aria-label="Actores canónicos">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Actores</span>
        {actors.map((actor) => <ActorBadge key={actor} actor={actor} />)}
      </div>

      <PrivacyNotice>
        Las acciones visibles dependen del rol, pero el backend sigue siendo la autoridad. Esta pantalla no puede enviar mensajes, marcar pagos ni crear órdenes.
      </PrivacyNotice>

      <QueryState
        status={queryStatus}
        title={detail.isError ? 'No se pudo cargar la conversación' : 'Conversación no disponible'}
        description={detail.isError ? 'El detalle sanitizado no respondió con un contrato válido.' : 'El identificador no existe o no está autorizado.'}
        onRetry={detail.isError ? () => void detail.refetch() : undefined}
        action={!conversation && !detail.isPending ? <Button asChild variant="secondary"><Link href="/conversations">Abrir bandeja</Link></Button> : undefined}
      >
        {conversation ? <ConversationDetail conversation={conversation} canGovern={canGovern} /> : null}
      </QueryState>
    </div>
  );
}
