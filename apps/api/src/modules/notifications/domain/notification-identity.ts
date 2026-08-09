import { createHash } from 'node:crypto';
import type { NotificationIdempotencyBinding } from './notification.types';

export const NOTIFICATION_HASH_NAMESPACE = 'customer-service:notification-hash:v1';
export const NOTIFICATION_IDEMPOTENCY_NAMESPACE = 'customer-service:notification:v1';

const HASH = /^[a-f0-9]{64}$/;
const SAFE_COMPONENT = /^[A-Za-z0-9._:-]{1,128}$/;

export class NotificationIdentityError extends Error {
  constructor(readonly code: 'NOTIFICATION_IDEMPOTENCY_BINDING_INVALID' | 'NOTIFICATION_HASH_VALUE_UNSUPPORTED') {
    super(code);
    this.name = 'NotificationIdentityError';
  }
}

function canonical(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NotificationIdentityError('NOTIFICATION_HASH_VALUE_UNSUPPORTED');
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new NotificationIdentityError('NOTIFICATION_HASH_VALUE_UNSUPPORTED');
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new NotificationIdentityError('NOTIFICATION_HASH_VALUE_UNSUPPORTED');
    seen.add(value);
    const normalized = value.map((entry) => canonical(entry, seen));
    seen.delete(value);
    return normalized;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new NotificationIdentityError('NOTIFICATION_HASH_VALUE_UNSUPPORTED');
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new NotificationIdentityError('NOTIFICATION_HASH_VALUE_UNSUPPORTED');
    }
    seen.add(value);
    const normalized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry, seen)]),
    );
    seen.delete(value);
    return normalized;
  }
  throw new NotificationIdentityError('NOTIFICATION_HASH_VALUE_UNSUPPORTED');
}

function namespacedHash(namespace: string, value: unknown): string {
  const serialized = JSON.stringify(canonical(value, new Set()));
  return createHash('sha256').update(`${namespace}\0${serialized}`, 'utf8').digest('hex');
}

export function deterministicNotificationHash(value: unknown): string {
  return namespacedHash(NOTIFICATION_HASH_NAMESPACE, value);
}

export function notificationRecipientIdentityHash(identity: string): string {
  const normalized = identity.normalize('NFKC').trim().toLowerCase();
  if (!normalized) throw new NotificationIdentityError('NOTIFICATION_IDEMPOTENCY_BINDING_INVALID');
  return namespacedHash(`${NOTIFICATION_HASH_NAMESPACE}:recipient`, normalized);
}

function validOpaqueBinding(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 && Array.from(normalized).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  });
}

export function createNotificationIdempotencyKey(binding: NotificationIdempotencyBinding): string {
  if (
    !SAFE_COMPONENT.test(binding.scope)
    || !validOpaqueBinding(binding.complaintId)
    || !validOpaqueBinding(binding.eventId)
    || !SAFE_COMPONENT.test(binding.templateVersion)
    || !HASH.test(binding.recipientIdentityHash)
    || !HASH.test(binding.factsHash)
  ) {
    throw new NotificationIdentityError('NOTIFICATION_IDEMPOTENCY_BINDING_INVALID');
  }
  const digest = namespacedHash(NOTIFICATION_IDEMPOTENCY_NAMESPACE, {
    ...binding,
    complaintId: binding.complaintId.trim(),
    eventId: binding.eventId.trim(),
  });
  return `${NOTIFICATION_IDEMPOTENCY_NAMESPACE}:${digest}`;
}
