export type SofiaGovernanceOverallStatus = 'READY_FOR_SANDBOX' | 'BLOCKED_FOR_PRODUCTION' | 'WARNING' | 'ERROR';
export type SofiaGovernanceCheckStatus = 'PASS' | 'WARNING' | 'BLOCKED';
export type SofiaSecretRotationStatus = 'PENDING' | 'COMPLETE' | 'UNKNOWN';

export type SofiaReadinessItem = {
  key: string;
  label: string;
  status: SofiaGovernanceCheckStatus;
  reason: string;
  evidence: string;
};

export type SofiaEnterpriseStatusResponse = {
  generatedAt: string;
  overallStatus: SofiaGovernanceOverallStatus;
  productionReadiness: {
    status: SofiaGovernanceCheckStatus;
    blockers: string[];
    warnings: string[];
    nextRequiredAction: string;
    checklist: SofiaReadinessItem[];
  };
  security: {
    secretRotationStatus: SofiaSecretRotationStatus;
    canActivateQrReal: boolean;
    canActivateDeepSeekReal: boolean;
    canActivateAutoSafeProduction: boolean;
    blockers: string[];
  };
  sofia: {
    enabled: boolean;
    globalPaused: boolean;
    mode: string;
    activePromptVersion: string | null;
    promptStatus: string | null;
    promptUpdatedAt: string | null;
  };
  ai: {
    provider: string;
    mode: string;
    deepSeekEnabled: boolean;
    deepSeekReady: boolean;
    fallbackProvider: string;
    healthStatus: SofiaGovernanceCheckStatus;
  };
  autoSafe: {
    enabled: boolean;
    sandboxOnly: boolean;
    lastDecisionAt: string | null;
    decisionsToday: number;
    approvedToday: number;
    humanRequiredToday: number;
    blockedToday: number;
    draftOnlyToday: number;
    topReasonCodes: Array<{ code: string; count: number }>;
  };
  catalog: {
    activeItems: number;
    offersCount: number;
    additionsCount: number;
    missingPriceCount: number;
    missingImageCount: number;
    maxiFamilyStatus: SofiaGovernanceCheckStatus;
  };
  memory: {
    customersWithMemory: number;
    conversationsWithMemory: number;
    lastMemoryUpdateAt: string | null;
    optOutCount: number;
  };
  whatsapp: {
    provider: string;
    mode: string;
    qrGatewayReady: boolean;
    qrConnected: boolean;
    qrStatus?: string;
    qrSessionName?: string;
    qrReceiveOnlyReady?: boolean;
    realSendingEnabled: boolean;
    inboundToday: number;
    outboundToday: number;
    pendingOutbound: number;
  };
  conversations: {
    active: number;
    humanRequired: number;
    humanTaken: number;
    paused: number;
    resolvedToday: number;
  };
  payments: {
    whatsappCanMarkPaid: false;
    paymentLinksEnabled: boolean;
    manualPaymentsEnabled: boolean;
    nequiManualEnabled: boolean;
    cashEnabled: boolean;
  };
  operations: {
    posStatus: SofiaGovernanceCheckStatus;
    deliveriesStatus: SofiaGovernanceCheckStatus;
    checkoutStatus: SofiaGovernanceCheckStatus;
    stockProtected: boolean;
    cashProtected: boolean;
  };
  routes: {
    sandboxUrl: string;
    conversationsUrl: string;
    whatsappQrUrl?: string;
    deliveriesUrl: string;
    posUrl: string;
  };
  lastEvents: Array<{
    type: string;
    status: string;
    detail: string;
    createdAt: string;
  }>;
};

export type SofiaGovernanceSettingValue = {
  enabled?: boolean;
  allowed?: boolean;
  status?: string;
  updatedAt?: string;
  updatedBy?: string;
  reason?: string;
  paused?: boolean;
};
