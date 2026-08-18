import { Prisma } from '@prisma/client';

export type SofiaAutoSafeDecisionStatus = 'AUTO_SAFE_APPROVED' | 'HUMAN_REQUIRED' | 'BLOCKED' | 'DRAFT_ONLY';

export type SofiaAutoSafeRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SofiaAutoSafeReasonCode =
  | 'SAFETY_GUARD_BLOCKED'
  | 'LOW_CONFIDENCE'
  | 'UNKNOWN_PRODUCT'
  | 'UNKNOWN_PRICE'
  | 'INVENTED_PROMOTION'
  | 'MAXI_FAMILY_COPY_RISK'
  | 'PAYMENT_SENSITIVE'
  | 'PAID_CLAIM_BLOCKED'
  | 'CASH_OR_NEQUI_VERIFICATION_REQUIRED'
  | 'CUSTOMER_COMPLAINT'
  | 'CUSTOMER_ANGRY'
  | 'HUMAN_REQUESTED'
  | 'HUMAN_TAKEN'
  | 'SOFIA_PAUSED'
  | 'OUTSIDE_SCOPE'
  | 'MEMORY_UNCERTAIN'
  | 'ADDRESS_MISSING'
  | 'CUSTOMER_NAME_MISSING'
  | 'ORDER_CONFIRMATION_MISSING'
  | 'ORDER_TOO_COMPLEX'
  | 'RATE_LIMIT_RISK'
  | 'OUTSIDE_HOURS'
  | 'QR_NOT_READY'
  | 'DEEPSEEK_NOT_READY'
  | 'SECRET_ROTATION_PENDING'
  | 'AUTO_SAFE_DISABLED'
  | 'SANDBOX_ONLY'
  | 'PASS_ALL_RULES';

export type SofiaAutoSafeInput = {
  conversationId?: string | null;
  customerMemoryId?: string | null;
  promptVersionId?: string | null;
  phoneNormalized?: string | null;
  messageText: string;
  candidateReply: string;
  intent: string;
  confidence: number;
  minConfidence?: number;
  productsMentioned: Array<{ name: string; productId?: string | null; price?: number | null; known?: boolean }>;
  catalogItems: Array<{ slug: string; name: string; price: number | null; priceSource: string; prohibitedClaims?: string[] }>;
  memorySnapshot?: unknown;
  conversationState?: string | null;
  promptVersion?: string | null;
  paymentIntent?: string | null;
  orderIntent?: Prisma.InputJsonValue | null;
  missingFields: string[];
  safetyGuardResult: {
    blocked?: boolean;
    safetyFlags?: string[];
    forbiddenClaimsDetected?: string[];
    diagnostics?: string[];
  };
  channelMode: string;
  isSandbox: boolean;
  isHumanTaken: boolean;
  isSofiaPaused: boolean;
  autoSafeEnabled: boolean;
  secretRotationPending: boolean;
  qrReady: boolean;
  deepSeekReady: boolean;
  businessStatus?: { isOpen: boolean; timezone?: string; schedule?: string };
  metadata?: Prisma.InputJsonValue;
  aiProviderMeta?: { provider: string; mode: string; model?: string | null };
};

export type SofiaAutoSafeDecision = {
  status: SofiaAutoSafeDecisionStatus;
  riskLevel: SofiaAutoSafeRiskLevel;
  approved: boolean;
  shouldSend: boolean;
  shouldCreateOutbox: boolean;
  shouldRequireHuman: boolean;
  reasonCodes: SofiaAutoSafeReasonCode[];
  blockingReasons: string[];
  warnings: string[];
  correctedReply: string | null;
  finalReply: string | null;
  requiredHumanAction: string | null;
  auditJson: Prisma.JsonValue;
  createdAt: string;
  eventId?: string;
};
