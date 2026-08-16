import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchSchema } from '@/lib/api';
import {
  sofiaAlertsSchema,
  sofiaConversationsInboxSchema,
  sofiaCrmCampaignSchema,
  sofiaCrmCampaignSendResultSchema,
  sofiaCrmCampaignsPageSchema,
  sofiaCrmCustomerDetailSchema,
  sofiaCrmCustomersSchema,
  sofiaCrmLeadDetailSchema,
  sofiaCrmLeadsPageSchema,
  sofiaCrmNotesPageSchema,
  sofiaCrmPipelinesPageSchema,
  sofiaCrmSegmentsPageSchema,
  sofiaCrmTagsPageSchema,
  sofiaCrmTasksPageSchema,
  sofiaCustomerServiceCaseDetailSchema,
  sofiaCustomerServiceCasesSchema,
  sofiaCustomerServiceTransitionResultSchema,
  sofiaDashboardSummarySchema,
  sofiaGovernanceActionResponseSchema,
  sofiaGovernanceEventsSchema,
  sofiaGovernanceStatusSchema,
  sofiaMetricsSummarySchema,
  sofiaQrStatusSchema,
  sofiaReadinessSchema,
  sofiaRuntimeSafetySchema,
  sofiaSecurityStatusSchema,
  secureCommandDetailSchema,
  secureCommandsPageSchema,
  type SofiaMetricsRange,
} from './contracts';

function buildSearchParams(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const sofiaQueryKeys = {
  dashboardSummary: ['sofia', 'dashboard-summary'] as const,
  metricsSummary: (range: SofiaMetricsRange) => ['sofia', 'metrics-summary', range] as const,
  governanceStatus: ['sofia', 'governance-status'] as const,
  readiness: ['sofia', 'readiness'] as const,
  governanceEvents: ['sofia', 'governance-events'] as const,
  alerts: ['sofia', 'alerts'] as const,
  securityStatus: ['sofia', 'security-status'] as const,
  runtimeSafety: ['sofia', 'runtime-safety'] as const,
  qrStatus: ['sofia', 'whatsapp-qr-status'] as const,
  conversationsInbox: ['sofia', 'conversations-inbox'] as const,
  secureCommands: (query: SecureCommandsQuery) => ['sofia', 'secure-commands', query] as const,
  secureCommand: (id: string) => ['sofia', 'secure-commands', id] as const,
  customerServiceCases: (query: SofiaCustomerServiceCasesQuery) =>
    ['sofia', 'customer-service', 'cases', query] as const,
  customerServiceCase: (caseId: string) => ['sofia', 'customer-service', 'cases', caseId] as const,
  crmCustomers: (q: string, page: number, limit: number) => ['sofia', 'crm', 'customers', { q, page, limit }] as const,
  crmCustomer: (customerId: string) => ['sofia', 'crm', 'customers', customerId] as const,
  crmSegments: (page: number, limit: number) => ['sofia', 'crm', 'segments', { page, limit }] as const,
  crmTags: (page: number, limit: number) => ['sofia', 'crm', 'tags', { page, limit }] as const,
  crmPipelines: (page: number, limit: number) => ['sofia', 'crm', 'pipelines', { page, limit }] as const,
  crmLeads: (query: SofiaCrmLeadsQuery) => ['sofia', 'crm', 'leads', query] as const,
  crmLead: (leadId: string) => ['sofia', 'crm', 'leads', leadId] as const,
  crmTasks: (query: SofiaCrmTasksQuery) => ['sofia', 'crm', 'tasks', query] as const,
  crmNotes: (query: SofiaCrmNotesQuery) => ['sofia', 'crm', 'notes', query] as const,
  crmCampaigns: (query: SofiaCrmCampaignsQuery) => ['sofia', 'crm', 'campaigns', query] as const,
};

/* ------------------------------------------------------------------ */
/*  Centro de Control                                                  */
/* ------------------------------------------------------------------ */

export function useSofiaDashboardSummary() {
  return useQuery({
    queryKey: sofiaQueryKeys.dashboardSummary,
    queryFn: () => apiFetchSchema('/admin/sofia/dashboard/summary', sofiaDashboardSummarySchema),
    refetchInterval: 30_000,
  });
}

export function useSofiaMetricsSummary(range: SofiaMetricsRange) {
  return useQuery({
    queryKey: sofiaQueryKeys.metricsSummary(range),
    queryFn: () => apiFetchSchema(`/admin/sofia/metrics/summary?range=${range}`, sofiaMetricsSummarySchema),
    refetchInterval: 60_000,
  });
}

export function useSofiaGovernanceStatus() {
  return useQuery({
    queryKey: sofiaQueryKeys.governanceStatus,
    queryFn: () => apiFetchSchema('/admin/sofia/control/status', sofiaGovernanceStatusSchema),
    refetchInterval: 20_000,
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
/*  Conversaciones / WhatsApp                                          */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Validación — SecureCommand                                         */
/* ------------------------------------------------------------------ */

export type SecureCommandsQuery = { page: number; limit: number; status?: string; commandType?: string };

export function useSecureCommands(query: SecureCommandsQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.secureCommands(query),
    queryFn: () => apiFetchSchema(`/admin/secure-commands?${search}`, secureCommandsPageSchema),
    refetchInterval: 15_000,
  });
}

export function useSecureCommand(id: string) {
  return useQuery({
    queryKey: sofiaQueryKeys.secureCommand(id),
    queryFn: () => apiFetchSchema(`/admin/secure-commands/${encodeURIComponent(id)}`, secureCommandDetailSchema),
    enabled: id.length > 0,
  });
}

export type SecureCommandApproveInput = { id: string; reasonCode: string; policyReference: string };
export type SecureCommandRejectInput = { id: string; reasonCode: string };

export function useSecureCommandApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SecureCommandApproveInput) =>
      apiFetchSchema(`/admin/secure-commands/${encodeURIComponent(id)}/approve`, secureCommandDetailSchema.shape.command, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.secureCommand(variables.id) });
      queryClient.invalidateQueries({ queryKey: ['sofia', 'secure-commands'] });
    },
  });
}

export function useSecureCommandReject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SecureCommandRejectInput) =>
      apiFetchSchema(`/admin/secure-commands/${encodeURIComponent(id)}/reject`, secureCommandDetailSchema.shape.command, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.secureCommand(variables.id) });
      queryClient.invalidateQueries({ queryKey: ['sofia', 'secure-commands'] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Validación — Servicio al cliente (escalaciones de SOFIA)           */
/* ------------------------------------------------------------------ */

export type SofiaCustomerServiceCasesQuery = {
  page: number;
  limit: number;
  status?: string;
  category?: string;
  customerId?: string;
};

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
      apiFetchSchema(`/admin/customer-service/cases/${encodeURIComponent(caseId)}`, sofiaCustomerServiceCaseDetailSchema),
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
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.customerServiceCase(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: ['sofia', 'customer-service', 'cases'] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  CRM — Clientes                                                     */
/* ------------------------------------------------------------------ */

export type SofiaCrmCustomersQuery = { q?: string; page: number; limit: number };

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
      apiFetchSchema(`/admin/sofia/crm/customers/${encodeURIComponent(customerId)}`, sofiaCrmCustomerDetailSchema),
    enabled: customerId.length > 0,
  });
}

/* ------------------------------------------------------------------ */
/*  CRM — Segmentos / Tags                                             */
/* ------------------------------------------------------------------ */

export function useSofiaCrmSegments(page: number, limit: number) {
  const search = buildSearchParams({ page, limit });
  return useQuery({
    queryKey: sofiaQueryKeys.crmSegments(page, limit),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/segments?${search}`, sofiaCrmSegmentsPageSchema),
  });
}

export function useSofiaCrmTags(page: number, limit: number) {
  const search = buildSearchParams({ page, limit });
  return useQuery({
    queryKey: sofiaQueryKeys.crmTags(page, limit),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/tags?${search}`, sofiaCrmTagsPageSchema),
  });
}

export type SofiaCrmCreateSegmentInput = { name: string; description?: string; customerIds?: string[] };

export function useSofiaCrmCreateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SofiaCrmCreateSegmentInput) =>
      apiFetchSchema('/admin/sofia/crm/segments', sofiaCrmSegmentsPageSchema.shape.data.element, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'segments'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  CRM — Pipeline / Leads                                             */
/* ------------------------------------------------------------------ */

export function useSofiaCrmPipelines(page: number, limit: number) {
  const search = buildSearchParams({ page, limit });
  return useQuery({
    queryKey: sofiaQueryKeys.crmPipelines(page, limit),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/pipelines?${search}`, sofiaCrmPipelinesPageSchema),
  });
}

export type SofiaCrmLeadsQuery = {
  page: number;
  limit: number;
  customerId?: string;
  pipelineId?: string;
  ownerId?: string;
  status?: string;
};

export function useSofiaCrmLeads(query: SofiaCrmLeadsQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.crmLeads(query),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/leads?${search}`, sofiaCrmLeadsPageSchema),
    refetchInterval: 30_000,
  });
}

export function useSofiaCrmLead(leadId: string) {
  return useQuery({
    queryKey: sofiaQueryKeys.crmLead(leadId),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/leads/${encodeURIComponent(leadId)}`, sofiaCrmLeadDetailSchema),
    enabled: leadId.length > 0,
  });
}

export type SofiaCrmCreateLeadInput = {
  customerId: string;
  pipelineId: string;
  currentStageId: string;
  source: string;
  sourceReference: string;
  title: string;
  ownerId?: string;
};

export function useSofiaCrmCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SofiaCrmCreateLeadInput) =>
      apiFetchSchema('/admin/sofia/crm/leads', sofiaCrmLeadDetailSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'leads'] }),
  });
}

export type SofiaCrmTransitionLeadInput = {
  leadId: string;
  expectedVersion: number;
  toStageId: string;
  toStatus: string;
  idempotencyKey: string;
  reasonCode: string;
};

export function useSofiaCrmTransitionLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...body }: SofiaCrmTransitionLeadInput) =>
      apiFetchSchema(`/admin/sofia/crm/leads/${encodeURIComponent(leadId)}/transitions`, sofiaCrmLeadDetailSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sofiaQueryKeys.crmLead(variables.leadId) });
      queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'leads'] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  CRM — Tareas                                                       */
/* ------------------------------------------------------------------ */

export type SofiaCrmTasksQuery = {
  page: number;
  limit: number;
  customerId?: string;
  leadId?: string;
  assignedToId?: string;
  type?: string;
  status?: string;
};

export function useSofiaCrmTasks(query: SofiaCrmTasksQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.crmTasks(query),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/tasks?${search}`, sofiaCrmTasksPageSchema),
    refetchInterval: 30_000,
  });
}

export type SofiaCrmCreateTaskInput = {
  customerId: string;
  leadId?: string;
  customerServiceCaseId?: string;
  source: string;
  sourceReference: string;
  type: string;
  priority?: string;
  title: string;
  description?: string;
  assignedToId?: string;
  dueAt?: string;
};

export function useSofiaCrmCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SofiaCrmCreateTaskInput) =>
      apiFetchSchema('/admin/sofia/crm/tasks', sofiaCrmTasksPageSchema.shape.data.element, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'tasks'] }),
  });
}

export type SofiaCrmUpdateTaskInput = {
  taskId: string;
  idempotencyKey: string;
  expectedVersion: number;
  status: string;
  assignedToId?: string;
};

export function useSofiaCrmUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...body }: SofiaCrmUpdateTaskInput) =>
      apiFetchSchema(`/admin/sofia/crm/tasks/${encodeURIComponent(taskId)}`, sofiaCrmTasksPageSchema.shape.data.element, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'tasks'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  CRM — Notas                                                        */
/* ------------------------------------------------------------------ */

export type SofiaCrmNotesQuery = { page: number; limit: number; customerId?: string; leadId?: string };

export function useSofiaCrmNotes(query: SofiaCrmNotesQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.crmNotes(query),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/notes?${search}`, sofiaCrmNotesPageSchema),
    enabled: Boolean(query.customerId || query.leadId),
  });
}

export type SofiaCrmCreateNoteInput = {
  customerId: string;
  leadId?: string;
  customerServiceCaseId?: string;
  source: string;
  sourceReference: string;
  body: string;
};

export function useSofiaCrmCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SofiaCrmCreateNoteInput) =>
      apiFetchSchema('/admin/sofia/crm/notes', sofiaCrmNotesPageSchema.shape.data.element, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'notes'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  CRM — Campañas (envío siempre bloqueado por diseño)                 */
/* ------------------------------------------------------------------ */

export type SofiaCrmCampaignsQuery = { page: number; limit: number; segmentId?: string };

export function useSofiaCrmCampaigns(query: SofiaCrmCampaignsQuery) {
  const search = buildSearchParams(query);
  return useQuery({
    queryKey: sofiaQueryKeys.crmCampaigns(query),
    queryFn: () => apiFetchSchema(`/admin/sofia/crm/campaigns?${search}`, sofiaCrmCampaignsPageSchema),
  });
}

export type SofiaCrmCreateCampaignInput = { name: string; segmentId?: string; messageTemplate: string };

export function useSofiaCrmCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SofiaCrmCreateCampaignInput) =>
      apiFetchSchema('/admin/sofia/crm/campaigns', sofiaCrmCampaignSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'campaigns'] }),
  });
}

/** Siempre resulta en estado BLOCKED — el envío real de WhatsApp permanece bloqueado por diseño. */
export function useSofiaCrmAttemptCampaignSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) =>
      apiFetchSchema(`/admin/sofia/crm/campaigns/${encodeURIComponent(campaignId)}/send`, sofiaCrmCampaignSendResultSchema, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sofia', 'crm', 'campaigns'] }),
  });
}
