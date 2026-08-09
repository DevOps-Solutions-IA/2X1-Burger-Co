import { WhatsappInboundEventKind } from '@prisma/client';
import type { WhatsappInboundClaimInput } from './whatsapp-production.repository';
import type { ProviderAccountObservation, WhatsappProductionProvider } from './whatsapp-production.types';

const PROVIDERS = new Set<WhatsappProductionProvider>(['qr_gateway', 'hermes', 'mock']);

export function normalizeWhatsappInboundClaimInput(input: WhatsappInboundClaimInput): WhatsappInboundClaimInput {
  const eventKind = WhatsappInboundEventKind[input.eventKind];
  if (!eventKind) throw new Error('WHATSAPP_INBOUND_EVENT_KIND_INVALID');

  return {
    accountId: bounded(input.accountId, 191, 'WHATSAPP_ACCOUNT_ID_INVALID'),
    provider: productionProvider(input.provider),
    eventId: bounded(input.eventId, 256, 'WHATSAPP_EVENT_ID_INVALID'),
    messageId: input.messageId === null ? null : bounded(input.messageId, 256, 'WHATSAPP_MESSAGE_ID_INVALID'),
    phone: normalizeClaimPhone(input.phone, input.eventKind),
    eventHash: bounded(input.eventHash, 128, 'WHATSAPP_EVENT_HASH_INVALID'),
    eventKind: input.eventKind,
    normalizedPayloadHash: bounded(
      input.normalizedPayloadHash,
      128,
      'WHATSAPP_NORMALIZED_PAYLOAD_HASH_INVALID',
    ),
  };
}

export function normalizeProviderAccountObservation(
  observation: ProviderAccountObservation,
): ProviderAccountObservation {
  return {
    provider: productionProvider(observation.provider),
    externalAccountId: bounded(observation.externalAccountId, 256, 'WHATSAPP_ACCOUNT_OBSERVATION_INVALID'),
    businessIdentity: bounded(observation.businessIdentity, 256, 'WHATSAPP_BUSINESS_IDENTITY_INVALID'),
    sessionOwner: bounded(observation.sessionOwner, 256, 'WHATSAPP_SESSION_OWNER_INVALID'),
  };
}

export function normalizeInboundSender(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  const normalized = digits.startsWith('57') ? digits : digits.length === 10 ? `57${digits}` : digits;
  if (normalized.length < 8 || normalized.length > 15) throw new Error('WHATSAPP_SENDER_INVALID');
  return normalized;
}

function normalizeClaimPhone(value: string, eventKind: WhatsappInboundEventKind) {
  if (eventKind !== WhatsappInboundEventKind.INBOUND_MESSAGE && value === 'SYSTEM') return value;
  return normalizeInboundSender(value);
}

function productionProvider(value: string): WhatsappProductionProvider {
  if (!PROVIDERS.has(value as WhatsappProductionProvider)) throw new Error('WHATSAPP_PROVIDER_UNSUPPORTED');
  return value as WhatsappProductionProvider;
}

function bounded(value: unknown, maxLength: number, code: string) {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || hasControlCharacters(normalized)) throw new Error(code);
  return normalized;
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
