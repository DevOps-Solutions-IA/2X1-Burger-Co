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

function toSearchParams(filters: OperationalOrderFilters) {
  const params = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit) });
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.activeOnly) params.set('activeOnly', 'true');
  return params.toString();
}

export function useOperationalOrders(filters: OperationalOrderFilters) {
  return useQuery({
    queryKey: orderOperationsKeys.list(filters),
    queryFn: () =>
      apiFetchSchema(
        `/orders/operations/list?${toSearchParams(filters)}`,
        operationalOrdersPageSchema,
      ),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function useKitchenQueue(filters: OperationalOrderFilters) {
  return useQuery({
    queryKey: orderOperationsKeys.kitchen(filters),
    queryFn: () =>
      apiFetchSchema(`/orders/kitchen/queue?${toSearchParams(filters)}`, kitchenQueuePageSchema),
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
