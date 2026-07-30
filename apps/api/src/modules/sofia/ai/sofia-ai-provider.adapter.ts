export type SofiaAIProviderName = 'rules' | 'deepseek' | 'hybrid' | 'null';
export type SofiaAIMode = 'disabled' | 'dry_run' | 'suggest' | 'supervised' | 'auto';
export type SofiaAIIntent =
  | 'GREETING'
  | 'ASK_MENU'
  | 'ASK_COMBO'
  | 'ASK_PRICE'
  | 'ORDER_ITEM'
  | 'ADD_ITEM'
  | 'REMOVE_ITEM'
  | 'MODIFY_QUANTITY'
  | 'ASK_DELIVERY'
  | 'PROVIDE_ADDRESS'
  | 'PROVIDE_NAME'
  | 'PROVIDE_PAYMENT_METHOD'
  | 'CONFIRM_ORDER'
  | 'CANCEL_ORDER'
  | 'ASK_HUMAN'
  | 'UNKNOWN';

export type SofiaAISnapshotProduct = {
  id: string;
  code: string;
  name: string;
  price: number;
  available: boolean;
  categoryName?: string | null;
};

export type SofiaAIAvailableOffer = {
  slug: string;
  name: string;
  linkedProductId: string;
  price: number;
  description: string;
  imageUrl: string;
  salesHint: string;
};

export type SofiaAIAnalysisInput = {
  conversationId: string;
  customerMessage: string;
  normalizedMessage: string;
  currentDraftSnapshot: unknown;
  availableOffersSnapshot: SofiaAIAvailableOffer[];
  availableProductsSnapshot: SofiaAISnapshotProduct[];
  paymentOptionsSnapshot: unknown;
  businessRulesSnapshot: {
    maxiFamilyCopy: string;
    forbiddenMaxiFamilyClaims: string[];
    noPaidFromAi: boolean;
    noInventedProducts: boolean;
    noInventedPrices: boolean;
  };
  recentMessagesSummary?: string | null;
  mode: SofiaAIMode;
  ruleIntent: SofiaAIIntent;
  ruleConfidence: number;
  ruleSuggestedReply?: string | null;
  mockScenario?: string | null;
};

export type SofiaAIExtractedItem = {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice?: number | null;
};

export type SofiaAIAnalysisOutput = {
  provider: SofiaAIProviderName;
  mode: SofiaAIMode;
  intent: SofiaAIIntent;
  confidence: number;
  extractedItems: SofiaAIExtractedItem[];
  missingFields: string[];
  suggestedReply: string | null;
  suggestedUpsell: string | null;
  shouldCreateDraft: boolean;
  shouldCreateOrder: boolean;
  shouldGeneratePaymentLink: boolean;
  shouldHandoff: boolean;
  handoffReason: string | null;
  safetyFlags: string[];
  forbiddenClaimsDetected: string[];
  fallbackUsed: boolean;
  diagnostics: string[];
};

export type SofiaAIHealth = {
  provider: SofiaAIProviderName;
  configured: boolean;
  enabled: boolean;
  ok: boolean;
  message: string;
};

export abstract class SofiaAIProviderAdapter {
  abstract readonly provider: SofiaAIProviderName;
  abstract analyzeMessage(input: SofiaAIAnalysisInput): Promise<SofiaAIAnalysisOutput>;
  abstract classifyIntent(input: SofiaAIAnalysisInput): Promise<Pick<SofiaAIAnalysisOutput, 'intent' | 'confidence'>>;
  abstract extractOrderEntities(input: SofiaAIAnalysisInput): Promise<SofiaAIExtractedItem[]>;
  abstract draftReply(input: SofiaAIAnalysisInput): Promise<string | null>;
  abstract evaluateConfidence(input: SofiaAIAnalysisInput): Promise<number>;
  abstract shouldHandoff(input: SofiaAIAnalysisInput): Promise<boolean>;
  abstract healthCheck(): Promise<SofiaAIHealth>;

  protected rulesOutput(input: SofiaAIAnalysisInput, diagnostics: string[] = []): SofiaAIAnalysisOutput {
    return {
      provider: this.provider,
      mode: input.mode,
      intent: input.ruleIntent,
      confidence: input.ruleConfidence,
      extractedItems: [],
      missingFields: [],
      suggestedReply: input.ruleSuggestedReply ?? null,
      suggestedUpsell: null,
      shouldCreateDraft: false,
      shouldCreateOrder: false,
      shouldGeneratePaymentLink: false,
      shouldHandoff: input.ruleConfidence < 0.45 || input.ruleIntent === 'ASK_HUMAN',
      handoffReason: input.ruleConfidence < 0.45 ? 'LOW_CONFIDENCE' : input.ruleIntent === 'ASK_HUMAN' ? 'CUSTOMER_REQUESTED_HUMAN' : null,
      safetyFlags: [],
      forbiddenClaimsDetected: [],
      fallbackUsed: false,
      diagnostics,
    };
  }
}
