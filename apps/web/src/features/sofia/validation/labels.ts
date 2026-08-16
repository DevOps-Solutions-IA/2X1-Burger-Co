import type { SofiaStatusTone } from '@/components/sofia';
import type { SecureCommandStatus, SecureCommandType } from '@/features/sofia/contracts';

/* ------------------------------------------------------------------ */
/*  Comandos gobernados (SecureCommand)                                */
/* ------------------------------------------------------------------ */

export const SECURE_COMMAND_STATUS_LABEL: Record<SecureCommandStatus, string> = {
  RECEIVED: 'Recibido',
  VALIDATED: 'Validado',
  APPROVAL_REQUIRED: 'Requiere aprobación',
  APPROVED: 'Aprobado',
  CLAIMED: 'Reclamado',
  EXECUTING: 'Ejecutando',
  SUCCEEDED: 'Completado',
  FAILED: 'Falló',
  REJECTED: 'Rechazado',
  EXPIRED: 'Expirado',
};

export const SECURE_COMMAND_TYPE_LABEL: Record<SecureCommandType, string> = {
  SOFIA_INTERNAL_VALIDATE: 'Validación interna',
  SOFIA_CREATE_ORDER: 'Crear pedido',
  SOFIA_SEND_WHATSAPP: 'Enviar WhatsApp',
  SOFIA_MARK_PAYMENT: 'Marcar pago',
  SOFIA_DEDUCT_STOCK: 'Descontar stock',
  SOFIA_MUTATE_CASH: 'Mover caja',
  SOFIA_CREATE_SALE: 'Crear venta',
  SOFIA_ASSIGN_DELIVERY: 'Asignar domicilio',
  SOFIA_CUSTOMER_AUTO_RESPONSE: 'Respuesta automática al cliente',
};

/** Estados terminales de un SecureCommand: ya no admiten aprobación ni rechazo. */
export const SECURE_COMMAND_TERMINAL_STATUSES: SecureCommandStatus[] = ['SUCCEEDED', 'REJECTED', 'EXPIRED', 'FAILED'];

export function isSecureCommandActionable(status: SecureCommandStatus): boolean {
  return status === 'APPROVAL_REQUIRED';
}

export function secureCommandTypeLabel(commandType: string): string {
  return SECURE_COMMAND_TYPE_LABEL[commandType as SecureCommandType] ?? commandType;
}

export function secureCommandStatusLabel(status: string): string {
  return SECURE_COMMAND_STATUS_LABEL[status as SecureCommandStatus] ?? status;
}

/* ------------------------------------------------------------------ */
/*  Casos de servicio al cliente (escalaciones de SOFIA)                */
/* ------------------------------------------------------------------ */

export type SofiaCustomerServiceCaseStatus = 'OPEN' | 'HUMAN_REQUIRED' | 'HUMAN_TAKEN' | 'RESOLVED' | 'CLOSED';

export const CASE_STATUS_LABEL: Record<SofiaCustomerServiceCaseStatus, string> = {
  OPEN: 'Abierto',
  HUMAN_REQUIRED: 'Requiere humano',
  HUMAN_TAKEN: 'Tomado por humano',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
};

/** Máquina de estados lineal real del backend: solo el siguiente estado es válido, nunca se salta. */
const CASE_STATUS_ORDER: SofiaCustomerServiceCaseStatus[] = [
  'OPEN',
  'HUMAN_REQUIRED',
  'HUMAN_TAKEN',
  'RESOLVED',
  'CLOSED',
];

export function caseStatusLabel(status: string): string {
  return CASE_STATUS_LABEL[status as SofiaCustomerServiceCaseStatus] ?? status;
}

export function toneFromCaseStatus(status: string): SofiaStatusTone {
  switch (status as SofiaCustomerServiceCaseStatus) {
    case 'OPEN':
      return 'pending';
    case 'HUMAN_REQUIRED':
      return 'human_required';
    case 'HUMAN_TAKEN':
      return 'warning';
    case 'RESOLVED':
      return 'success';
    case 'CLOSED':
      return 'read_only';
    default:
      return 'unknown';
  }
}

/** Único siguiente estado válido para un caso, o null si ya está en un estado terminal (CLOSED). */
export function nextCaseStatus(status: string): SofiaCustomerServiceCaseStatus | null {
  const index = CASE_STATUS_ORDER.indexOf(status as SofiaCustomerServiceCaseStatus);
  if (index === -1 || index === CASE_STATUS_ORDER.length - 1) {
    return null;
  }
  return CASE_STATUS_ORDER[index + 1] ?? null;
}

export function formatCaseCategory(category: string): string {
  return category
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Trunca un id de registro de negocio (POS/Domicilios/Caja) solo para referencia visual — nunca se embebe el objeto completo. */
export function truncateReferenceId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}
