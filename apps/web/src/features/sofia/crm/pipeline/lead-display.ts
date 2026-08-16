/** Helpers de presentación puramente derivados para leads del pipeline CRM — sin llamadas a red ni estado. */
import type { SofiaStatusTone } from '@/components/sofia';

export const CRM_LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: 'Nuevo',
  QUALIFIED: 'Calificado',
  ACTIVE: 'Activo',
  WON: 'Ganado',
  LOST: 'Perdido',
  ARCHIVED: 'Archivado',
};

export const CRM_LEAD_STATUS_OPTIONS = ['NEW', 'QUALIFIED', 'ACTIVE', 'WON', 'LOST', 'ARCHIVED'] as const;

export function leadStatusTone(status: string): SofiaStatusTone {
  if (status === 'WON') return 'success';
  if (status === 'LOST') return 'blocked';
  if (status === 'ACTIVE' || status === 'QUALIFIED') return 'pending';
  if (status === 'ARCHIVED') return 'read_only';
  return 'unknown';
}

export const CRM_LEAD_SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  POS: 'POS',
  DELIVERY: 'Domicilios',
  CUSTOMER_SERVICE: 'Servicio al cliente',
  AUTHORIZED_OPERATOR: 'Operador autorizado',
};

export const CRM_LEAD_SOURCE_OPTIONS = ['WHATSAPP', 'POS', 'DELIVERY', 'CUSTOMER_SERVICE', 'AUTHORIZED_OPERATOR'] as const;

export const CRM_STAGE_OUTCOME_LABEL: Record<string, string> = {
  OPEN: 'Abierta',
  WON: 'Ganada',
  LOST: 'Perdida',
};

export function stageOutcomeTone(outcome: string): SofiaStatusTone {
  if (outcome === 'WON') return 'success';
  if (outcome === 'LOST') return 'blocked';
  return 'read_only';
}
