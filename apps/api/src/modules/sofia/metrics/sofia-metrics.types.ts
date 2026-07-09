export type SofiaMetricsRange = 'today' | '7d' | '30d';

export type SofiaMetricBucket = {
  key: string;
  count: number;
};

export type SofiaMetricsResponse = {
  generatedAt: string;
  range: SofiaMetricsRange;
  conversations: {
    total: number;
    active: number;
    humanRequired: number;
    humanTaken: number;
    paused: number;
    resolved: number;
    averageResponseDraftTimeMs: number | null;
  };
  inbound: {
    total: number;
    qrGateway: number;
    simulated: number;
    allowlistBlocked: number;
    duplicatesIgnored: number;
    mediaWithoutTranscript: number;
  };
  outbound: {
    suggested: number;
    draftOnly: number;
    approvalPending: number;
    blockedRealSend: number;
    sentReal: number;
  };
  autoSafe: {
    total: number;
    approved: number;
    humanRequired: number;
    blocked: number;
    draftOnly: number;
    topReasonCodes: SofiaMetricBucket[];
    riskLevels: SofiaMetricBucket[];
  };
  catalog: {
    productMentions: SofiaMetricBucket[];
    unknownProducts: number;
    unknownPrices: number;
    maxiFamilyCorrections: number;
  };
  payments: {
    paymentSensitiveMessages: number;
    paidClaimsBlocked: number;
    whatsappCanMarkPaid: false;
  };
  memory: {
    customersWithMemory: number;
    updatedToday: number;
    optOuts: number;
    memoryUncertain: number;
  };
  safety: {
    safetyBlocks: number;
    prohibitedPhraseBlocks: number;
    inventedPromotionBlocks: number;
  };
  governance: {
    productionStatus: string;
    activeBlockers: string[];
    killSwitchState: string;
    qrReceiveOnlyStatus: string;
  };
  system: {
    health: string;
    lastBackupAt: string | null;
    logSanitizationStatus: string;
    retentionStatus: string;
    alertsOpen: number;
    alertsCritical: number;
  };
};
