import { useQuery } from '@tanstack/react-query';
import { apiFetchSchema } from '@/lib/api';
import {
  sofiaAlertsSchema,
  sofiaConversationsInboxSchema,
  sofiaCrmCustomerDetailSchema,
  sofiaCrmCustomersSchema,
  sofiaCrmCustomerTimelineSchema,
  sofiaDashboardSummarySchema,
  sofiaGovernanceEventsSchema,
  sofiaQrStatusSchema,
  sofiaReadinessSchema,
} from './contracts';

export const sofiaQueryKeys = {
  all: ['sofia'] as const,
  dashboardSummary: ['sofia', 'dashboard-summary'] as const,
  readiness: ['sofia', 'readiness'] as const,
  governanceEvents: ['sofia', 'governance-events'] as const,
  alerts: ['sofia', 'alerts'] as const,
  qrStatus: ['sofia', 'whatsapp-qr-status'] as const,
  conversationsInbox: ['sofia', 'conversations-inbox'] as const,
  crmCustomers: (q: string, page: number, limit: number) =>
    ['sofia', 'crm', 'customers', { q, page, limit }] as const,
  crmCustomer: (customerId: string) => ['sofia', 'crm', 'customers', customerId] as const,
  crmCustomerTimeline: (customerId: string, page: number, limit: number) =>
    ['sofia', 'crm', 'customers', customerId, 'timeline', { page, limit }] as const,
};

export type SofiaCrmCustomersQuery = {
  q?: string;
  page: number;
  limit: number;
};

export type SofiaCrmTimelineQuery = {
  page: number;
  limit: number;
};

export function useSofiaDashboardSummary() {
  return useQuery({
    queryKey: sofiaQueryKeys.dashboardSummary,
    queryFn: () => apiFetchSchema('/admin/sofia/dashboard/summary', sofiaDashboardSummarySchema),
    refetchInterval: 30_000,
  });
}

export function useSofiaReadiness() {
  return useQuery({
    queryKey: sofiaQueryKeys.readiness,
    queryFn: () => apiFetchSchema('/admin/sofia/readiness', sofiaReadinessSchema),
    refetchInterval: 30_000,
  });
}

export function useSofiaGovernanceEvents() {
  return useQuery({
    queryKey: sofiaQueryKeys.governanceEvents,
    queryFn: () => apiFetchSchema('/admin/sofia/governance/events', sofiaGovernanceEventsSchema),
    refetchInterval: 30_000,
  });
}

export function useSofiaAlerts() {
  return useQuery({
    queryKey: sofiaQueryKeys.alerts,
    queryFn: () => apiFetchSchema('/admin/sofia/alerts', sofiaAlertsSchema),
    refetchInterval: 30_000,
  });
}

export function useSofiaQrStatus() {
  return useQuery({
    queryKey: sofiaQueryKeys.qrStatus,
    queryFn: () => apiFetchSchema('/admin/sofia/whatsapp/qr/status', sofiaQrStatusSchema),
    refetchInterval: 15_000,
  });
}

export function useSofiaConversationsInbox() {
  return useQuery({
    queryKey: sofiaQueryKeys.conversationsInbox,
    queryFn: () => apiFetchSchema('/admin/sofia/conversations/inbox', sofiaConversationsInboxSchema),
    refetchInterval: 15_000,
  });
}

export function useSofiaCrmCustomers(query: SofiaCrmCustomersQuery) {
  const normalizedQuery = query.q?.trim() ?? '';
  return useQuery({
    queryKey: sofiaQueryKeys.crmCustomers(normalizedQuery, query.page, query.limit),
    queryFn: () =>
      apiFetchSchema('/admin/sofia/crm/customers/search', sofiaCrmCustomersSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: normalizedQuery || undefined, page: query.page, limit: query.limit }),
      }),
  });
}

export function useSofiaCrmCustomer(customerId: string) {
  return useQuery({
    queryKey: sofiaQueryKeys.crmCustomer(customerId),
    queryFn: () =>
      apiFetchSchema(
        `/admin/sofia/crm/customers/${encodeURIComponent(customerId)}`,
        sofiaCrmCustomerDetailSchema,
      ),
    enabled: customerId.length > 0,
  });
}

export function useSofiaCrmCustomerTimeline(customerId: string, query: SofiaCrmTimelineQuery) {
  const searchParams = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  return useQuery({
    queryKey: sofiaQueryKeys.crmCustomerTimeline(customerId, query.page, query.limit),
    queryFn: () =>
      apiFetchSchema(
        `/admin/sofia/crm/customers/${encodeURIComponent(customerId)}/timeline?${searchParams.toString()}`,
        sofiaCrmCustomerTimelineSchema,
      ),
    enabled: customerId.length > 0,
  });
}
