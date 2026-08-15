'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchSchema, subscribeOperationalStream } from '@/lib/api';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import {
  kitchenQueuePageSchema,
  operationalOrdersPageSchema,
  orderDetailSchema,
  type KitchenAction,
  type OrderStatus,
  type OrderType,
} from './contracts';

export interface OperationalOrderFilters {
  page: number;
  limit: number;
  q?: string;
  status?: OrderStatus;
  type?: OrderType;
  activeOnly?: boolean;
}

export const orderOperationsKeys = {
  all: ['order-operations'] as const,
  lists: () => ['order-operations', 'list'] as const,
  list: (filters: OperationalOrderFilters) => ['order-operations', 'list', filters] as const,
  kitchen: (filters: OperationalOrderFilters) => ['order-operations', 'kitchen', filters] as const,
  detail: (id: string) => ['order-operations', 'detail', id] as const,
};

export function operationalSearchBody(filters: OperationalOrderFilters) {
  return {
    page: filters.page,
    limit: filters.limit,
    ...(filters.q?.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.activeOnly ? { activeOnly: 'true' } : {}),
  };
}

export function useOperationalOrders(filters: OperationalOrderFilters) {
  return useQuery({
    queryKey: orderOperationsKeys.list(filters),
    queryFn: () =>
      apiFetchSchema(
        '/orders/operations/list',
        operationalOrdersPageSchema,
        { method: 'POST', body: JSON.stringify(operationalSearchBody(filters)) },
      ),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function useKitchenQueue(filters: OperationalOrderFilters) {
  return useQuery({
    queryKey: orderOperationsKeys.kitchen(filters),
    queryFn: () => apiFetchSchema('/orders/kitchen/queue', kitchenQueuePageSchema, {
      method: 'POST',
      body: JSON.stringify(operationalSearchBody(filters)),
    }),
    refetchInterval: visiblePolling(POLLING_INTERVAL.critical),
  });
}

export function useOrderDetail(id: string) {
  return useQuery({
    queryKey: orderOperationsKeys.detail(id),
    queryFn: () => apiFetchSchema(`/orders/${encodeURIComponent(id)}`, orderDetailSchema),
    enabled: id.length > 0,
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function useKitchenTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, expectedRevision }: { id: string; action: KitchenAction; expectedRevision: number }) =>
      apiFetchSchema(`/orders/${encodeURIComponent(id)}/kitchen-transition`, orderDetailSchema, {
        method: 'POST',
        body: JSON.stringify({ action, expectedRevision }),
      }),
    onSuccess: (order) => {
      queryClient.setQueryData(orderOperationsKeys.detail(order.id), order);
      void queryClient.invalidateQueries({ queryKey: orderOperationsKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: ['order-operations', 'kitchen'] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: orderOperationsKeys.all });
    },
  });
}

export function useOrderOperationsRealtime() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      subscribeOperationalStream((event) => {
        if (event.scope !== 'orders' && event.scope !== 'all' && event.type !== 'order.updated') return;
        void queryClient.invalidateQueries({ queryKey: orderOperationsKeys.lists() });
        void queryClient.invalidateQueries({ queryKey: ['order-operations', 'kitchen'] });
        if (event.entityId) {
          void queryClient.invalidateQueries({ queryKey: orderOperationsKeys.detail(event.entityId) });
        }
      }),
    [queryClient],
  );
}
