/**
 * Semántica visual de estados operativos de la Torre de Control SOFIA.
 * Cubre lo que cualquier superficie de control/validación necesita
 * comunicar: éxito, precaución, bloqueo por diseño, pendiente de acción,
 * resultado desconocido (crítico para pagos/comandos), fallo, requiere
 * intervención humana, o solo lectura.
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
  pending: 'border-sky-200 bg-sky-50 text-sky-800',
  unknown: 'border-orange-200 bg-orange-50 text-orange-900',
  failed: 'border-red-300 bg-red-100 text-red-900',
  human_required: 'border-amber-300 bg-amber-100 text-amber-900',
  read_only: 'border-stone-200 bg-stone-100 text-stone-700',
};

export const SOFIA_STATUS_TONE_DOT_CLASS: Record<SofiaStatusTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  blocked: 'bg-red-500',
  pending: 'bg-sky-500',
  unknown: 'bg-orange-500',
  failed: 'bg-red-600',
  human_required: 'bg-amber-600',
  read_only: 'bg-stone-400',
};

/**
 * Variante oscura de `SOFIA_STATUS_TONE_BADGE_CLASS`, solo para la Torre
 * de Control (`console-theme.ts`). Chips translúcidos con borde de color
 * en vez de fondo pastel — el pastel claro es ilegible sobre fondo oscuro.
 * Texto en tono 300 verificado con contraste >4.5:1 sobre el shell violeta-carbón.
 */
export const SOFIA_STATUS_TONE_CONSOLE_BADGE_CLASS: Record<SofiaStatusTone, string> = {
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  blocked: 'border-red-400/30 bg-red-400/10 text-red-300',
  pending: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  unknown: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  failed: 'border-red-400/40 bg-red-400/15 text-red-200',
  human_required: 'border-amber-400/40 bg-amber-400/15 text-amber-200',
  read_only: 'border-white/15 bg-white/[0.06] text-white/65',
};

export const SOFIA_STATUS_TONE_CONSOLE_DOT_CLASS: Record<SofiaStatusTone, string> = {
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  blocked: 'bg-red-400',
  pending: 'bg-sky-400',
  unknown: 'bg-orange-400',
  failed: 'bg-red-400',
  human_required: 'bg-amber-400',
  read_only: 'bg-white/40',
};

/** Mapea los estados PASS/WARNING/BLOCKED del backend (readiness, checklist) a SofiaStatusTone. */
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

/** Mapea estados de SecureCommand a SofiaStatusTone. */
export function toneFromCommandStatus(status: string): SofiaStatusTone {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'APPROVAL_REQUIRED') return 'human_required';
  if (status === 'REJECTED' || status === 'FAILED') return 'failed';
  if (status === 'EXPIRED') return 'blocked';
  return 'pending';
}
