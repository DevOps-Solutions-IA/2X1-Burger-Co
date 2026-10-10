/**
 * Traducción de códigos y mensajes técnicos crudos que emite el backend de
 * SOFIA (QR Gateway, runtime safety, readiness de producción) a copy
 * profesional en español, sin jerga interna. El string crudo original solo
 * puede verse dentro de una vista técnica explícitamente colapsada
 * ("Detalle técnico de runtime safety") — nunca en la vista principal.
 *
 * Siempre con fallback al string crudo: si el backend agrega un código
 * nuevo que todavía no está mapeado aquí, se muestra tal cual en vez de
 * romper la UI — mejor un código sin traducir que un render vacío.
 */

/** `SofiaQrStatus.blockers` — códigos fijos devueltos por `blockers()` en el QR Gateway. */
const QR_BLOCKER_LABEL: Record<string, string> = {
  REAL_SEND_DISABLED: 'Envío real de WhatsApp desactivado (por diseño)',
  AUTO_SAFE_PRODUCTION_DISABLED: 'Automatización en producción desactivada',
  DEEPSEEK_REAL_DISABLED: 'Motor de IA en modo simulación',
};

/** `SofiaQrStatus.warnings` — strings fijos devueltos por `getStatus()` en el QR Gateway. */
const QR_WARNING_LABEL: Record<string, string> = {
  'F8B: adapter real Baileys activo en receive_only.':
    'WhatsApp: el adaptador real de conexión está activo, en modo solo-recepción.',
  'F8B: adapter real pendiente de iniciar; no hay QR/CONNECTED sin socket Baileys vivo.':
    'WhatsApp: el adaptador real aún no se ha iniciado — no es posible mostrar el código QR ni conectar hasta iniciar sesión.',
  'El envío real permanece bloqueado.': 'El envío real de mensajes permanece bloqueado por diseño.',
  'Escanea el QR con WhatsApp Business para conectar.':
    'Escanea el código QR con WhatsApp Business para conectar el canal.',
};

/** Traduce un blocker o warning crudo del QR Gateway a copy profesional en español. */
export function translateQrBlockerOrWarning(raw: string): string {
  return QR_BLOCKER_LABEL[raw] ?? QR_WARNING_LABEL[raw] ?? raw;
}

/**
 * `SofiaReadiness.blockers`/`.warnings` solo traen la `key` del item de
 * checklist correspondiente (ej. `secret_rotation`, `qr_gateway_real`). El
 * propio checklist ya trae un `label` humano en español para esa misma key
 * (ver `SofiaReadinessService.buildChecklist`), así que se reutiliza ese
 * label en vez de duplicar un diccionario — con fallback a la key cruda si
 * por algún motivo no aparece en el checklist recibido.
 */
export function readinessItemLabel(checklist: { key: string; label: string }[], key: string): string {
  return checklist.find((item) => item.key === key)?.label ?? key;
}
