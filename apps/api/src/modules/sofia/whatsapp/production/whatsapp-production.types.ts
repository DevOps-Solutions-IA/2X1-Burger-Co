export type WhatsappProductionProvider = 'qr_gateway' | 'hermes' | 'mock';
export type WhatsappEventKind = 'INBOUND_MESSAGE' | 'STATUS_EVENT' | 'UNSUPPORTED_EVENT';
export type WhatsappMessagePurpose = 'SERVICE' | 'MARKETING';
export type NormalizedDeliveryStatus = 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNKNOWN';

export type ProviderAccountObservation = {
  provider: WhatsappProductionProvider;
  externalAccountId: string;
  businessIdentity: string;
  sessionOwner: string;
};

export type InboundMediaMetadata = {
  providerReference: string | null;
  declaredMimeType: string | null;
  declaredSizeBytes: number | null;
};

export type InboundMessageEvent = {
  kind: 'INBOUND_MESSAGE';
  provider: WhatsappProductionProvider;
  account: ProviderAccountObservation;
  eventId: string;
  messageId: string;
  sender: string;
  senderIdentityHash: string;
  recipientIdentityHash: string;
  messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'INTERACTIVE' | 'SYSTEM';
  sanitizedText: string | null;
  media: InboundMediaMetadata | null;
  occurredAt: Date;
  payloadHash: string;
};

export type InboundStatusEvent = {
  kind: 'STATUS_EVENT';
  provider: WhatsappProductionProvider;
  account: ProviderAccountObservation;
  eventId: string;
  messageId: string;
  recipientIdentityHash: string;
  status: NormalizedDeliveryStatus;
  occurredAt: Date;
  payloadHash: string;
};

export type UnsupportedEvent = {
  kind: 'UNSUPPORTED_EVENT';
  provider: WhatsappProductionProvider;
  account: ProviderAccountObservation;
  eventId: string;
  reasonCode: string;
  occurredAt: Date;
  payloadHash: string;
};

export type NormalizedWhatsappEvent = InboundMessageEvent | InboundStatusEvent | UnsupportedEvent;

export type OutboundMessageCommand = {
  commandId: string;
  outboundMessageId: string;
  conversationId: string;
  recipientIdentityHash: string;
  payloadHash: string;
  purpose: WhatsappMessagePurpose;
  expectedConversationVersion: number;
  expiresAt: Date;
  accountId: string;
};

export type OutboundMessageResult = {
  code: 'WHATSAPP_SENT' | 'WHATSAPP_PROVIDER_REJECTED' | 'WHATSAPP_UNKNOWN_RESULT' | 'WHATSAPP_SEND_DISABLED';
  providerMessageId: string | null;
  acceptedAt: Date | null;
  retryable: boolean;
  unknownResult: boolean;
};

export type DeliveryStatusUpdate = {
  accountId: string;
  providerStatusEventId: string;
  providerMessageId: string;
  recipientIdentityHash: string;
  status: NormalizedDeliveryStatus;
  occurredAt: Date;
  payloadHash: string;
};

export type ConsentDecision = {
  allowed: boolean;
  purpose: WhatsappMessagePurpose;
  version: number | null;
  reasonCode: string;
  evaluatedAt: Date;
};

export type HandoffDecision = {
  automationAllowed: boolean;
  state: string;
  version: number;
  assignedActorId: string | null;
  reasonCode: string;
};

export type ProviderHealthResult = {
  provider: WhatsappProductionProvider;
  configured: boolean;
  connected: boolean;
  accountBound: boolean;
  receiveEnabled: boolean;
  sendEnabled: false;
  statusEventsEnabled: boolean;
  blockers: string[];
};

export type MediaSecurityDecision = {
  accepted: boolean;
  status: 'METADATA_ONLY' | 'QUARANTINED' | 'REJECTED';
  reasonCode: string;
  fetchAllowed: false;
  aiIngestionAllowed: false;
};
