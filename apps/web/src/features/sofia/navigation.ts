/**
 * Arquitectura de información de la Torre de Control SOFIA + CRM.
 *
 * Dos secciones de nivel superior, conceptualmente distintas:
 * - Torre de Control (`/sofia`): mando, control, validación y verificación
 *   del comportamiento/tasa de éxito del agente SOFIA. Nunca aloja
 *   registros de negocio (pedidos/pagos/domicilios) — esos viven en POS,
 *   Domicilios y Caja como siempre.
 * - CRM (`/sofia/crm`): relación comercial con el cliente — pipeline de
 *   leads, tareas, notas, segmentos, campañas (envío bloqueado por diseño).
 */

export type SofiaNavSection = {
  key: string;
  label: string;
  href: string;
  description: string;
};

export const SOFIA_CONTROL_TOWER_SECTIONS: SofiaNavSection[] = [
  {
    key: 'overview',
    label: 'Resumen',
    href: '/sofia',
    description: 'KPIs del día: tasa de aprobación, conversaciones activas, aprobaciones pendientes, salud del sistema.',
  },
  {
    key: 'performance',
    label: 'Rendimiento',
    href: '/sofia/performance',
    description: 'Comportamiento y tasa de éxito real de SOFIA: embudo de conversaciones, aprobación/escalado/bloqueo, precisión de catálogo.',
  },
  {
    key: 'validation',
    label: 'Validación',
    href: '/sofia/validation',
    description: 'Comandos gobernados (SecureCommand) y casos de servicio al cliente que SOFIA escaló a un humano.',
  },
  {
    key: 'conversations',
    label: 'Conversaciones',
    href: '/sofia/conversations',
    description: 'Bandeja de conversaciones reales, de validación interna, sandbox e históricas.',
  },
  {
    key: 'safety',
    label: 'Seguridad',
    href: '/sofia/safety',
    description: 'Runtime safety, gobernanza (pausar/kill-switch), readiness de producción y auditoría.',
  },
  {
    key: 'whatsapp-qr',
    label: 'Canal WhatsApp',
    href: '/sofia/whatsapp-qr',
    description: 'Estado de vinculación del canal QR, receive-only.',
  },
];

export const SOFIA_CRM_SECTIONS: SofiaNavSection[] = [
  {
    key: 'customers',
    label: 'Clientes',
    href: '/sofia/crm',
    description: 'Directorio de clientes con identidad enmascarada, tags y segmentos.',
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    href: '/sofia/crm/pipeline',
    description: 'Leads agrupados por etapa, con historial de transición auditado.',
  },
  {
    key: 'segments',
    label: 'Segmentos',
    href: '/sofia/crm/segments',
    description: 'Segmentos de clientes y su membresía.',
  },
  {
    key: 'campaigns',
    label: 'Campañas',
    href: '/sofia/crm/campaigns',
    description: 'Campañas de WhatsApp por segmento. Envío real siempre bloqueado por diseño.',
  },
  {
    key: 'tasks',
    label: 'Tareas',
    href: '/sofia/crm/tasks',
    description: 'Tareas y seguimientos vinculados a leads, clientes o casos.',
  },
];

export type SofiaCustomer360SectionKey =
  | 'identity'
  | 'consents'
  | 'tags'
  | 'segments'
  | 'activity'
  | 'lead'
  | 'tasks'
  | 'notes'
  | 'cases';

export type SofiaCustomer360Section = {
  key: SofiaCustomer360SectionKey;
  label: string;
  description: string;
};

export const SOFIA_CUSTOMER_360_SECTIONS: SofiaCustomer360Section[] = [
  { key: 'identity', label: 'Identidad', description: 'Identidades enmascaradas, estado del cliente y fechas de registro.' },
  { key: 'tags', label: 'Tags', description: 'Etiquetas asignadas al cliente.' },
  { key: 'segments', label: 'Segmentos', description: 'Segmentos a los que pertenece el cliente.' },
  { key: 'consents', label: 'Consentimientos', description: 'Consentimientos de contacto por canal y propósito, con evidencia.' },
  { key: 'activity', label: 'Actividad', description: 'Línea de tiempo de interacciones registradas por el backend.' },
  { key: 'lead', label: 'Pipeline', description: 'Leads del cliente en el pipeline de ventas.' },
  { key: 'tasks', label: 'Tareas', description: 'Tareas de seguimiento vinculadas a este cliente.' },
  { key: 'notes', label: 'Notas', description: 'Notas internas del equipo sobre este cliente.' },
  { key: 'cases', label: 'Casos', description: 'Casos de servicio al cliente vinculados (filtrado por customerId).' },
];

export function findActiveSection(sections: SofiaNavSection[], pathname: string) {
  return sections.find(
    (section) => pathname === section.href || (section.href !== '/sofia' && section.href !== '/sofia/crm' && pathname.startsWith(`${section.href}/`)),
  );
}
