import type { ReactNode } from 'react';
import { QueryState } from '@/components/product';

export function CrmQueryPanel({
  pending,
  error,
  empty,
  onRetry,
  emptyTitle,
  emptyDescription,
  children,
}: {
  pending: boolean;
  error: unknown;
  empty: boolean;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription: string;
  children: ReactNode;
}) {
  if (pending) return <QueryState status="loading" title="Consultando información CRM" />;
  if (error) return <QueryState status="error" onRetry={onRetry} />;
  if (empty) return <QueryState status="empty" title={emptyTitle} description={emptyDescription} />;
  return children;
}
