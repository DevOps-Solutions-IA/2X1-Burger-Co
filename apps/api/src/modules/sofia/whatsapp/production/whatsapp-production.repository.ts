import type { Prisma, WhatsappDeliveryStatus, WhatsappInboundEventKind } from '@prisma/client';
import type { ConsentDecision, DeliveryStatusUpdate, ProviderAccountObservation } from './whatsapp-production.types';

export const WHATSAPP_PRODUCTION_REPOSITORY = Symbol('WhatsappProductionRepository');

export type WhatsappInboundClaimDisposition =
  | 'ACQUIRED'
  | 'IN_PROGRESS'
  | 'DETERMINISTIC_REPLAY'
  | 'ATTEMPTS_EXHAUSTED';

export type ClaimedInbound = {
  id: string;
  created: boolean;
  disposition: WhatsappInboundClaimDisposition;
  attempt: number;
  claimToken: string | null;
  leaseExpiresAt: Date | null;
  processingStatus: string;
  deterministicResult: unknown;
};

export type WhatsappInboundClaimContext = Readonly<{
  inboundEventId: string;
  claimToken: string;
  attempt: number;
  leaseExpiresAt: Date;
  recoveryCheckpoint: unknown;
}>;

export type WhatsappInboundClaimInput = {
  accountId: string;
  provider: string;
  eventId: string;
  messageId: string | null;
  phone: string;
  eventHash: string;
  eventKind: WhatsappInboundEventKind;
  normalizedPayloadHash: string;
};

export interface WhatsappProductionRepository {
  resolveAccount(observation: ProviderAccountObservation): Promise<{ id: string; status: string }>;
  claimInbound(input: WhatsappInboundClaimInput): Promise<ClaimedInbound>;
  renewInboundLease(id: string, claimToken: string): Promise<Date>;
  checkpointInbound(id: string, checkpoint: unknown, claimToken: string): Promise<void>;
  completeInbound(
    id: string,
    processingStatus: string,
    result: unknown,
    errorCode?: string | null,
    claimToken?: string | null,
  ): Promise<void>;
  consentDecision(customerId: string | null, purpose: 'SERVICE' | 'MARKETING'): Promise<ConsentDecision>;
  transitionHandoff(input: {
    conversationId: string;
    actorId: string;
    actorType?: 'USER' | 'SYSTEM';
    expectedVersion: number;
    previousState: string;
    nextState: string;
    reasonCode: string;
    status: 'ACTIVE' | 'HUMAN_REQUIRED' | 'HUMAN_TAKEN' | 'SOFIA_PAUSED' | 'RESOLVED' | 'ARCHIVED';
    sofiaEnabled: boolean;
    assignedToUserId: string | null;
  }): Promise<{ state: string; version: number; assignedActorId: string | null; replayed: boolean }>;
  conversationPolicyState(conversationId: string): Promise<{
    customerId: string | null;
    status: string;
    humanStatus: string;
    sofiaEnabled: boolean;
    assignedToUserId: string | null;
    handoffVersion: number;
  } | null>;
  appendStatus(input: DeliveryStatusUpdate & { status: WhatsappDeliveryStatus }): Promise<{ duplicate: boolean; outboundMessageId: string | null }>;
  latestStatus(accountId: string, providerMessageId: string): Promise<WhatsappDeliveryStatus | null>;
  createMediaEnvelope(input: {
    messageId: string;
    providerReferenceHash: string;
    declaredMimeType: string | null;
    declaredSizeBytes: bigint | null;
    securityStatus: 'METADATA_ONLY' | 'QUARANTINED' | 'REJECTED';
    rejectionCode: string | null;
    expiresAt: Date;
  }): Promise<void>;
  outboundForCommand(commandId: string, outboundMessageId: string): Promise<{
    id: string;
    conversationId: string;
    accountId: string | null;
    recipientIdentityHash: string | null;
    purpose: string | null;
    status: string;
    body: string;
    mediaUrl: string | null;
    idempotencyKey: string;
    account: { provider: string; status: string } | null;
    conversation: { phone: string; handoffVersion: number; customerId: string | null; sofiaEnabled: boolean; humanStatus: string };
  } | null>;
  bindOutboundCommand(outboundMessageId: string, commandId: string): Promise<void>;
  completeOutbound(input: {
    outboundMessageId: string;
    status: string;
    providerMessageId: string | null;
    unknownResult: boolean;
    sanitizedPayload?: Prisma.InputJsonValue;
    errorCode?: string | null;
  }): Promise<void>;
}
