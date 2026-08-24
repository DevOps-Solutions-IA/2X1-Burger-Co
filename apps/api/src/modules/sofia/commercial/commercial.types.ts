import type { SofiaActorContext } from '../../../application/contracts/sofia-domain-contracts';
import type { DestinationQuoteBinding } from '../../../delivery/destination-state/destination-revision';
import type { DestinationSnapshot } from '../../../delivery/destination-state/destination-snapshot.types';
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
  /**
   * SOFIA Round 5 / A10 — the canonical destination-state authority (A9,
   * `../../../delivery/destination-state`) for this conversation. `address`/`location` above remain
   * for backward-compatible display/audit (`addressSafe` in the fact envelope, existing repository
   * columns) but are always DERIVED from this snapshot — never written independently. `null` only
   * before any address/location signal has ever been supplied for this conversation (RULE 6: a new
   * conversation NEVER inherits a previous one's `destinationSnapshot`; see `emptyState()` in
   * `commercial-checkout.service.ts`, which always sets this to `null`).
   */
  destinationSnapshot: DestinationSnapshot | null;
  /**
   * The destination-state identity (`revision` + `spatialFingerprint`) that `deliveryQuoteAuditId`
   * was actually computed against, captured at `prepareDraft()` time via `quoteBindingFor()`. A
   * later `confirm()` call MUST verify `isQuoteBoundToCurrentDestination(deliveryQuoteDestinationBinding,
   * destinationSnapshot)` before trusting the existing draft/quote — see QUOTE BINDING invariant.
   * `null` whenever there is no live delivery quote (TAKEAWAY, or no quote computed yet).
   */
  deliveryQuoteDestinationBinding: DestinationQuoteBinding | null;
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
  /**
   * SOFIA Round 5 / A22 CLOSURE (CRITICAL) — the `fulfillment` value that was actually current when
   * `draftId`/`draftVersion`/`draftHash` were last (re)computed by `prepareDraft()`. Captured
   * independently of `state.fulfillment` because a SINGLE message can carry BOTH a CONFIRM intent
   * AND a fulfillment switch, parsed independently by `CommercialIntentEngine.interpret()` and
   * applied to `state.fulfillment` BEFORE `process()` routes into `confirm()` in the SAME call — so
   * by the time `confirm()` runs, `state.fulfillment` may already reflect THIS turn's switch while
   * `draftId` still points at a draft priced/persisted for the PREVIOUS fulfillment. `confirm()` MUST
   * compare this field against the current `state.fulfillment` (see `quoteStillBound` /
   * `fulfillmentStillBound`) before trusting the draft it is about to confirm — mirroring the exact
   * pattern `deliveryQuoteDestinationBinding` already established for the destination axis (A9/A10).
   * `null` only before any draft has ever been prepared for this conversation.
   */
  draftFulfillment: CommercialFulfillment;
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
