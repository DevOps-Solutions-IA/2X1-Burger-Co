import type { SofiaStatusTone } from '@/components/sofia/workspace';
import type { SofiaInboxScope } from '@/features/sofia/contracts';

/**
 * `humanStatus` es un string libre devuelto por el backend (no un enum
 * cerrado) sobre el estado de intervención humana de la conversación —
 * distinto del estado de envío de un mensaje outbound. Este mapeo es
 * best-effort por palabras clave; cualquier valor no reconocido cae en el
 * tono neutro 'read_only' — nunca se asume un estado positivo/negativo sin
 * evidencia textual. No incluye 'SENT': ese token pertenece al estado de
 * outbound (ver `outbound.sent` en ConversationDetailPanel), no al de
 * intervención humana.
 */
export function toneFromFreeStatus(status: string): SofiaStatusTone {
  const normalized = status.toUpperCase();
  if (normalized.includes('BLOCK') || normalized.includes('FAILED')) return 'failed';
  if (normalized.includes('HUMAN')) return 'human_required';
  if (normalized.includes('PENDING') || normalized.includes('SUGGEST') || normalized.includes('DRAFT')) return 'pending';
  if (normalized.includes('ACTIVE') || normalized.includes('RESOLVED') || normalized.includes('APPROVED')) return 'success';
  return 'read_only';
}

export const SCOPE_LABEL: Record<SofiaInboxScope, string> = {
  real: 'Real',
  internal_validation: 'Validación interna',
  sandbox: 'Sandbox',
  historical: 'Histórico',
};

export const SCOPE_TONE: Record<SofiaInboxScope, SofiaStatusTone> = {
  real: 'success',
  internal_validation: 'pending',
  sandbox: 'read_only',
  historical: 'read_only',
};

export function maskedPhoneOrLabel(phoneMasked: string | null, customerLabel: string): string {
  return phoneMasked ?? customerLabel;
}
