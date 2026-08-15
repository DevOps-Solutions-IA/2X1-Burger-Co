import type { SofiaStatusTone } from '@/components/sofia/workspace';
import type { SofiaInboxScope } from '@/features/sofia/contracts';

/**
 * `status`/`humanStatus` son strings libres devueltos por el backend (no un
 * enum cerrado). Este mapeo es best-effort por palabras clave; cualquier
 * valor no reconocido cae en el tono neutro 'read_only' — nunca se asume un
 * estado positivo/negativo sin evidencia textual.
 */
export function toneFromFreeStatus(status: string): SofiaStatusTone {
  const normalized = status.toUpperCase();
  if (normalized.includes('BLOCK') || normalized.includes('FAILED') || normalized.includes('SENT')) return 'failed';
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
