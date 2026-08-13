'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetchSchema } from '@/lib/api';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import {
  sofiaConversationActionResponseSchema,
  sofiaConversationsInboxSchema,
  sofiaCrmCustomerDetailSchema,
  sofiaCrmCustomersSchema,
  sofiaCrmCustomerTimelineSchema,
  sofiaOutboundCancelResponseSchema,
} from '@/features/sofia/contracts';
import { sofiaQueryKeys } from '@/features/sofia/queries';
import type { ConversationAction } from './model';

export function useCustomerDirectory(
  query: { q?: string; page: number; limit: number },
  enabled = true,
) {
  const normalizedQuery = query.q?.trim() ?? '';
  return useQuery({
    queryKey: sofiaQueryKeys.crmCustomers(normalizedQuery, query.page, query.limit),
    queryFn: () =>
      apiFetchSchema('/admin/sofia/crm/customers/search', sofiaCrmCustomersSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: normalizedQuery || undefined, page: query.page, limit: query.limit }),
      }),
    enabled,
  });
}

export function useCustomerProfile(customerId: string, enabled = true) {
  return useQuery({
    queryKey: sofiaQueryKeys.crmCustomer(customerId),
    queryFn: () =>
      apiFetchSchema(
        `/admin/sofia/crm/customers/${encodeURIComponent(customerId)}`,
        sofiaCrmCustomerDetailSchema,
      ),
    enabled: enabled && customerId.length > 0,
  });
}

export function useCustomerTimeline(
  customerId: string,
  query: { page: number; limit: number },
  enabled = true,
) {
  const searchParams = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  return useQuery({
    queryKey: sofiaQueryKeys.crmCustomerTimeline(customerId, query.page, query.limit),
    queryFn: () =>
      apiFetchSchema(
        `/admin/sofia/crm/customers/${encodeURIComponent(customerId)}/timeline?${searchParams.toString()}`,
        sofiaCrmCustomerTimelineSchema,
      ),
    enabled: enabled && customerId.length > 0,
  });
}

export function useConversationInbox(enabled = true) {
  return useQuery({
    queryKey: sofiaQueryKeys.conversationsInbox,
    queryFn: () =>
      apiFetchSchema('/admin/sofia/conversations/inbox', sofiaConversationsInboxSchema),
    enabled,
    refetchInterval: visiblePolling(POLLING_INTERVAL.critical),
  });
}

export function useConversationOperations() {
  const queryClient = useQueryClient();
  const invalidateInbox = () =>
    queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.conversationsInbox });

  const action = useMutation({
    mutationFn: ({ conversationId, action }: { conversationId: string; action: ConversationAction }) =>
      apiFetchSchema(
        `/admin/sofia/conversations/${encodeURIComponent(conversationId)}/${action}`,
        sofiaConversationActionResponseSchema,
        { method: 'POST' },
      ),
    scope: { id: 'customer-operations-conversation-write' },
    onSuccess: async () => {
      toast.success('Estado de conversación actualizado');
      await invalidateInbox();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la conversación.'),
  });

  const cancelOutbound = useMutation({
    mutationFn: ({ outboundId }: { outboundId: string }) =>
      apiFetchSchema(
        `/admin/sofia/outbound/${encodeURIComponent(outboundId)}/cancel`,
        sofiaOutboundCancelResponseSchema,
        { method: 'POST' },
      ),
    scope: { id: 'customer-operations-conversation-write' },
    onSuccess: async () => {
      toast.success('Sugerencia saliente cancelada');
      await invalidateInbox();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la sugerencia.'),
  });

  return {
    action,
    cancelOutbound,
    isPending: action.isPending || cancelOutbound.isPending,
  };
}
