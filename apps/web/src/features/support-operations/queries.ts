'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetchSchema } from '@/lib/api';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import {
  serviceCasePageSchema,
  serviceCaseSchema,
  serviceCaseTransitionResponseSchema,
  type ServiceCaseCategory,
  type ServiceCaseStatus,
} from './contracts';

export const supportQueryKeys = {
  cases: (page: number, status: string, category: string) => ['customer-service', 'cases', page, status, category] as const,
  case: (id: string | null) => ['customer-service', 'case', id] as const,
};

function listQuery(page: number, status: string, category: string) {
  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  return params.toString();
}

export function useServiceCases(page: number, status: ServiceCaseStatus | '', category: ServiceCaseCategory | '') {
  return useQuery({
    queryKey: supportQueryKeys.cases(page, status, category),
    queryFn: () => apiFetchSchema(`/admin/customer-service/cases?${listQuery(page, status, category)}`, serviceCasePageSchema),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function useServiceCase(id: string | null) {
  return useQuery({
    queryKey: supportQueryKeys.case(id),
    queryFn: () => apiFetchSchema(`/admin/customer-service/cases/${encodeURIComponent(id!)}`, serviceCaseSchema),
    enabled: Boolean(id),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function useServiceCaseTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expectedVersion,
      fromStatus,
      toStatus,
      reasonCode,
      resolutionCode,
    }: {
      id: string;
      expectedVersion: number;
      fromStatus: ServiceCaseStatus;
      toStatus: ServiceCaseStatus;
      reasonCode: string;
      resolutionCode?: string;
    }) => apiFetchSchema(
      `/admin/customer-service/cases/${encodeURIComponent(id)}/transitions`,
      serviceCaseTransitionResponseSchema,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion,
          fromStatus,
          toStatus,
          idempotencyKey: `phase8-ui:${id}:${expectedVersion}:${fromStatus}:${toStatus}:${reasonCode}`.slice(0, 200),
          reasonCode,
          ...(resolutionCode ? { resolutionCode } : {}),
        }),
      },
    ),
    scope: { id: 'customer-service-case-transition' },
    onSuccess: async (_result, variables) => {
      toast.success('Caso actualizado con evidencia versionada');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customer-service', 'cases'] }),
        queryClient.invalidateQueries({ queryKey: supportQueryKeys.case(variables.id) }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el caso.'),
  });
}
