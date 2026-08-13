import { apiFetchSchema } from '@/lib/api';
import {
  auditPageSchema,
  enterpriseStatusSchema,
  operationsStatusSchema,
  qrStatusSchema,
  rolesSchema,
  runtimeSafetySchema,
  settingsSchema,
  usersSchema,
} from './contracts';

export function fetchUsers() {
  return apiFetchSchema('/users', usersSchema);
}

export function fetchRoles() {
  return apiFetchSchema('/roles', rolesSchema);
}

export function fetchAuditEvents(query: string) {
  return apiFetchSchema(`/audit?${query}`, auditPageSchema);
}

export function fetchSettings() {
  return apiFetchSchema('/settings', settingsSchema);
}

export function fetchOperationsStatus() {
  return apiFetchSchema('/settings/operations-status', operationsStatusSchema);
}

export function fetchEnterpriseStatus() {
  return apiFetchSchema('/admin/sofia/enterprise-status', enterpriseStatusSchema);
}

export function fetchRuntimeSafety() {
  return apiFetchSchema('/admin/sofia/runtime-safety', runtimeSafetySchema);
}

export function fetchQrStatus() {
  return apiFetchSchema('/admin/sofia/whatsapp/qr/status', qrStatusSchema);
}

export function errorIsPermissionDenied(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Fecha inválida';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(date);
}

export function humanize(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}
