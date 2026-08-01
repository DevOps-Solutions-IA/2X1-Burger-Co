import { z } from 'zod';

const nullableString = z.string().nullable();

export const sofiaFeaturedOfferSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  imageUrl: z.string(),
  salesHint: z.string(),
  sortOrder: z.number(),
  isActive: z.boolean(),
  linkedProductName: nullableString,
  offerType: z.string(),
});

export const sofiaCommercialCatalogItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  type: z.string(),
  price: z.number().nullable(),
  priceSource: z.string(),
  imageUrl: nullableString,
  shortDescription: nullableString,
  composition: z
    .object({
      requiredCopy: z.string().optional(),
      items: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  aliases: z.array(z.string()).optional(),
  upsellRules: z.array(z.string()).optional(),
  prohibitedClaims: z.array(z.string()).optional(),
});

export const sofiaAgentItemSchema = z.object({
  productId: z.string(),
  code: z.string(),
  name: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  totalPrice: z.number(),
  imageUrl: nullableString.optional(),
  categoryName: nullableString.optional(),
});

export const sofiaSandboxAgentResultSchema = z.object({
  conversationId: z.string(),
  detectedIntent: z.string(),
  confidence: z.number(),
  extractedItems: z.array(sofiaAgentItemSchema),
  currentItems: z.array(sofiaAgentItemSchema),
  missingFields: z.array(z.string()),
  suggestedUpsell: z
    .object({
      productId: z.string(),
      name: z.string(),
      price: z.number().nullable(),
      message: z.string(),
    })
    .nullable(),
  mediaSuggestion: z
    .object({
      type: z.string(),
      productId: z.string(),
      productName: z.string(),
      imageUrl: nullableString,
      altText: z.string(),
      offerSlug: z.string().optional(),
      salesHint: z.string().optional(),
    })
    .nullable(),
  featuredOffers: z.array(sofiaFeaturedOfferSchema),
  commercialCatalog: z.array(sofiaCommercialCatalogItemSchema),
  matchedCatalogItem: sofiaCommercialCatalogItemSchema.nullable().optional(),
  matchedFeaturedOffer: sofiaFeaturedOfferSchema.nullable().optional(),
  promptVersion: z.string().optional(),
  memory: z
    .object({
      customer: z
        .object({
          displayName: nullableString.optional(),
          lastKnownAddress: nullableString.optional(),
          memorySummary: nullableString.optional(),
          lastOrderSummary: z.unknown().optional(),
        })
        .optional(),
      conversation: z
        .object({
          currentIntent: nullableString.optional(),
          lastProductDiscussed: nullableString.optional(),
          memorySummary: nullableString.optional(),
        })
        .optional(),
      repeatLastOrder: z
        .object({ canRepeat: z.boolean(), responseText: z.string() })
        .nullable()
        .optional(),
    })
    .optional(),
  autoSafeDecision: z
    .object({
      status: z.enum(['AUTO_SAFE_APPROVED', 'HUMAN_REQUIRED', 'BLOCKED', 'DRAFT_ONLY']),
      approved: z.boolean(),
      shouldSend: z.boolean(),
      reasonCodes: z.array(z.string()),
      blockingReasons: z.array(z.string()),
      warnings: z.array(z.string()),
      finalReply: nullableString,
      requiredHumanAction: nullableString,
    })
    .optional(),
  nextAction: z.enum(['HANDOFF', 'SANDBOX_DRAFT_CONFIRMED', 'ASK_MISSING_FIELDS', 'READY_TO_CONFIRM']),
  responseText: z.string(),
  shouldCreateDraft: z.boolean(),
  shouldConfirmOrder: z.boolean(),
  shouldHandoff: z.boolean(),
  paymentLinkUrl: z.null(),
  draft: z
    .object({ id: z.string(), status: z.string(), total: z.union([z.number(), z.string()]) })
    .nullable()
    .optional(),
  deliveryOrder: z
    .object({ id: z.string(), orderTicketId: z.null().optional(), status: z.string().optional() })
    .nullable()
    .optional(),
  businessStatus: z.object({ isOpen: z.boolean(), timezone: z.string(), schedule: z.string() }),
  safeguards: z.object({
    noWhatsappReal: z.literal(true),
    noHermesReal: z.literal(true),
    deepSeekBackendOnly: z.literal(true),
    aiCannotOperateHermes: z.literal(true),
    aiCannotMarkPaid: z.literal(true),
    noRealPayments: z.literal(true),
    sandboxOperationalIsolation: z.literal(true),
    productiveActionBlocked: z.null(),
  }),
});

export const sofiaSandboxRecoveryResultSchema = z.object({
  conversationId: nullableString.optional(),
  draftId: z.string().optional(),
  detectedIntent: z.string(),
  currentItems: z.array(sofiaAgentItemSchema).optional(),
  nextAction: z.string(),
  responseText: z.string(),
});

export const sofiaQrStatusSchema = z.object({
  provider: z.literal('qr_gateway'),
  mode: z.enum(['disabled', 'receive_only']),
  status: z.enum([
    'DISABLED',
    'DISCONNECTED',
    'CONNECTING',
    'WAITING_QR',
    'QR_READY',
    'CONNECTED',
    'RECONNECTING',
    'FAILED',
    'LOGGED_OUT',
  ]),
  ok: z.boolean(),
  connected: z.boolean(),
  adapterReal: z.boolean(),
  phoneNumber: nullableString,
  deviceName: nullableString,
  qrAvailable: z.boolean(),
  qrImageDataUrl: nullableString,
  qrString: z.null(),
  qrIssuedAt: nullableString,
  qrExpiresAt: nullableString,
  lastQrAt: nullableString,
  lastConnectedAt: nullableString,
  lastDisconnectedAt: nullableString,
  lastError: nullableString,
  lastErrorCode: nullableString,
  lastErrorMessage: nullableString,
  lastConnectionUpdateAt: nullableString,
  sessionName: z.string(),
  sessionPathSanitized: z.string(),
  storageWritable: z.boolean(),
  sessionStorageReady: z.boolean(),
  inboundToday: z.number(),
  outboundToday: z.number(),
  pendingOutbound: z.number(),
  realSendingEnabled: z.literal(false),
  autoReplyEnabled: z.literal(false),
  deepSeekEnabled: z.literal(false),
  productionBlocked: z.literal(true),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  reason: nullableString,
  operatorMessage: z.string(),
  updatedAt: z.string(),
}).superRefine((value, context) => {
  if (value.status === 'CONNECTED' && (!value.connected || !value.adapterReal)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'CONNECTED requiere socket real y connected=true.',
    });
  }
  if (value.connected && value.status !== 'CONNECTED') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'connected=true requiere status CONNECTED.',
    });
  }
  if (
    value.status === 'QR_READY' &&
    (!value.adapterReal || !value.qrAvailable || !value.qrImageDataUrl)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'QR_READY requiere adapter real e imagen QR disponible.',
    });
  }
  if (value.qrAvailable && value.status !== 'QR_READY') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'qrAvailable=true requiere status QR_READY.',
    });
  }
});

export const sofiaQrInboundTestResultSchema = z.object({
  provider: z.literal('qr_gateway'),
  mode: z.literal('receive_only'),
  processingStatus: z.string(),
  duplicate: z.boolean().optional(),
  noWhatsappReal: z.literal(true),
  realSendingEnabled: z.literal(false).optional(),
  conversationId: z.string().optional(),
  inboundMessageId: z.string().optional(),
  inboundEventId: z.string().optional(),
});

export const sofiaQrSendBlockedResultSchema = z.object({
  provider: z.literal('qr_gateway'),
  status: z.literal('BLOCKED_REAL_SEND_DISABLED'),
  sent: z.literal(false),
  realSendingEnabled: z.literal(false),
});

const inboxConversationSchema = z.object({
  id: z.string(),
  scope: z.enum(['real', 'internal_validation', 'sandbox', 'historical']),
  customerLabel: z.string(),
  phoneMasked: nullableString,
  phoneHash: nullableString,
  provider: z.string(),
  mode: z.string(),
  status: z.string(),
  humanStatus: z.string(),
  sofiaEnabled: z.boolean(),
  lastMessagePreview: nullableString,
  lastMessageAt: nullableString,
  lastInboundAt: nullableString,
  unreadCount: z.number(),
  operationalState: z.string(),
  recommendedAction: z.string(),
  signals: z.object({
    humanRequired: z.boolean(),
    paymentSensitive: z.boolean(),
    unknownProduct: z.boolean(),
    aiSuggestion: z.boolean(),
    blocked: z.boolean(),
    allowlistPending: z.boolean(),
    pendingReview: z.boolean(),
  }),
  operationalReasons: z.array(z.object({ code: z.string(), label: z.string() })),
  technicalReasonCodes: z.array(z.string()),
  messages: z.array(
    z.object({
      id: z.string(),
      direction: z.enum(['INBOUND', 'OUTBOUND', 'SYSTEM']),
      provider: z.string(),
      status: z.string(),
      bodyPreview: nullableString,
      aiIntent: nullableString,
      confidence: z.number().nullable(),
      createdAt: z.string(),
    }),
  ),
  outboundMessages: z.array(
    z.object({
      id: z.string(),
      bodyPreview: nullableString,
      hasMedia: z.boolean(),
      status: z.string(),
      attempts: z.number(),
      lastError: nullableString,
      createdAt: z.string(),
      sentAt: nullableString,
      sent: z.boolean(),
      realSendingEnabled: z.literal(false),
    }),
  ),
  outboxTotal: z.number(),
  outboundSentCount: z.number(),
  relatedOperationCounts: z.object({ orderDrafts: z.number(), deliveryOrders: z.number() }),
  ai: z.object({ provider: z.string(), mode: z.string(), dryRun: z.boolean() }),
  safety: z.object({
    safetyGuard: z.boolean(),
    sentFalseExpected: z.literal(true),
    realSendingEnabled: z.literal(false),
    whatsappCanMarkPaid: z.literal(false),
  }),
  updatedAt: z.string(),
  createdAt: z.string(),
});

const inboxGroupSchema = z.object({
  total: z.number(),
  hiddenByDefault: z.boolean().optional(),
  conversations: z.array(inboxConversationSchema),
});

export const sofiaConversationsInboxSchema = z.object({
  generatedAt: z.string(),
  scope: z.object({
    realOperationEnabled: z.boolean(),
    realOperationReason: z.string(),
    receiveOnly: z.literal(true),
    sandboxHiddenByDefault: z.boolean(),
    historicalHiddenByDefault: z.boolean(),
  }),
  real: inboxGroupSchema,
  internalValidation: inboxGroupSchema,
  sandbox: inboxGroupSchema,
  historical: inboxGroupSchema,
  filters: z.object({
    allOperational: z.number(),
    humanRequired: z.number(),
    paymentSensitive: z.number(),
    unknownProduct: z.number(),
    blocked: z.number(),
    aiSuggestions: z.number(),
  }),
  summary: z.object({
    totalConversations: z.number(),
    realConversations: z.number(),
    internalValidationConversations: z.number(),
    sandboxConversations: z.number(),
    historicalConversations: z.number(),
    pendingReview: z.number(),
    outboundSent: z.number(),
  }),
  security: z.object({
    realSendingEnabled: z.literal(false),
    autoReplyEnabled: z.literal(false),
    productionEnabled: z.literal(false),
    whatsappCanMarkPaid: z.literal(false),
    deepSeekEnabled: z.boolean(),
    aiMode: z.string(),
    dataPolicy: z.object({
      noSecrets: z.boolean(),
      noQrRaw: z.boolean(),
      noFullPhone: z.boolean(),
      providerPayloadExcluded: z.boolean(),
    }),
  }),
});

const countGroupSchema = z.object({
  totalDecisions: z.number(),
  approvedCount: z.number(),
  humanRequiredCount: z.number(),
  blockedCount: z.number(),
  draftCount: z.number(),
  paymentSensitiveCount: z.number(),
  unknownProductCount: z.number(),
  lastDecisionAt: nullableString,
});

export const sofiaDashboardSummarySchema = z.object({
  generatedAt: z.string(),
  dataPolicy: z.object({
    noSecrets: z.boolean(),
    noPii: z.boolean(),
    noQrRaw: z.boolean(),
    realOperationEnabled: z.boolean(),
    realOperationReason: z.string(),
    sandboxSeparated: z.boolean(),
    mainDashboardScope: z.string(),
  }),
  general: z.object({
    sofiaMode: z.string(),
    globalPaused: z.boolean(),
    killSwitchActive: z.boolean(),
    automationBlocked: z.boolean(),
    productionEnabled: z.literal(false),
    productionBlocked: z.literal(true),
    receiveOnly: z.literal(true),
    realSendingEnabled: z.literal(false),
    autoReplyEnabled: z.literal(false),
    autoSafeEnabled: z.literal(false),
  }),
  whatsappQr: z.object({
    provider: z.string(),
    mode: z.string(),
    status: z.string(),
    connected: z.boolean(),
    adapterReal: z.boolean(),
    qrAvailable: z.boolean(),
    realSendingEnabled: z.literal(false),
    inboundToday: z.number(),
    lastInboundAt: nullableString,
    validationInboundToday: z.number(),
    source: z.enum(['real_operation', 'internal_validation']),
  }),
  ai: z.object({
    aiProvider: z.string(),
    aiMode: z.string(),
    deepSeekEnabled: z.boolean(),
    dryRunEnabled: z.boolean(),
    externalProviderEnabled: z.boolean(),
    fallbackProvider: z.string(),
    lastAiCheckAt: nullableString,
    source: z.string(),
  }),
  safetyGuard: z.object({ real: countGroupSchema, sandbox: countGroupSchema, historical: countGroupSchema }),
  conversations: z.object({
    totalConversations: z.number(),
    realConversations: z.number(),
    sandboxConversations: z.number(),
    internalValidationConversations: z.number(),
    humanRequired: z.number(),
    paymentSensitive: z.number(),
    unknownProduct: z.number(),
    pendingReview: z.number(),
  }),
  internalValidation: z.object({
    inboundToday: z.number(),
    simulatedInboundToday: z.number(),
    qrGatewayValidationInboundToday: z.number(),
    autoSafeDecisionsToday: z.number(),
    paidClaimsBlockedToday: z.number(),
  }),
  security: z.object({
    secretRotationStatus: z.string(),
    securityCleanupStatus: z.string(),
    allowlistFinalStatus: z.string(),
    productionReadinessStatus: z.string(),
    blockedChecks: z.array(z.string()),
    passedChecks: z.array(z.string()),
    pendingChecks: z.array(z.string()),
  }),
  routes: z.object({
    sandboxUrl: z.null(),
    conversationsUrl: z.string(),
    whatsappQrUrl: z.string().optional(),
    deliveriesUrl: z.string(),
    posUrl: z.string(),
  }),
});

export const sofiaReadinessSchema = z.object({
  status: z.enum(['PASS', 'WARNING', 'BLOCKED']),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  nextRequiredAction: z.string(),
  checklist: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      status: z.enum(['PASS', 'WARNING', 'BLOCKED']),
      reason: z.string(),
      evidence: z.string().optional(),
    }),
  ),
});

export const sofiaGovernanceEventsSchema = z.array(
  z.object({ type: z.string(), status: z.string(), detail: z.string(), createdAt: z.string() }),
);

export const sofiaAlertsSchema = z.array(
  z.object({
    id: z.string(),
    type: z.string(),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
    status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']),
    title: z.string(),
    message: z.string(),
    createdAt: z.string(),
  }),
);

export const sofiaGovernancePauseResponseSchema = z.object({
  paused: z.boolean(),
  status: z.string(),
  message: z.string(),
});

export const sofiaAlertAckResponseSchema = z.object({
  id: z.string(),
  status: z.literal('ACKNOWLEDGED'),
});

export const sofiaConversationActionResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  humanStatus: z.string(),
  sofiaEnabled: z.boolean(),
});

export const sofiaOutboundCancelResponseSchema = z.object({
  id: z.string(),
  status: z.literal('CANCELLED'),
});

export const sofiaFeedbackResponseSchema = z.object({ id: z.string() });

const sofiaCrmDateSchema = z.string().datetime({ offset: true });
const sofiaCrmUnmaskedPhonePattern = /(?:\+?57[\s-]?)?3(?:[\s-]?\d){9}/;
const sofiaCrmSafeTextSchema = z
  .string()
  .refine((value) => !sofiaCrmUnmaskedPhonePattern.test(value), 'El texto CRM contiene una identidad sin enmascarar.');
const sofiaCrmSafeTimelineTextSchema = z
  .string()
  .max(1_000)
  .refine((value) => !sofiaCrmUnmaskedPhonePattern.test(value), 'El timeline CRM contiene una identidad sin enmascarar.');
const sofiaCrmMaskedIdentitySchema = z
  .string()
  .regex(/^\*{3}(?: \*{3} \d{4})?$/, 'La identidad CRM no esta enmascarada.');

export const sofiaCrmCustomerIdentitySchema = z.object({
  id: z.string(),
  type: z.literal('PHONE'),
  valueMasked: sofiaCrmMaskedIdentitySchema,
  isPrimary: z.boolean(),
  verifiedAt: sofiaCrmDateSchema.nullable(),
});

export const sofiaCrmCustomerTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  assignedAt: sofiaCrmDateSchema,
});

export const sofiaCrmCustomerSummarySchema = z.object({
  id: z.string(),
  displayName: sofiaCrmSafeTextSchema.nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  identities: z.array(sofiaCrmCustomerIdentitySchema),
  tags: z.array(sofiaCrmCustomerTagSchema),
  createdAt: sofiaCrmDateSchema,
  updatedAt: sofiaCrmDateSchema,
});

export const sofiaCrmPaginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
});

export const sofiaCrmCustomersSchema = z.object({
  data: z.array(sofiaCrmCustomerSummarySchema),
  pagination: sofiaCrmPaginationSchema,
});

export const sofiaCrmCustomerConsentSchema = z.object({
  id: z.string(),
  purpose: z.enum(['MARKETING', 'SERVICE']),
  channel: z.enum(['WHATSAPP', 'SMS', 'PHONE']),
  status: z.enum(['GRANTED', 'REVOKED']),
  source: z.string(),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  version: z.number().int().positive(),
  grantedAt: sofiaCrmDateSchema.nullable(),
  revokedAt: sofiaCrmDateSchema.nullable(),
  createdAt: sofiaCrmDateSchema,
});

export const sofiaCrmCustomerInteractionSchema = z.object({
  id: z.string(),
  kind: z.string(),
  channel: z.enum(['WHATSAPP', 'PHONE', 'IN_PERSON', 'SYSTEM']),
  direction: z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL']),
  summary: sofiaCrmSafeTimelineTextSchema,
  occurredAt: sofiaCrmDateSchema,
  createdAt: sofiaCrmDateSchema,
});

export const sofiaCrmCustomerDetailSchema = sofiaCrmCustomerSummarySchema.extend({
  consents: z.array(sofiaCrmCustomerConsentSchema),
  timeline: z.array(sofiaCrmCustomerInteractionSchema),
});

export const sofiaCrmCustomerTimelineSchema = z.object({
  data: z.array(sofiaCrmCustomerInteractionSchema),
  pagination: sofiaCrmPaginationSchema,
});

export type SofiaSandboxAgentResult = z.infer<typeof sofiaSandboxAgentResultSchema>;
export type SofiaSandboxRecoveryResult = z.infer<typeof sofiaSandboxRecoveryResultSchema>;
export type SofiaQrStatus = z.infer<typeof sofiaQrStatusSchema>;
export type SofiaQrInboundTestResult = z.infer<typeof sofiaQrInboundTestResultSchema>;
export type SofiaQrSendBlockedResult = z.infer<typeof sofiaQrSendBlockedResultSchema>;
export type SofiaConversationsInbox = z.infer<typeof sofiaConversationsInboxSchema>;
export type SofiaInboxConversation = z.infer<typeof inboxConversationSchema>;
export type SofiaInboxScope = SofiaInboxConversation['scope'];
export type SofiaCrmCustomerSummary = z.infer<typeof sofiaCrmCustomerSummarySchema>;
export type SofiaCrmCustomerDetail = z.infer<typeof sofiaCrmCustomerDetailSchema>;
export type SofiaCrmCustomerConsent = z.infer<typeof sofiaCrmCustomerConsentSchema>;
export type SofiaCrmCustomerInteraction = z.infer<typeof sofiaCrmCustomerInteractionSchema>;
