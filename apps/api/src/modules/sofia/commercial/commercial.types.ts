import type { SofiaActorContext } from '../../../application/contracts/sofia-domain-contracts';
import type { CommercialFactEnvelope } from './response/commercial-response.types';

export type CommercialIntent = 'PURCHASE' | 'CHANGE_ORDER' | 'CONFIRM' | 'REJECT' | 'ASK_HUMAN' | 'UNKNOWN';
export type CommercialConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type CommercialFulfillment = 'DELIVERY' | 'TAKEAWAY' | null;
export type CommercialPaymentPreference = 'ONLINE' | 'CASH_ON_DELIVERY' | 'PAY_AT_PICKUP' | 'UNKNOWN';
export type CommercialPaymentReadiness = 'PAYMENT_READY_ONLINE' | 'PAYMENT_COD' | 'PAYMENT_AT_PICKUP' | 'PAYMENT_UNRESOLVED';
export type LastQuestionPurpose = 'PRODUCT' | 'FULFILLMENT' | 'PAYMENT' | 'DELIVERY_ADDRESS' | 'CONFIRM_ORDER' | null;

export type CommercialModifier = { kind: 'REMOVE' | 'ADD'; name: string; quantity?: number; itemIndex?: number };
export type CommercialItem = {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: CommercialModifier[];
};

export type CommercialConversationState = {
  schemaVersion: 4;
  conversationId: string;
  customerId: string | null;
  intent: CommercialIntent;
  items: CommercialItem[];
  fulfillment: CommercialFulfillment;
  address: string | null;
  addressConfirmed: boolean;
  location: { latitude: number; longitude: number } | null;
  paymentPreference: CommercialPaymentPreference;
  paymentReadiness: CommercialPaymentReadiness;
  subtotal: number | null;
  deliveryFee: number | null;
  total: number | null;
  deliveryQuoteAuditId: string | null;
  deliveryQuoteVersion: number | null;
  deliveryQuoteExpiresAt: string | null;
  availabilitySnapshot: Array<{ productId: string; quantity: number; checkedAt: string; reasonCode: string }>;
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
  factEnvelope: CommercialFactEnvelope;
  responseComposition: Readonly<{ source: 'BOUNDED_AI' | 'SAFE_TEMPLATE'; violations: ReadonlyArray<string> }>;
};
