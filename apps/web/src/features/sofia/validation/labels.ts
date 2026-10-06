import {
  Bot,
  ClipboardList,
  CreditCard,
  LifeBuoy,
  MessageSquare,
  PackageMinus,
  Receipt,
  ShieldCheck,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
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

/** Icono consistente por tipo de comando — misma iconografía en fila y detalle. */
export const SECURE_COMMAND_TYPE_ICON: Record<SecureCommandType, LucideIcon> = {
  SOFIA_INTERNAL_VALIDATE: ShieldCheck,
  SOFIA_CREATE_ORDER: ClipboardList,
  SOFIA_SEND_WHATSAPP: MessageSquare,
  SOFIA_MARK_PAYMENT: CreditCard,
  SOFIA_DEDUCT_STOCK: PackageMinus,
  SOFIA_MUTATE_CASH: Wallet,
  SOFIA_CREATE_SALE: Receipt,
  SOFIA_ASSIGN_DELIVERY: Truck,
  SOFIA_CUSTOMER_AUTO_RESPONSE: Bot,
};

export function secureCommandTypeIcon(commandType: string): LucideIcon {
  return SECURE_COMMAND_TYPE_ICON[commandType as SecureCommandType] ?? ShieldCheck;
}

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

/** Icono único de escalación de servicio al cliente — la categoría es texto libre del backend. */
export const CASE_ICON: LucideIcon = LifeBuoy;

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

/**
 * Clases de "avatar" de icono coherentes con el tono de `StatusBadge`
 * (mismos pares borde/fondo/texto) para que la fila y el detalle usen
 * exactamente la misma semántica de color en toda la superficie.
 */
export const TONE_AVATAR_CLASS: Record<SofiaStatusTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  blocked: 'border-red-200 bg-red-50 text-red-700',
  pending: 'border-sky-200 bg-sky-50 text-sky-700',
  unknown: 'border-orange-200 bg-orange-50 text-orange-800',
  failed: 'border-red-300 bg-red-100 text-red-800',
  human_required: 'border-amber-300 bg-amber-100 text-amber-800',
  read_only: 'border-stone-200 bg-stone-100 text-stone-600',
};

/**
 * Misma semántica que `TONE_AVATAR_CLASS`, en la paleta oscura de la Torre
 * de Control (`console-theme.ts`). Usado por CommandsPanel/CasesPanel
 * cuando el panel se renderiza dentro del shell oscuro.
 */
export const TONE_AVATAR_CLASS_CONSOLE: Record<SofiaStatusTone, string> = {
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  blocked: 'border-red-400/30 bg-red-400/10 text-red-300',
  pending: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  unknown: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  failed: 'border-red-400/40 bg-red-400/15 text-red-300',
  human_required: 'border-amber-400/40 bg-amber-400/15 text-amber-300',
  read_only: 'border-white/15 bg-white/[0.06] text-white/60',
};
