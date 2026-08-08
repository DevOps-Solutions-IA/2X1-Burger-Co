import type {
  CommercialFulfillment,
  CommercialModifier,
  CommercialPaymentPreference,
} from '../commercial.types';

export type CommercialResponsePurpose =
  | 'ASK_PRODUCT'
  | 'ASK_FULFILLMENT'
  | 'ASK_PAYMENT'
  | 'ASK_ADDRESS'
  | 'CLARIFY_PAYMENT'
  | 'CLARIFY_PRODUCT'
  | 'SUMMARIZE_DRAFT'
  | 'CONFIRM_DRAFT'
  | 'PRICE_CHANGED'
  | 'QUOTE_EXPIRED'
  | 'PRODUCT_UNAVAILABLE'
  | 'MODIFIER_UNSUPPORTED'
  | 'DISCOUNT_UNAVAILABLE'
  | 'DEPENDENCY_FAILURE'
  | 'HUMAN_HANDOFF'
  | 'TAKEAWAY_CONFIRMED'
  | 'DELIVERY_CONFIRMED';

export type CommercialResponseItem = Readonly<{
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: ReadonlyArray<Readonly<CommercialModifier>>;
  available: boolean | null;
}>;

export type CommercialFactEnvelope = Readonly<{
  responsePurpose: CommercialResponsePurpose;
  allowedFacts: ReadonlyArray<string>;
  allowedOptions: ReadonlyArray<CommercialPaymentPreference | Exclude<CommercialFulfillment, null>>;
  forbiddenClaims: ReadonlyArray<string>;
  customerContextSafe: Readonly<{ preferredTone: 'NATURAL_CONCISE'; locale: 'es-CO' }>;
  fulfillment: CommercialFulfillment;
  paymentOptions: ReadonlyArray<CommercialPaymentPreference>;
  items: ReadonlyArray<CommercialResponseItem>;
  subtotal: number | null;
  deliveryFee: number | null;
  total: number | null;
  addressSafe: string | null;
  missingFields: ReadonlyArray<string>;
  confirmationRequired: boolean;
  handoffRequired: boolean;
  reasonCode: string | null;
}>;

export type CommercialResponseValidation = Readonly<{
  valid: boolean;
  violations: ReadonlyArray<string>;
}>;

export type CommercialComposedResponse = Readonly<{
  text: string;
  source: 'BOUNDED_AI' | 'SAFE_TEMPLATE';
  validation: CommercialResponseValidation;
}>;

export const COMMERCIAL_LANGUAGE_GENERATOR = Symbol('COMMERCIAL_LANGUAGE_GENERATOR');

export interface CommercialLanguageGenerator {
  compose(envelope: CommercialFactEnvelope): Promise<string | null>;
}
