import {
  SofiaAutoSafeDecisionStatus,
  SofiaAutoSafeReasonCode,
  SofiaAutoSafeRiskLevel,
} from './sofia-auto-safe.types';

export type SofiaAutoSafePolicyRule = {
  code: SofiaAutoSafeReasonCode;
  severity: SofiaAutoSafeRiskLevel;
  when: string;
  decision: SofiaAutoSafeDecisionStatus;
};

export const SOFIA_AUTO_SAFE_POLICY: SofiaAutoSafePolicyRule[] = [
  {
    code: 'AUTO_SAFE_DISABLED',
    severity: 'MEDIUM',
    when: 'autoSafeEnabled is false',
    decision: 'DRAFT_ONLY',
  },
  {
    code: 'SECRET_ROTATION_PENDING',
    severity: 'CRITICAL',
    when: 'secret rotation is pending outside sandbox',
    decision: 'BLOCKED',
  },
  {
    code: 'HUMAN_TAKEN',
    severity: 'HIGH',
    when: 'conversation is already taken by a human',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'SOFIA_PAUSED',
    severity: 'HIGH',
    when: 'Sofia is paused for the conversation',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'HUMAN_REQUESTED',
    severity: 'HIGH',
    when: 'customer asks for a human',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'SAFETY_GUARD_BLOCKED',
    severity: 'CRITICAL',
    when: 'SafetyGuard reports blocked flags',
    decision: 'BLOCKED',
  },
  {
    code: 'LOW_CONFIDENCE',
    severity: 'HIGH',
    when: 'confidence is below configured minimum',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'UNKNOWN_PRODUCT',
    severity: 'HIGH',
    when: 'message expresses order intent but no product/catalog match is recognized',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'UNKNOWN_PRICE',
    severity: 'HIGH',
    when: 'reply includes price-like claims that are not backed by known product/catalog price',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'INVENTED_PROMOTION',
    severity: 'CRITICAL',
    when: 'reply mentions unconfigured promotions or discounts',
    decision: 'BLOCKED',
  },
  {
    code: 'MAXI_FAMILY_COPY_RISK',
    severity: 'CRITICAL',
    when: 'candidate reply mentions Maxi Family but misses required copy or includes prohibited terms',
    decision: 'BLOCKED',
  },
  {
    code: 'PAID_CLAIM_BLOCKED',
    severity: 'CRITICAL',
    when: 'candidate reply claims a payment is paid or confirmed',
    decision: 'BLOCKED',
  },
  {
    code: 'PAYMENT_SENSITIVE',
    severity: 'HIGH',
    when: 'customer discusses payment verification or payment evidence',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'CUSTOMER_COMPLAINT',
    severity: 'HIGH',
    when: 'customer complaint or order issue is detected',
    decision: 'HUMAN_REQUIRED',
  },
  {
    code: 'ADDRESS_MISSING',
    severity: 'MEDIUM',
    when: 'order intent exists and delivery address is missing',
    decision: 'DRAFT_ONLY',
  },
  {
    code: 'ORDER_CONFIRMATION_MISSING',
    severity: 'MEDIUM',
    when: 'order exists but explicit confirmation is missing',
    decision: 'DRAFT_ONLY',
  },
  {
    code: 'OUTSIDE_HOURS',
    severity: 'MEDIUM',
    when: 'business is outside configured hours',
    decision: 'DRAFT_ONLY',
  },
  {
    code: 'PASS_ALL_RULES',
    severity: 'LOW',
    when: 'all blocking and draft-only rules pass',
    decision: 'AUTO_SAFE_APPROVED',
  },
];
