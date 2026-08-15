import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchSchema } from '@/lib/api';
import {
  sofiaAdminPaymentIntentsSchema,
  sofiaAdminPaymentLinksSchema,
  sofiaAdminPaymentTransitionsSchema,
  sofiaAdminPaymentWebhooksSchema,
  sofiaAlertsSchema,
  sofiaConversationsInboxSchema,
  sofiaCrmCustomerDetailSchema,
  sofiaCrmCustomersSchema,
  sofiaCrmCustomerTimelineSchema,
  sofiaCustomerServiceCaseDetailSchema,
  sofiaCustomerServiceCasesSchema,
  sofiaCustomerServiceTransitionResultSchema,
  sofiaDashboardSummarySchema,
  sofiaGovernanceActionResponseSchema,
  sofiaGovernanceEventsSchema,
  sofiaGovernanceMetricsSchema,
  sofiaGovernanceStatusSchema,
  sofiaQrStatusSchema,
  sofiaReadinessSchema,
  sofiaRuntimeSafetySchema,
  sofiaSecurityStatusSchema,
} from './contracts';

export const sofiaQueryKeys = {
  all: ['sofia'] as const,
  dashboardSummary: ['sofia', 'dashboard-summary'] as const,
  readiness: ['sofia', 'readiness'] as const,
  governanceEvents: ['sofia', 'governance-events'] as const,
  alerts: ['sofia', 'alerts'] as const,
  qrStatus: ['sofia', 'whatsapp-qr-status'] as const,
  conversationsInbox: ['sofia', 'conversations-inbox'] as const,
  governanceStatus: ['sofia', 'governance-status'] as const,
  governanceMetrics: ['sofia', 'governance-metrics'] as const,
  securityStatus: ['sofia', 'security-status'] as const,
  runtimeSafety: ['sofia', 'runtime-safety'] as const,
  paymentIntents: (query: SofiaAdminPaymentsQuery) => ['sofia', 'payments', 'intents', query] as const,
  paymentLinks: (query: SofiaAdminPaymentsQuery) => ['sofia', 'payments', 'links', query] as const,
  paymentTransitions: (query: SofiaAdminPaymentsQuery) => ['sofia', 'payments', 'transitions', query] as const,
  paymentWebhooks: (query: SofiaAdminPaymentsQuery) => ['sofia', 'payments', 'webhooks', query] as const,
  customerServiceCases: (query: SofiaCustomerServiceCasesQuery) =>
    ['sofia', 'customer-service', 'cases', query] as const,
  customerServiceCase: (caseId: string) => ['sofia', 'customer-service', 'cases', caseId] as const,
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

export type SofiaAdminPaymentsQuery = {
  page: number;
  limit: number;
  status?: string;
  checkoutId?: string;
  paymentIntentId?: string;
};

export type SofiaCustomerServiceCasesQuery = {
  page: number;
  limit: number;
  status?: string;
  category?: string;
  customerId?: string;
};

function buildSearchParams(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

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

/* ------------------------------------------------------------------ */
/*  Centro de Control — gobernanza y runtime safety                    */
/* ------------------------------------------------------------------ */

export function useSofiaGovernanceStatus() {
  return useQuery({
    queryKey: sofiaQueryKeys.governanceStatus,
    queryFn: () => apiFetchSchema('/admin/sofia/control/status', sofiaGovernanceStatusSchema),
    refetchInterval: 20_000,
  });
}

export function useSofiaGovernanceMetrics() {
  return useQuery({
    queryKey: sofiaQueryKeys.governanceMetrics,
    queryFn: () => apiFetchSchema('/admin/sofia/metrics', sofiaGovernanceMetricsSchema),
    refetchInterval: 30_000,
  });
}

export function useSofiaSecurityStatus() {
  return useQuery({
    queryKey: sofiaQueryKeys.securityStatus,
    queryFn: () => apiFetchSchema('/admin/sofia/security-status', sofiaSecurityStatusSchema),
    refetchInterval: 60_000,
  });
}

export function useSofiaRuntimeSafety() {
  return useQuery({
    queryKey: sofiaQueryKeys.runtimeSafety,
    queryFn: () => apiFetchSchema('/admin/sofia/runtime-safety', sofiaRuntimeSafetySchema),
    refetchInterval: 20_000,
  });
}

function useSofiaGovernanceAction(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) =>
      apiFetchSchema(path, sofiaGovernanceActionResponseSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.governanceStatus });
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.runtimeSafety });
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.dashboardSummary });
    },
  });
}

/** Pausa global de SOFIA. No afecta POS/Domicilios/Caja/Stock — solo automatización de SOFIA. */
export function useSofiaPauseGlobal() {
  return useSofiaGovernanceAction('/admin/sofia/control/pause-global');
}

export function useSofiaResumeGlobal() {
  return useSofiaGovernanceAction('/admin/sofia/control/resume-global');
}

/** Kill-switch de emergencia: bloquea toda automatización de SOFIA de inmediato. */
export function useSofiaActivateKillSwitch() {
  return useSofiaGovernanceAction('/admin/sofia/control/kill-switch/activate');
}

export function useSofiaDeactivateKillSwitch() {
  return useSofiaGovernanceAction('/admin/sofia/control/kill-switch/deactivate');
}

/* ------------------------------------------------------------------ */
/*  Pagos — solo lectura/observabilidad, SOFIA nunca marca ni crea      */
/*  pagos reales                                                       */
/* ------------------------------------------------------------------ */

export function useSofiaAdminPaymentIntents(query: SofiaAdminPaymentsQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.paymentIntents(query),
    queryFn: () => apiFetchSchema(`/admin/payments/intents?${search}`, sofiaAdminPaymentIntentsSchema),
    refetchInterval: 20_000,
  });
}

export function useSofiaAdminPaymentLinks(query: SofiaAdminPaymentsQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.paymentLinks(query),
    queryFn: () => apiFetchSchema(`/admin/payments/links?${search}`, sofiaAdminPaymentLinksSchema),
    refetchInterval: 20_000,
  });
}

export function useSofiaAdminPaymentTransitions(query: SofiaAdminPaymentsQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.paymentTransitions(query),
    queryFn: () => apiFetchSchema(`/admin/payments/transitions?${search}`, sofiaAdminPaymentTransitionsSchema),
    refetchInterval: 20_000,
  });
}

export function useSofiaAdminPaymentWebhooks(query: SofiaAdminPaymentsQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.paymentWebhooks(query),
    queryFn: () => apiFetchSchema(`/admin/payments/webhooks?${search}`, sofiaAdminPaymentWebhooksSchema),
    refetchInterval: 20_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Servicio al cliente — gestión de casos por el operador humano       */
/* ------------------------------------------------------------------ */

export function useSofiaCustomerServiceCases(query: SofiaCustomerServiceCasesQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.customerServiceCases(query),
    queryFn: () => apiFetchSchema(`/admin/customer-service/cases?${search}`, sofiaCustomerServiceCasesSchema),
    refetchInterval: 20_000,
  });
}

export function useSofiaCustomerServiceCase(caseId: string) {
  return useQuery({
    queryKey: sofiaQueryKeys.customerServiceCase(caseId),
    queryFn: () =>
      apiFetchSchema(
        `/admin/customer-service/cases/${encodeURIComponent(caseId)}`,
        sofiaCustomerServiceCaseDetailSchema,
      ),
    enabled: caseId.length > 0,
  });
}

export type SofiaCustomerServiceTransitionInput = {
  caseId: string;
  expectedVersion: number;
  fromStatus: string;
  toStatus: string;
  idempotencyKey: string;
  reasonCode: string;
  resolutionCode?: string;
};

/** Transición de estado de un caso, operada por el humano desde el panel admin — no es una acción autónoma de SOFIA. */
export function useSofiaCustomerServiceTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, ...body }: SofiaCustomerServiceTransitionInput) =>
      apiFetchSchema(
        `/admin/customer-service/cases/${encodeURIComponent(caseId)}/transitions`,
        sofiaCustomerServiceTransitionResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.customerServiceCase(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: ['sofia', 'customer-service', 'cases'] });
    },
  });
}
