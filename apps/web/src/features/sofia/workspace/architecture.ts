/**
 * Arquitectura de información del workspace SOFIA + CRM — Fase A.
 *
 * Esta es la fuente de verdad tipada que alimenta la navegación local
 * (WorkspaceTabs) de ambos workspaces. Cada sección declara honestamente
 * si su capacidad está conectada a datos reales ("active") o si pertenece
 * a una fase posterior del programa ("pending_phase") — en ese segundo
 * caso la ruta existe y es navegable, pero su contenido es un aviso
 * explícito de disponibilidad futura, nunca datos fabricados.
 */

export type SofiaWorkspaceSectionStatus = 'active' | 'pending_phase';

export type SofiaWorkspaceSection = {
  key: string;
  label: string;
  href: string;
  status: SofiaWorkspaceSectionStatus;
  /** Fase del programa que conecta esta capacidad (solo si status = 'pending_phase'). */
  pendingPhase?: string;
  description: string;
};

export const SOFIA_OPERATOR_SECTIONS: SofiaWorkspaceSection[] = [
  {
    key: 'overview',
    label: 'Resumen',
    href: '/sofia',
    status: 'active',
    description: 'Estado operativo consolidado: modo, seguridad, WhatsApp, IA y conversaciones.',
  },
  {
    key: 'conversations',
    label: 'Conversaciones',
    href: '/sofia/conversations',
    status: 'active',
    description: 'Bandeja de conversaciones reales, de validación interna, sandbox e históricas.',
  },
  {
    key: 'commands',
    label: 'Comandos',
    href: '/sofia/commands',
    status: 'pending_phase',
    pendingPhase: 'Fase E — SecureCommand',
    description: 'Ejecución gobernada de comandos sensibles vía SecureCommand.',
  },
  {
    key: 'orders',
    label: 'Pedidos',
    href: '/sofia/orders',
    status: 'pending_phase',
    pendingPhase: 'Fase H — Checkout y pedidos',
    description: 'Pedidos generados desde conversaciones, con orquestación canónica de backend.',
  },
  {
    key: 'payments',
    label: 'Pagos',
    href: '/sofia/payments',
    status: 'pending_phase',
    pendingPhase: 'Fase I — Pagos',
    description: 'Estado financiero autoritativo, incluyendo resultados desconocidos y revisión.',
  },
  {
    key: 'delivery',
    label: 'Domicilios',
    href: '/sofia/delivery',
    status: 'pending_phase',
    pendingPhase: 'Fase J — Domicilios y notificaciones',
    description: 'Estado canónico de entrega y notificaciones asociadas.',
  },
  {
    key: 'customer-service',
    label: 'Servicio al cliente',
    href: '/sofia/customer-service',
    status: 'pending_phase',
    pendingPhase: 'Fase K — Servicio al cliente',
    description: 'Casos de servicio al cliente y autoridad de recuperación gobernada.',
  },
  {
    key: 'runtime',
    label: 'Runtime / Seguridad',
    href: '/sofia/runtime',
    status: 'active',
    description: 'Readiness de producción, bloqueadores activos y vinculación de WhatsApp.',
  },
  {
    key: 'audit',
    label: 'Auditoría',
    href: '/sofia/audit',
    status: 'active',
    description: 'Eventos de gobernanza y alertas del sistema.',
  },
];

export type SofiaCustomer360SectionKey =
  | 'identity'
  | 'consents'
  | 'activity'
  | 'tags'
  | 'conversations'
  | 'orders'
  | 'payments'
  | 'deliveries'
  | 'cases'
  | 'notes';

export type SofiaCustomer360Section = {
  key: SofiaCustomer360SectionKey;
  label: string;
  status: SofiaWorkspaceSectionStatus;
  pendingPhase?: string;
  description: string;
};

/** Pestañas de Customer 360, aggregando lo que el contrato actual expone y lo que aún no. */
export const SOFIA_CUSTOMER_360_SECTIONS: SofiaCustomer360Section[] = [
  {
    key: 'identity',
    label: 'Identidad',
    status: 'active',
    description: 'Identidades enmascaradas, estado del cliente y fechas de registro.',
  },
  {
    key: 'tags',
    label: 'Tags',
    status: 'active',
    description: 'Etiquetas asignadas al cliente.',
  },
  {
    key: 'consents',
    label: 'Consentimientos',
    status: 'active',
    description: 'Consentimientos de contacto por canal y propósito, con evidencia.',
  },
  {
    key: 'activity',
    label: 'Actividad',
    status: 'active',
    description: 'Línea de tiempo de interacciones registradas por el backend.',
  },
  {
    key: 'conversations',
    label: 'Conversaciones',
    status: 'pending_phase',
    pendingPhase: 'Fase F — Conversaciones y WhatsApp inbound',
    description: 'Conversaciones vinculadas a este cliente.',
  },
  {
    key: 'orders',
    label: 'Pedidos',
    status: 'pending_phase',
    pendingPhase: 'Fase H — Checkout y pedidos',
    description: 'Pedidos vinculados a este cliente.',
  },
  {
    key: 'payments',
    label: 'Pagos',
    status: 'pending_phase',
    pendingPhase: 'Fase I — Pagos',
    description: 'Pagos vinculados a este cliente.',
  },
  {
    key: 'deliveries',
    label: 'Entregas',
    status: 'pending_phase',
    pendingPhase: 'Fase J — Domicilios y notificaciones',
    description: 'Entregas vinculadas a este cliente.',
  },
  {
    key: 'cases',
    label: 'Casos',
    status: 'pending_phase',
    pendingPhase: 'Fase K — Servicio al cliente',
    description: 'Casos de servicio al cliente vinculados a este cliente.',
  },
  {
    key: 'notes',
    label: 'Notas',
    status: 'pending_phase',
    pendingPhase: 'Fase G — CRM y Customer 360 (extensión)',
    description: 'Notas internas del equipo sobre este cliente.',
  },
];

export function findActiveSection(sections: SofiaWorkspaceSection[], pathname: string) {
  return sections.find(
    (section) => pathname === section.href || (section.href !== '/sofia' && pathname.startsWith(`${section.href}/`)),
  );
}
