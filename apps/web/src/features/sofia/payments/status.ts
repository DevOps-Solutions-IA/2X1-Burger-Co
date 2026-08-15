import type { SofiaStatusTone } from '@/components/sofia/workspace';

/**
 * Mapeo de estados de pago a tonos visuales. UNKNOWN_RESULT y
 * FINANCIAL_REVIEW_REQUIRED usan el tono `unknown`: significan que no se
 * sabe si el pago se completó y requieren revisión financiera humana — NO
 * son un fallo (`failed`). Nunca colapsar esos dos conceptos.
 */
export function intentStatusTone(status: string | null | undefined): SofiaStatusTone {
  switch (status) {
    case 'PAID':
    case 'SUCCEEDED':
      return 'success';
    case 'CREATED':
    case 'LINK_READY':
    case 'PENDING':
      return 'pending';
    case 'FAILED':
      return 'failed';
    case 'EXPIRED':
    case 'CANCELLED':
      return 'blocked';
    case 'UNKNOWN_RESULT':
    case 'FINANCIAL_REVIEW_REQUIRED':
      return 'unknown';
    default:
      return 'read_only';
  }
}

export function linkStatusTone(status: string | null | undefined): SofiaStatusTone {
  switch (status) {
    case 'ACTIVE':
    case 'OPENED':
      return 'pending';
    case 'REVOKED':
    case 'EXPIRED':
      return 'blocked';
    default:
      return 'read_only';
  }
}

export function webhookProcessedStatusTone(status: string | null | undefined): SofiaStatusTone {
  switch (status) {
    case 'PROCESSED':
      return 'success';
    case 'RECEIVED':
    case 'PROCESSING':
      return 'pending';
    case 'DUPLICATE_REPLAY':
      return 'read_only';
    case 'SIGNATURE_INVALID':
      return 'blocked';
    case 'REFERENCE_UNKNOWN':
      return 'warning';
    case 'AMOUNT_MISMATCH':
    case 'CURRENCY_MISMATCH':
    case 'ACCOUNT_MISMATCH':
      return 'failed';
    case 'FINANCIAL_REVIEW_REQUIRED':
      return 'unknown';
    default:
      return 'read_only';
  }
}

export const PAYMENT_INTENT_STATUS_OPTIONS = [
  { value: 'CREATED', label: 'Creado' },
  { value: 'PENDING', label: 'Pendiente' },
  { value: 'PAID', label: 'Pagado' },
  { value: 'FAILED', label: 'Falló' },
  { value: 'EXPIRED', label: 'Expirado' },
  { value: 'CANCELLED', label: 'Cancelado' },
  { value: 'UNKNOWN_RESULT', label: 'Resultado desconocido' },
] as const;

export const PAYMENT_LINK_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'OPENED', label: 'Abierto' },
  { value: 'REVOKED', label: 'Revocado' },
  { value: 'EXPIRED', label: 'Expirado' },
] as const;
