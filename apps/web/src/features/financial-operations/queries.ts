'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetchSchema } from '@/lib/api';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import {
  paymentIntentPageSchema,
  paymentIntentSchema,
  paymentLinkPageSchema,
  paymentTransitionPageSchema,
  paymentWebhookPageSchema,
  type PaymentIntentStatus,
} from './contracts';

export type PaymentView = 'intents' | 'links' | 'transitions' | 'webhooks';

export const financialQueryKeys = {
  intents: (page: number, status: string) => ['payments', 'intents', page, status] as const,
  intent: (id: string | null) => ['payments', 'intent', id] as const,
  links: (page: number, status: string) => ['payments', 'links', page, status] as const,
  transitions: (page: number, status: string) => ['payments', 'transitions', page, status] as const,
  webhooks: (page: number, status: string) => ['payments', 'webhooks', page, status] as const,
};

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

export function usePaymentIntents(page: number, status: PaymentIntentStatus | '', enabled = true) {
  const query = queryString({ page, limit: 25, status });
  return useQuery({
    queryKey: financialQueryKeys.intents(page, status),
    queryFn: () => apiFetchSchema(`/admin/payments/intents?${query}`, paymentIntentPageSchema),
    enabled,
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function usePaymentIntent(id: string | null) {
  return useQuery({
    queryKey: financialQueryKeys.intent(id),
    queryFn: () => apiFetchSchema(`/admin/payments/intents/${encodeURIComponent(id!)}`, paymentIntentSchema),
    enabled: Boolean(id),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function usePaymentLinks(page: number, status: string, enabled = true) {
  const query = queryString({ page, limit: 25, status });
  return useQuery({
    queryKey: financialQueryKeys.links(page, status),
    queryFn: () => apiFetchSchema(`/admin/payments/links?${query}`, paymentLinkPageSchema),
    enabled,
    refetchInterval: visiblePolling(POLLING_INTERVAL.reference),
  });
}

export function usePaymentTransitions(page: number, status: PaymentIntentStatus | '', enabled = true) {
  const query = queryString({ page, limit: 25, toStatus: status });
  return useQuery({
    queryKey: financialQueryKeys.transitions(page, status),
    queryFn: () => apiFetchSchema(`/admin/payments/transitions?${query}`, paymentTransitionPageSchema),
    enabled,
    refetchInterval: visiblePolling(POLLING_INTERVAL.reference),
  });
}

export function usePaymentWebhooks(page: number, status: string, enabled = true) {
  const query = queryString({ page, limit: 25, processedStatus: status });
  return useQuery({
    queryKey: financialQueryKeys.webhooks(page, status),
    queryFn: () => apiFetchSchema(`/admin/payments/webhooks?${query}`, paymentWebhookPageSchema),
    enabled,
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}
