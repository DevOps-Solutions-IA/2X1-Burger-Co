/**
 * Sofía Status Humanization — 8A.2 Clean Governance Dashboard
 *
 * Translates raw backend technical codes into human-readable enterprise labels.
 * Technical codes are preserved for debugging in collapsed "Detalle técnico" sections.
 */

/* ------------------------------------------------------------------ */
/*  Overall status                                                    */
/* ------------------------------------------------------------------ */

export const OVERALL_STATUS_LABELS: Record<string, string> = {
  READY_FOR_SANDBOX: 'Sandbox listo',
  BLOCKED_FOR_PRODUCTION: 'Producción bloqueada',
  WARNING: 'Precaución',
  ERROR: 'Error',
};

export function humanizeOverallStatus(code: string): string {
  return OVERALL_STATUS_LABELS[code] ?? code;
}

/* ------------------------------------------------------------------ */
/*  Security / Readiness codes                                        */
/* ------------------------------------------------------------------ */

export const SECURITY_STATUS_LABELS: Record<string, string> = {
  COMPLETE: 'Completada',
  PENDING: 'Pendiente',
  UNKNOWN: 'Desconocido',
  SECRET_ROTATION_PENDING: 'Governance pendiente de sincronización',
  SECRET_ROTATION_COMPLETE: 'Rotación completada',
};

export function humanizeSecurityStatus(code: string): string {
  return SECURITY_STATUS_LABELS[code] ?? code;
}

/* ------------------------------------------------------------------ */
/*  Blockers & reason codes                                           */
/* ------------------------------------------------------------------ */

export const BLOCKER_LABELS: Record<string, string> = {
  DEEPSEEK_REAL_DISABLED: 'DeepSeek real desactivado hasta piloto F9',
  AUTO_SAFE_PRODUCTION_DISABLED: 'Auto Safe productivo desactivado',
  REAL_SEND_DISABLED: 'Envío real WhatsApp bloqueado',
  PRODUCTION_NOT_READY: 'Producción aún no lista',
  QR_NOT_READY: 'QR físico pendiente de validación',
  SECRET_ROTATION_PENDING: 'Governance pendiente de sincronización',
};

export const REASON_CODE_LABELS: Record<string, string> = {
  ADDRESS_MISSING: 'Falta dirección del cliente',
  CUSTOMER_NAME_MISSING: 'Falta nombre del cliente',
  ORDER_CONFIRMATION_MISSING: 'Falta confirmación del pedido',
  CASH_OR_NEQUI_VERIFICATION_REQUIRED: 'Pago manual requiere verificación',
  PAYMENT_SENSITIVE: 'Pago sensible: requiere revisión humana',
  UNKNOWN_PRODUCT: 'Producto no reconocido',
  LOW_CONFIDENCE: 'Baja confianza: requiere revisión',
  DUPLICATE_IGNORED: 'Duplicado ignorado',
  AUTO_SAFE_DISABLED: 'Auto Safe productivo desactivado',
  HUMAN_REQUESTED: 'Cliente pidió atención humana',
  QR_NOT_READY: 'QR físico pendiente',
  REAL_SEND_BLOCKED: 'Envío real bloqueado por diseño',
  SANDBOX_ONLY: 'Solo sandbox permitido',
  OUTSIDE_BUSINESS_HOURS: 'Fuera de horario comercial',
  MAX_RETRIES_EXCEEDED: 'Máximo de reintentos excedido',
  ALLOWLIST_BLOCKED: 'Remitente no autorizado',
  PHONE_NOT_IN_ALLOWLIST: 'Teléfono no está en allowlist',
};

export function humanizeReasonCode(code: string): string {
  return REASON_CODE_LABELS[code] ?? code;
}

export function humanizeBlocker(code: string): string {
  return BLOCKER_LABELS[code] ?? code;
}

/* ------------------------------------------------------------------ */
/*  Event types                                                       */
/* ------------------------------------------------------------------ */

export const EVENT_TYPE_LABELS: Record<string, string> = {
  AUTO_SAFE_DECISION: 'Auto Safe — Decisión',
  SOFIA_GOVERNANCE_GLOBAL_PAUSE: 'Sofía pausada globalmente',
  SOFIA_GOVERNANCE_GLOBAL_RESUME: 'Sofía reactivada en modo gobernado',
  QR_STATUS_CHANGE: 'QR Gateway — Cambio de estado',
  CONVERSATION_CREATED: 'Nueva conversación',
  CONVERSATION_RESOLVED: 'Conversación resuelta',
  OUTBOUND_SUGGESTED: 'Mensaje sugerido',
  OUTBOUND_APPROVED: 'Mensaje aprobado',
  OUTBOUND_BLOCKED: 'Envío bloqueado',
  SANDBOX_MESSAGE_PROCESSED: 'Sandbox — Mensaje procesado',
  CATALOG_UPDATED: 'Catálogo actualizado',
  PROMPT_UPDATED: 'Prompt actualizado',
  SECURITY_ALERT: 'Alerta de seguridad',
  SYSTEM_HEALTH: 'Health check',
};

export function humanizeEventType(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

export function humanizeEventStatus(status: string): string {
  const labels: Record<string, string> = {
    BLOCKED: 'Bloqueado',
    APPROVED: 'Aprobado',
    HUMAN_REQUIRED: 'Requiere humano',
    DRAFT_ONLY: 'Solo borrador',
    PASS: 'Correcto',
    WARNING: 'Precaución',
    ERROR: 'Error',
    CONNECTED: 'Conectado',
    DISCONNECTED: 'Desconectado',
    PENDING: 'Pendiente',
    COMPLETE: 'Completado',
  };
  return labels[status] ?? status;
}

/* ------------------------------------------------------------------ */
/*  Fallback placeholders                                             */
/* ------------------------------------------------------------------ */

export function isFallbackCode(code: string): boolean {
  return code.startsWith('SIN_');
}

export function humanizeFallback(code: string): string {
  if (code === 'SIN_REASON_CODES') return 'Sin códigos de razón registrados';
  if (code === 'SIN_DECISIONES_HOY') return 'Sin decisiones hoy';
  if (code === 'SIN_INSIGHTS') return 'Sin recomendaciones';
  if (code === 'SIN_EVENTOS') return 'Sin eventos recientes';
  return 'Sin datos';
}

/* ------------------------------------------------------------------ */
/*  Check status (PASS / WARNING / BLOCKED)                           */
/* ------------------------------------------------------------------ */

export function humanizeCheckStatus(status: string): string {
  const labels: Record<string, string> = {
    PASS: 'Listo',
    WARNING: 'Precaución',
    BLOCKED: 'Bloqueado',
  };
  return labels[status] ?? status;
}
