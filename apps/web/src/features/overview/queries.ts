'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetchSchema } from '@/lib/api';
import { POLLING_INTERVAL, visiblePolling } from '@/lib/query-policy';
import {
  observabilitySchema,
  operationalReportSchema,
  sofiaDashboardSummarySchema,
} from './contracts';

export const overviewQueryKeys = {
  operational: ['overview', 'operational'] as const,
  daily: (date?: string) => ['overview', 'daily', date ?? 'today'] as const,
  observability: ['overview', 'observability'] as const,
  sofia: ['overview', 'sofia'] as const,
};

export function useOperationalReport() {
  return useQuery({
    queryKey: overviewQueryKeys.operational,
    queryFn: () => apiFetchSchema('/reports/operational', operationalReportSchema),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}

export function useDailyReport(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return useQuery({
    queryKey: overviewQueryKeys.daily(date),
    queryFn: () => apiFetchSchema(`/reports/daily${query}`, operationalReportSchema),
    refetchInterval: visiblePolling(POLLING_INTERVAL.reference),
  });
}

export function useObservabilitySnapshot() {
  return useQuery({
    queryKey: overviewQueryKeys.observability,
    queryFn: () => apiFetchSchema('/health/observability', observabilitySchema),
    refetchInterval: visiblePolling(POLLING_INTERVAL.critical),
  });
}

export function useSofiaDashboardSummary() {
  return useQuery({
    queryKey: overviewQueryKeys.sofia,
    queryFn: () => apiFetchSchema('/admin/sofia/dashboard/summary', sofiaDashboardSummarySchema),
    refetchInterval: visiblePolling(POLLING_INTERVAL.operational),
  });
}
