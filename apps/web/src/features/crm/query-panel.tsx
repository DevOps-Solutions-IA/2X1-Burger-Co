import type { ReactNode } from 'react';
import { QueryState } from '@/components/product';
import { ApiError } from '@/lib/api';

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
  if (error instanceof ApiError && error.status === 403) {
    return <QueryState status="permission_denied" title="No puedes consultar esta información CRM" description="El servidor rechazó el acceso para la sesión actual." />;
  }
  if (error) return <QueryState status="error" onRetry={onRetry} />;
  if (empty) return <QueryState status="empty" title={emptyTitle} description={emptyDescription} />;
  return children;
}
