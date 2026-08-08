import type { SofiaActorContext } from '../../../application/contracts/sofia-domain-contracts';

export type CommercialIntent = 'PURCHASE' | 'CHANGE_ORDER' | 'CONFIRM' | 'REJECT' | 'ASK_HUMAN' | 'UNKNOWN';
export type CommercialConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type CommercialFulfillment = 'DELIVERY' | 'TAKEAWAY' | null;
export type CommercialPaymentPreference = 'ONLINE' | 'CASH_ON_DELIVERY' | 'PAY_AT_PICKUP' | 'UNKNOWN';
export type LastQuestionPurpose = 'PRODUCT' | 'FULFILLMENT' | 'PAYMENT' | 'DELIVERY_ADDRESS' | 'CONFIRM_ORDER' | null;

export type CommercialModifier = { kind: 'REMOVE' | 'ADD'; name: string; itemIndex?: number };
export type CommercialItem = {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: CommercialModifier[];
};

export type CommercialConversationState = {
  conversationId: string;
  customerId: string | null;
  intent: CommercialIntent;
  items: CommercialItem[];
  fulfillment: CommercialFulfillment;
  address: string | null;
  location: { latitude: number; longitude: number } | null;
  paymentPreference: CommercialPaymentPreference;
  draftId: string | null;
  draftVersion: number | null;
  draftHash: string | null;
  confirmationState: 'NONE' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
  missingFields: string[];
  ambiguities: string[];
  confidence: CommercialConfidence;
  handoffState: string;
  consentState: string;
  domainErrors: string[];
  lastQuestionPurpose: LastQuestionPurpose;
  lastResolvedIntent: CommercialIntent | null;
  expiresAt: string | null;
};

export type CommercialMessageCommand = {
  conversationId: string;
  phone: string;
  displayName?: string;
  message: string;
  actor: SofiaActorContext;
  location?: { latitude: number; longitude: number };
};

export type CommercialTurnResult = {
  state: CommercialConversationState;
  responseText: string;
  nextAction: 'ASK_MISSING' | 'READY_TO_CONFIRM' | 'DRAFT_CONFIRMED' | 'HANDOFF' | 'NO_ACTION';
  factEnvelope: Record<string, unknown>;
};

