import type { CrmLeadStatus, CrmTaskStatus } from './contracts';

export const leadStatusLabels: Record<CrmLeadStatus, string> = {
  NEW: 'Nuevo',
  QUALIFIED: 'Calificado',
  ACTIVE: 'Activo',
  WON: 'Ganado',
  LOST: 'Perdido',
  ARCHIVED: 'Archivado',
};

export const taskStatusLabels: Record<CrmTaskStatus, string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

export function customerName(name: string | null) {
  return name?.trim() || 'Cliente sin nombre confirmado';
}

export function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'No pudimos completar la operación.';
}
