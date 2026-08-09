import type { WhatsappMode, WhatsappProviderName } from '../whatsapp-provider.adapter';

const RESULT_CHECKPOINT_KIND = 'SOFIA_CONVERSATION_RESULT_V1';
const STARTED_CHECKPOINT_KIND = 'SOFIA_CONVERSATION_STARTED_V1';
const OUTBOUND_STATUSES = new Set(['APPROVAL_PENDING', 'SUGGESTED', 'QUEUED']);

export type WhatsappInboundConversationCheckpoint = Readonly<{
  kind: typeof RESULT_CHECKPOINT_KIND;
  eventHash: string;
  conversationId: string;
  inboundMessageId: string;
  mode: WhatsappMode;
  provider: WhatsappProviderName;
  responseText: string;
  confidence: number;
  businessOpen: boolean;
  shouldHandoff: boolean;
  handoffApplied: boolean;
  mediaUrl: string | null;
  outboundStatus: string | null;
}>;

export type WhatsappInboundConversationStartedCheckpoint = Readonly<{
  kind: typeof STARTED_CHECKPOINT_KIND;
  eventHash: string;
  conversationId: string;
  inboundMessageId: string;
  mode: WhatsappMode;
  provider: WhatsappProviderName;
}>;

export type WhatsappInboundDurableCheckpoint =
  | WhatsappInboundConversationCheckpoint
  | WhatsappInboundConversationStartedCheckpoint;

type CheckpointBinding = Pick<
  WhatsappInboundConversationCheckpoint,
  'eventHash' | 'conversationId' | 'inboundMessageId' | 'mode' | 'provider'
>;

export function createWhatsappInboundConversationCheckpoint(
  input: Omit<WhatsappInboundConversationCheckpoint, 'kind'>,
): WhatsappInboundConversationCheckpoint {
  const value = { ...input, kind: RESULT_CHECKPOINT_KIND };
  const parsed = parseWhatsappInboundDurableCheckpoint(value, {
    eventHash: input.eventHash,
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    mode: input.mode,
    provider: input.provider,
  });
  if (parsed?.kind !== RESULT_CHECKPOINT_KIND) throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  return parsed;
}

export function createWhatsappInboundConversationStartedCheckpoint(
  input: Omit<WhatsappInboundConversationStartedCheckpoint, 'kind'>,
): WhatsappInboundConversationStartedCheckpoint {
  const value = { ...input, kind: STARTED_CHECKPOINT_KIND };
  const parsed = parseWhatsappInboundDurableCheckpoint(value, input);
  if (parsed?.kind !== STARTED_CHECKPOINT_KIND) throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  return parsed;
}

export function parseWhatsappInboundDurableCheckpoint(
  value: unknown,
  binding: CheckpointBinding,
): WhatsappInboundDurableCheckpoint | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  }

  if (value.kind === STARTED_CHECKPOINT_KIND) {
    const checkpoint = Object.freeze({
      kind: STARTED_CHECKPOINT_KIND,
      eventHash: bounded(value.eventHash, 128),
      conversationId: bounded(value.conversationId, 191),
      inboundMessageId: bounded(value.inboundMessageId, 191),
      mode: bounded(value.mode, 32) as WhatsappMode,
      provider: bounded(value.provider, 32) as WhatsappProviderName,
    });
    assertBinding(checkpoint, binding);
    return checkpoint;
  }
  if (value.kind !== RESULT_CHECKPOINT_KIND) throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');

  const checkpoint = freezeCheckpoint({
    kind: RESULT_CHECKPOINT_KIND,
    eventHash: bounded(value.eventHash, 128),
    conversationId: bounded(value.conversationId, 191),
    inboundMessageId: bounded(value.inboundMessageId, 191),
    mode: bounded(value.mode, 32) as WhatsappMode,
    provider: bounded(value.provider, 32) as WhatsappProviderName,
    responseText: bounded(value.responseText, 4_000, true),
    confidence: finiteConfidence(value.confidence),
    businessOpen: requiredBoolean(value.businessOpen),
    shouldHandoff: requiredBoolean(value.shouldHandoff),
    handoffApplied: requiredBoolean(value.handoffApplied),
    mediaUrl: nullableBounded(value.mediaUrl, 2_048),
    outboundStatus: nullableOutboundStatus(value.outboundStatus),
  });

  assertBinding(checkpoint, binding);
  return checkpoint;
}

function assertBinding(checkpoint: CheckpointBinding, binding: CheckpointBinding) {
  if (
    checkpoint.eventHash !== binding.eventHash
    || checkpoint.conversationId !== binding.conversationId
    || checkpoint.inboundMessageId !== binding.inboundMessageId
    || checkpoint.mode !== binding.mode
    || checkpoint.provider !== binding.provider
  ) {
    throw new Error('WHATSAPP_INBOUND_CHECKPOINT_BINDING_MISMATCH');
  }
}

function freezeCheckpoint(
  value: WhatsappInboundConversationCheckpoint,
): WhatsappInboundConversationCheckpoint {
  return Object.freeze(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bounded(value: unknown, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  }
  if (!allowEmpty && !value) throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  const unsafeControl = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
  if (unsafeControl) throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  return value;
}

function nullableBounded(value: unknown, maxLength: number): string | null {
  return value === null ? null : bounded(value, maxLength);
}

function finiteConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  }
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  return value;
}

function nullableOutboundStatus(value: unknown): string | null {
  if (value === null) return null;
  const status = bounded(value, 32);
  if (!OUTBOUND_STATUSES.has(status)) throw new Error('WHATSAPP_INBOUND_CHECKPOINT_INVALID');
  return status;
}
