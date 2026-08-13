'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchSchema } from '@/lib/api';
import {
  crmLeadTransitionResponseSchema,
  crmLeadsResponseSchema,
  crmNotesResponseSchema,
  crmPipelinesResponseSchema,
  crmSegmentsResponseSchema,
  crmTagsResponseSchema,
  crmTaskUpdateResponseSchema,
  crmTasksResponseSchema,
  crmTimelineResponseSchema,
  type CrmLeadStatus,
  type CrmTaskStatus,
  type CrmTaskType,
} from './contracts';

const ROOT = '/admin/sofia/crm';

function queryString(input: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

export const crmKeys = {
  root: ['crm'] as const,
  pipelines: (status: string | undefined, page: number) => ['crm', 'pipelines', status ?? 'ALL', page] as const,
  leads: (filters: Record<string, unknown>) => ['crm', 'leads', filters] as const,
  tasks: (filters: Record<string, unknown>) => ['crm', 'tasks', filters] as const,
  notes: (filters: Record<string, unknown>) => ['crm', 'notes', filters] as const,
  segments: (page: number) => ['crm', 'segments', page] as const,
  tags: (page: number) => ['crm', 'tags', page] as const,
  timeline: (customerId: string, page: number) => ['crm', 'timeline', customerId, page] as const,
};

export function useCrmPipelines(status?: 'ACTIVE' | 'ARCHIVED', page = 1) {
  const normalized = { page, limit: 50, status };
  return useQuery({
    queryKey: crmKeys.pipelines(status, page),
    queryFn: () => apiFetchSchema(`${ROOT}/pipelines?${queryString(normalized)}`, crmPipelinesResponseSchema),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCrmLeads(filters: { page?: number; status?: CrmLeadStatus; pipelineId?: string } = {}) {
  const normalized = { page: filters.page ?? 1, limit: 50, status: filters.status, pipelineId: filters.pipelineId };
  return useQuery({
    queryKey: crmKeys.leads(normalized),
    queryFn: () => apiFetchSchema(`${ROOT}/leads?${queryString(normalized)}`, crmLeadsResponseSchema),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCrmTasks(filters: { page?: number; type?: CrmTaskType; status?: CrmTaskStatus } = {}) {
  const normalized = { page: filters.page ?? 1, limit: 50, type: filters.type, status: filters.status };
  return useQuery({
    queryKey: crmKeys.tasks(normalized),
    queryFn: () => apiFetchSchema(`${ROOT}/tasks?${queryString(normalized)}`, crmTasksResponseSchema),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCrmNotes(page = 1) {
  const filters = { page, limit: 50 };
  return useQuery({
    queryKey: crmKeys.notes(filters),
    queryFn: () => apiFetchSchema(`${ROOT}/notes?${queryString(filters)}`, crmNotesResponseSchema),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });
}

export function useCrmSegments(page = 1) {
  const filters = { page, limit: 50 };
  return useQuery({
    queryKey: crmKeys.segments(page),
    queryFn: () => apiFetchSchema(`${ROOT}/segments?${queryString(filters)}`, crmSegmentsResponseSchema),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCrmTags(page = 1) {
  const filters = { page, limit: 50 };
  return useQuery({
    queryKey: crmKeys.tags(page),
    queryFn: () => apiFetchSchema(`${ROOT}/tags?${queryString(filters)}`, crmTagsResponseSchema),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCrmUnifiedTimeline(customerId: string, page = 1) {
  return useQuery({
    queryKey: crmKeys.timeline(customerId, page),
    queryFn: () => apiFetchSchema(`${ROOT}/customers/${encodeURIComponent(customerId)}/unified-timeline?page=${page}&limit=50`, crmTimelineResponseSchema),
    enabled: customerId.length >= 8,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useTransitionCrmLead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadId: string; expectedVersion: number; toStageId: string; toStatus: CrmLeadStatus; idempotencyKey: string }) =>
      apiFetchSchema(`${ROOT}/leads/${encodeURIComponent(input.leadId)}/transitions`, crmLeadTransitionResponseSchema, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: input.expectedVersion,
          toStageId: input.toStageId,
          toStatus: input.toStatus,
          idempotencyKey: input.idempotencyKey,
          reasonCode: 'AUTHORIZED_OPERATOR_TRANSITION',
        }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['crm', 'leads'] }),
  });
}

export function useUpdateCrmTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; expectedVersion: number; status: CrmTaskStatus; assignedToId?: string }) =>
      apiFetchSchema(`${ROOT}/tasks/${encodeURIComponent(input.taskId)}`, crmTaskUpdateResponseSchema, {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: input.expectedVersion, status: input.status, assignedToId: input.assignedToId }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['crm', 'tasks'] }),
  });
}
