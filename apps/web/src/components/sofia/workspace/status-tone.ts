/**
 * Semántica visual de estados operativos del workspace SOFIA + CRM.
 *
 * Estos ocho estados cubren todo lo que una superficie de SOFIA/CRM necesita
 * comunicar sobre una capacidad, comando o entidad: éxito, precaución,
 * bloqueo por diseño, pendiente de acción, resultado desconocido (crítico
 * para pagos), fallo, requiere intervención humana, o solo lectura.
 */
export type SofiaStatusTone =
  | 'success'
  | 'warning'
  | 'blocked'
  | 'pending'
  | 'unknown'
  | 'failed'
  | 'human_required'
  | 'read_only';

export const SOFIA_STATUS_TONE_LABEL: Record<SofiaStatusTone, string> = {
  success: 'Correcto',
  warning: 'Precaución',
  blocked: 'Bloqueado',
  pending: 'Pendiente',
  unknown: 'Por verificar',
  failed: 'Falló',
  human_required: 'Requiere humano',
  read_only: 'Solo lectura',
};

export const SOFIA_STATUS_TONE_BADGE_CLASS: Record<SofiaStatusTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  blocked: 'border-red-200 bg-red-50 text-red-800',
  pending: 'border-sofia-200 bg-sofia-50 text-sofia-800',
  unknown: 'border-orange-200 bg-orange-50 text-orange-900',
  failed: 'border-red-300 bg-red-100 text-red-900',
  human_required: 'border-amber-300 bg-amber-100 text-amber-900',
  read_only: 'border-stone-200 bg-stone-100 text-stone-700',
};

export const SOFIA_STATUS_TONE_DOT_CLASS: Record<SofiaStatusTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  blocked: 'bg-red-500',
  pending: 'bg-sofia-500',
  unknown: 'bg-orange-500',
  failed: 'bg-red-600',
  human_required: 'bg-amber-600',
  read_only: 'bg-stone-400',
};

/** Mapea los estados PASS/WARNING/BLOCKED que expone el backend (readiness, checklist) a SofiaStatusTone. */
export function toneFromCheckStatus(status: 'PASS' | 'WARNING' | 'BLOCKED'): SofiaStatusTone {
  if (status === 'PASS') return 'success';
  if (status === 'WARNING') return 'warning';
  return 'blocked';
}

/** Mapea la severidad de alertas del backend a SofiaStatusTone. */
export function toneFromAlertSeverity(severity: 'INFO' | 'WARNING' | 'CRITICAL'): SofiaStatusTone {
  if (severity === 'CRITICAL') return 'failed';
  if (severity === 'WARNING') return 'warning';
  return 'read_only';
}
