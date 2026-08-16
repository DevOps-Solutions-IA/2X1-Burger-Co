import { z } from 'zod';

const nullableString = z.string().nullable();
const record = z.record(z.string(), z.unknown());

/* ------------------------------------------------------------------ */
/*  Centro de Control — resumen, gobernanza, runtime safety            */
/* ------------------------------------------------------------------ */

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
}).catchall(z.unknown());

const sofiaMetricsRangeCountEntrySchema = z.object({ key: z.string(), count: z.number() });

export const sofiaMetricsSummarySchema = z.object({
  generatedAt: z.string(),
  range: z.enum(['today', '7d', '30d']),
  conversations: z.object({
    total: z.number(),
    active: z.number(),
    humanRequired: z.number(),
    humanTaken: z.number(),
    paused: z.number(),
    resolved: z.number(),
    averageResponseDraftTimeMs: z.number().nullable(),
  }),
  inbound: z.object({
    total: z.number(),
    qrGateway: z.number(),
    simulated: z.number(),
    allowlistBlocked: z.number(),
    duplicatesIgnored: z.number(),
    mediaWithoutTranscript: z.number(),
  }),
  outbound: z.object({
    suggested: z.number(),
    draftOnly: z.number(),
    approvalPending: z.number(),
    blockedRealSend: z.number(),
    sentReal: z.number(),
  }),
  autoSafe: z.object({
    total: z.number(),
    approved: z.number(),
    humanRequired: z.number(),
    blocked: z.number(),
    draftOnly: z.number(),
    topReasonCodes: z.array(sofiaMetricsRangeCountEntrySchema),
    riskLevels: z.array(sofiaMetricsRangeCountEntrySchema),
  }),
  catalog: z.object({
    productMentions: z.array(sofiaMetricsRangeCountEntrySchema),
    unknownProducts: z.number(),
    unknownPrices: z.number(),
    maxiFamilyCorrections: z.number(),
  }),
  payments: z.object({
    paymentSensitiveMessages: z.number(),
    paidClaimsBlocked: z.number(),
    whatsappCanMarkPaid: z.literal(false),
  }),
  memory: z.object({
    customersWithMemory: z.number(),
    updatedToday: z.number(),
    optOuts: z.number(),
    memoryUncertain: z.number(),
  }),
  safety: z.object({
    safetyBlocks: z.number(),
    prohibitedPhraseBlocks: z.number(),
    inventedPromotionBlocks: z.number(),
  }),
  governance: z.object({
    productionStatus: z.string(),
    activeBlockers: z.array(z.string()),
    killSwitchState: z.enum(['KILLED', 'PAUSED', 'ACTIVE']),
    qrReceiveOnlyStatus: z.string(),
  }),
  system: z.object({
    health: z.string(),
    lastBackupAt: nullableString,
    logSanitizationStatus: z.string(),
    retentionStatus: z.string(),
    alertsOpen: z.number(),
    alertsCritical: z.number(),
  }),
});

export const sofiaGovernanceStatusSchema = z.object({
  globalPaused: z.boolean(),
  killSwitchActive: z.boolean(),
  qrRealAllowed: z.boolean(),
  deepSeekRealAllowed: z.boolean(),
  autoSafeProductionAllowed: z.boolean(),
  secretRotationStatus: z.string(),
  phase: z.string(),
});

export const sofiaGovernanceActionResponseSchema = z.object({
  status: z.literal('PASS'),
  message: z.string(),
}).catchall(z.unknown());

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

export const sofiaSecurityStatusSchema = z.object({
  generatedAt: z.string(),
  secretsVisible: z.literal(false),
  sanitized: z.literal(true),
  secretRotationStatus: z.string(),
}).catchall(z.unknown());

export const sofiaRuntimeSafetySchema = z.object({
  generatedAt: z.string(),
  noSecrets: z.literal(true),
  noPii: z.literal(true),
  state: z.object({
    policy: z.string(),
    declared: z.object({
      realSendingEnabled: z.boolean(),
      autoReplyEnabled: z.boolean(),
      autoSafeEnabled: z.boolean(),
      productionEnabled: z.boolean(),
    }),
    effective: z.object({
      realSendingEnabled: z.literal(false),
      autoReplyEnabled: z.literal(false),
      autoSafeEnabled: z.literal(false),
      productionEnabled: z.literal(false),
      whatsappCanMarkPaid: z.literal(false),
    }),
    globalPaused: z.boolean(),
    killSwitchActive: z.boolean(),
    automationBlocked: z.boolean(),
    precedence: z.array(z.string()),
  }),
  counters: z.object({
    messages_received_total: z.number(),
    messages_blocked_total: z.number(),
    send_attempts_total: z.number(),
    send_blocked_total: z.number(),
    duplicate_events_total: z.number(),
    payment_sensitive_total: z.number(),
    human_escalations_total: z.number(),
    auto_reply_attempts_total: z.number(),
    auto_safe_attempts_total: z.number(),
    timeout_total: z.number(),
    allowlist_denied_total: z.number(),
  }),
});

/* ------------------------------------------------------------------ */
/*  WhatsApp QR / Conversaciones                                       */
/* ------------------------------------------------------------------ */

export const sofiaQrStatusSchema = z.object({
  provider: z.literal('qr_gateway'),
  mode: z.enum(['disabled', 'receive_only']),
  status: z.enum([
    'DISABLED', 'DISCONNECTED', 'CONNECTING', 'WAITING_QR', 'QR_READY',
    'CONNECTED', 'RECONNECTING', 'FAILED', 'LOGGED_OUT',
  ]),
  ok: z.boolean(),
  connected: z.boolean(),
  adapterReal: z.boolean(),
  phoneNumber: nullableString,
  deviceName: nullableString,
  qrAvailable: z.boolean(),
  qrImageDataUrl: nullableString,
  qrIssuedAt: nullableString,
  qrExpiresAt: nullableString,
  lastQrAt: nullableString,
  lastConnectedAt: nullableString,
  lastDisconnectedAt: nullableString,
  lastError: nullableString,
  lastErrorCode: nullableString,
  lastErrorMessage: nullableString,
  sessionName: z.string(),
  storageWritable: z.boolean(),
  sessionStorageReady: z.boolean(),
  inboundToday: z.number(),
  outboundToday: z.number(),
  pendingOutbound: z.number(),
  realSendingEnabled: z.literal(false),
  autoReplyEnabled: z.literal(false),
  deepSeekEnabled: z.boolean(),
  productionBlocked: z.literal(true),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  reason: nullableString,
  operatorMessage: z.string(),
  updatedAt: z.string(),
}).catchall(z.unknown());

const inboxConversationSchema = z.object({
  id: z.string(),
  scope: z.enum(['real', 'internal_validation', 'sandbox', 'historical']),
  customerLabel: z.string(),
  phoneMasked: nullableString,
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
  messages: z.array(
    z.object({
      id: z.string(),
      direction: z.enum(['INBOUND', 'OUTBOUND', 'SYSTEM']),
      status: z.string(),
      bodyPreview: nullableString,
      aiIntent: nullableString,
      confidence: z.number().nullable(),
      createdAt: z.string(),
    }),
  ),
}).catchall(z.unknown());

const inboxGroupSchema = z.object({
  total: z.number(),
  hiddenByDefault: z.boolean().optional(),
  conversations: z.array(inboxConversationSchema),
});

export const sofiaConversationsInboxSchema = z.object({
  generatedAt: z.string(),
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
  security: record,
}).catchall(z.unknown());

/* ------------------------------------------------------------------ */
/*  Validación — SecureCommand                                         */
/* ------------------------------------------------------------------ */

export const secureCommandStatusSchema = z.enum([
  'RECEIVED', 'VALIDATED', 'APPROVAL_REQUIRED', 'APPROVED', 'CLAIMED',
  'EXECUTING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'EXPIRED',
]);

export const secureCommandTypeSchema = z.enum([
  'SOFIA_INTERNAL_VALIDATE', 'SOFIA_CREATE_ORDER', 'SOFIA_SEND_WHATSAPP',
  'SOFIA_MARK_PAYMENT', 'SOFIA_DEDUCT_STOCK', 'SOFIA_MUTATE_CASH',
  'SOFIA_CREATE_SALE', 'SOFIA_ASSIGN_DELIVERY', 'SOFIA_CUSTOMER_AUTO_RESPONSE',
]);

export const secureCommandResultSchema = z.object({
  resultCode: z.string(),
  domainReferenceIds: z.array(z.string()),
  createdAt: z.string().optional(),
}).catchall(z.unknown()).nullable();

export const secureCommandRecordSchema = z.object({
  id: z.string(),
  commandType: z.string(),
  scope: z.string(),
  idempotencyKey: z.string(),
  status: secureCommandStatusSchema,
  actorId: z.string(),
  actorType: z.string(),
  source: z.string(),
  targetType: z.string(),
  targetId: nullableString,
  expectedVersion: nullableString,
  correlationId: nullableString,
  traceId: nullableString,
  claimedAt: nullableString,
  completedAt: nullableString,
  failureClass: nullableString,
  failureCode: nullableString,
  retryable: z.boolean(),
  version: z.number(),
  expiresAt: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  result: secureCommandResultSchema,
}).catchall(z.unknown());

export const secureCommandsPageSchema = z.object({
  items: z.array(secureCommandRecordSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

export const secureCommandApprovalSchema = z.object({
  id: z.string(),
  commandId: z.string(),
  approverActorId: z.string(),
  status: z.enum(['APPROVED', 'REVOKED', 'EXPIRED']),
  grantedAt: z.string(),
  expiresAt: z.string(),
  revokedAt: nullableString,
  reasonCode: z.string(),
  policyReference: z.string(),
}).catchall(z.unknown());

export const secureCommandDetailSchema = z.object({
  command: secureCommandRecordSchema,
  approvals: z.array(secureCommandApprovalSchema),
});

/* ------------------------------------------------------------------ */
/*  Validación — Servicio al Cliente (escalaciones de SOFIA)           */
/* ------------------------------------------------------------------ */

const sofiaCustomerServiceCaseStatusSchema = z.enum([
  'OPEN', 'HUMAN_REQUIRED', 'HUMAN_TAKEN', 'RESOLVED', 'CLOSED',
]);

export const sofiaCustomerServiceCaseSummarySchema = z.object({
  id: z.string(),
  status: sofiaCustomerServiceCaseStatusSchema,
  category: z.string(),
  source: z.string(),
  sanitizedSummary: nullableString.optional(),
  customerId: nullableString.optional(),
  customer: z.object({ id: z.string(), displayName: nullableString, status: z.string() }).nullable().optional(),
  conversationId: nullableString.optional(),
  orderCheckoutId: nullableString.optional(),
  orderTicketId: nullableString.optional(),
  paymentIntentId: nullableString.optional(),
  deliveryIssueId: nullableString.optional(),
  assignedActor: z.object({ id: z.string(), fullName: nullableString, accessName: nullableString }).nullable().optional(),
  resolutionCode: nullableString.optional(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).catchall(z.unknown());

export const sofiaCustomerServiceCasesSchema = z.object({
  items: z.array(sofiaCustomerServiceCaseSummarySchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

export const sofiaCustomerServiceCaseEventSchema = z.object({
  id: z.string(),
  version: z.number(),
  action: z.string(),
  fromStatus: nullableString.optional(),
  toStatus: z.string(),
  actorId: nullableString.optional(),
  reasonCode: nullableString.optional(),
  createdAt: z.string(),
}).catchall(z.unknown());

export const sofiaCustomerServiceCaseDetailSchema = sofiaCustomerServiceCaseSummarySchema.extend({
  orderCheckout: record.nullable().optional(),
  orderTicket: record.nullable().optional(),
  paymentIntent: record.nullable().optional(),
  deliveryIssue: record.nullable().optional(),
  events: z.array(sofiaCustomerServiceCaseEventSchema),
});

export const sofiaCustomerServiceTransitionResultSchema = z.object({
  state: z.enum(['CREATED', 'UPDATED', 'DETERMINISTIC_REPLAY']),
  serviceCase: sofiaCustomerServiceCaseSummarySchema,
});

/* ------------------------------------------------------------------ */
/*  CRM — identidad enmascarada / consentimiento (invariantes)         */
/* ------------------------------------------------------------------ */

const sofiaCrmDateSchema = z.string();
const sofiaCrmUnmaskedPhonePattern = /(?:\+?57[\s-]?)?3(?:[\s-]?\d){9}/;
const sofiaCrmSafeTextSchema = z
  .string()
  .refine((value) => !sofiaCrmUnmaskedPhonePattern.test(value), 'El texto CRM contiene una identidad sin enmascarar.');
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

export const sofiaCrmCustomerSegmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  addedAt: sofiaCrmDateSchema,
});

export const sofiaCrmCustomerSummarySchema = z.object({
  id: z.string(),
  displayName: sofiaCrmSafeTextSchema.nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  identities: z.array(sofiaCrmCustomerIdentitySchema),
  tags: z.array(sofiaCrmCustomerTagSchema),
  createdAt: sofiaCrmDateSchema,
  updatedAt: sofiaCrmDateSchema,
}).catchall(z.unknown());

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
  evidenceHash: z.string(),
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
  summary: z.string(),
  occurredAt: sofiaCrmDateSchema,
  createdAt: sofiaCrmDateSchema,
});

export const sofiaCrmCampaignDeliverySchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  recipientMasked: z.string(),
  status: z.enum(['PENDING', 'BLOCKED', 'CANCELLED']),
  blockedReason: nullableString,
  attemptedAt: sofiaCrmDateSchema.nullable(),
  createdAt: sofiaCrmDateSchema,
});

export const sofiaCrmCustomerDetailSchema = sofiaCrmCustomerSummarySchema.extend({
  consents: z.array(sofiaCrmCustomerConsentSchema),
  timeline: z.array(sofiaCrmCustomerInteractionSchema),
  segments: z.array(sofiaCrmCustomerSegmentSchema),
  deliveries: z.array(sofiaCrmCampaignDeliverySchema),
});

/* ------------------------------------------------------------------ */
/*  CRM — segmentos, tags, pipelines, leads, tareas, notas, campañas   */
/* ------------------------------------------------------------------ */

export const sofiaCrmSegmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: nullableString,
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  createdAt: sofiaCrmDateSchema,
  updatedAt: sofiaCrmDateSchema,
  _count: z.object({ memberships: z.number(), campaigns: z.number() }),
});

export const sofiaCrmSegmentsPageSchema = z.object({
  data: z.array(sofiaCrmSegmentSchema),
  pagination: sofiaCrmPaginationSchema,
});

export const sofiaCrmTagSchema = z.object({ id: z.string(), name: z.string() });
export const sofiaCrmTagsPageSchema = z.object({ data: z.array(sofiaCrmTagSchema), pagination: sofiaCrmPaginationSchema });

export const sofiaCrmPipelineStageSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  name: z.string(),
  position: z.number(),
  outcome: z.enum(['OPEN', 'WON', 'LOST']),
});

export const sofiaCrmPipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: nullableString,
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  stages: z.array(sofiaCrmPipelineStageSchema),
  _count: z.object({ leads: z.number() }),
  createdAt: sofiaCrmDateSchema,
  updatedAt: sofiaCrmDateSchema,
});

export const sofiaCrmPipelinesPageSchema = z.object({
  data: z.array(sofiaCrmPipelineSchema),
  pagination: sofiaCrmPaginationSchema,
});

const crmLeadStatusSchema = z.enum(['NEW', 'QUALIFIED', 'ACTIVE', 'WON', 'LOST', 'ARCHIVED']);
const crmLeadSourceSchema = z.enum(['WHATSAPP', 'POS', 'DELIVERY', 'CUSTOMER_SERVICE', 'AUTHORIZED_OPERATOR']);

export const sofiaCrmLeadSummarySchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customer: z.object({ id: z.string(), displayName: nullableString, status: z.string() }),
  pipelineId: z.string(),
  pipeline: z.object({ id: z.string(), name: z.string(), status: z.string() }),
  currentStageId: z.string(),
  currentStage: z.object({ id: z.string(), name: z.string(), position: z.number(), outcome: z.string() }),
  source: crmLeadSourceSchema,
  sourceReference: z.string(),
  title: z.string(),
  status: crmLeadStatusSchema,
  ownerId: nullableString,
  owner: z.object({ id: z.string(), fullName: z.string(), isActive: z.boolean() }).nullable(),
  version: z.number(),
  qualifiedAt: nullableString,
  wonAt: nullableString,
  lostAt: nullableString,
  createdAt: sofiaCrmDateSchema,
  updatedAt: sofiaCrmDateSchema,
});

export const sofiaCrmLeadsPageSchema = z.object({
  data: z.array(sofiaCrmLeadSummarySchema),
  pagination: sofiaCrmPaginationSchema,
});

export const sofiaCrmLeadStageHistorySchema = z.object({
  id: z.string(),
  version: z.number(),
  fromStageId: nullableString,
  toStageId: z.string(),
  fromStatus: nullableString,
  toStatus: z.string(),
  actorId: nullableString,
  reasonCode: z.string(),
  createdAt: sofiaCrmDateSchema,
});

export const sofiaCrmLeadDetailSchema = sofiaCrmLeadSummarySchema.extend({
  pipeline: z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    stages: z.array(sofiaCrmPipelineStageSchema),
  }),
  currentStage: sofiaCrmPipelineStageSchema,
  stageHistory: z.array(sofiaCrmLeadStageHistorySchema),
});

const crmTaskTypeSchema = z.enum(['TASK', 'FOLLOW_UP']);
const crmTaskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
const crmTaskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export const sofiaCrmTaskSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customer: z.object({ id: z.string(), displayName: nullableString }),
  leadId: nullableString,
  lead: z.object({ id: z.string(), title: z.string(), status: z.string() }).nullable(),
  customerServiceCaseId: nullableString,
  source: z.string(),
  sourceReference: z.string(),
  type: crmTaskTypeSchema,
  status: crmTaskStatusSchema,
  priority: crmTaskPrioritySchema,
  title: z.string(),
  sanitizedDescription: nullableString,
  assignedToId: nullableString,
  assignedTo: z.object({ id: z.string(), fullName: z.string(), isActive: z.boolean() }).nullable(),
  dueAt: nullableString,
  completedAt: nullableString,
  cancelledAt: nullableString,
  version: z.number(),
  createdAt: sofiaCrmDateSchema,
  updatedAt: sofiaCrmDateSchema,
});

export const sofiaCrmTasksPageSchema = z.object({
  data: z.array(sofiaCrmTaskSchema),
  pagination: sofiaCrmPaginationSchema,
});

export const sofiaCrmNoteSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  leadId: nullableString,
  customerServiceCaseId: nullableString,
  source: z.string(),
  sourceReference: z.string(),
  sanitizedBody: z.string().optional(),
  body: z.string().optional(),
  author: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  createdAt: sofiaCrmDateSchema,
}).catchall(z.unknown());

export const sofiaCrmNotesPageSchema = z.object({
  data: z.array(sofiaCrmNoteSchema),
  pagination: sofiaCrmPaginationSchema,
});

export const sofiaCrmCampaignSchema = z.object({
  id: z.string(),
  segmentId: nullableString,
  segment: z.object({ id: z.string(), name: z.string() }).nullable(),
  name: z.string(),
  channel: z.string(),
  messageTemplate: z.string(),
  status: z.enum(['DRAFT', 'BLOCKED', 'CANCELLED']),
  blockedReason: nullableString,
  createdAt: sofiaCrmDateSchema,
  updatedAt: sofiaCrmDateSchema,
  _count: z.object({ deliveries: z.number() }),
});

export const sofiaCrmCampaignsPageSchema = z.object({
  data: z.array(sofiaCrmCampaignSchema),
  pagination: sofiaCrmPaginationSchema,
});

export const sofiaCrmCampaignSendResultSchema = record;

/* ------------------------------------------------------------------ */
/*  Tipos                                                              */
/* ------------------------------------------------------------------ */

export type SofiaDashboardSummary = z.infer<typeof sofiaDashboardSummarySchema>;
export type SofiaMetricsSummary = z.infer<typeof sofiaMetricsSummarySchema>;
export type SofiaMetricsRange = 'today' | '7d' | '30d';
export type SofiaGovernanceStatus = z.infer<typeof sofiaGovernanceStatusSchema>;
export type SofiaReadiness = z.infer<typeof sofiaReadinessSchema>;
export type SofiaGovernanceEvents = z.infer<typeof sofiaGovernanceEventsSchema>;
export type SofiaAlerts = z.infer<typeof sofiaAlertsSchema>;
export type SofiaAlert = SofiaAlerts[number];
export type SofiaSecurityStatus = z.infer<typeof sofiaSecurityStatusSchema>;
export type SofiaRuntimeSafety = z.infer<typeof sofiaRuntimeSafetySchema>;
export type SofiaQrStatus = z.infer<typeof sofiaQrStatusSchema>;
export type SofiaConversationsInbox = z.infer<typeof sofiaConversationsInboxSchema>;
export type SofiaInboxConversation = z.infer<typeof inboxConversationSchema>;
export type SecureCommandStatus = z.infer<typeof secureCommandStatusSchema>;
export type SecureCommandType = z.infer<typeof secureCommandTypeSchema>;
export type SecureCommandRecord = z.infer<typeof secureCommandRecordSchema>;
export type SecureCommandDetail = z.infer<typeof secureCommandDetailSchema>;
export type SofiaCustomerServiceCaseSummary = z.infer<typeof sofiaCustomerServiceCaseSummarySchema>;
export type SofiaCustomerServiceCaseDetail = z.infer<typeof sofiaCustomerServiceCaseDetailSchema>;
export type SofiaCustomerServiceCaseEvent = z.infer<typeof sofiaCustomerServiceCaseEventSchema>;
export type SofiaCustomerServiceTransitionResult = z.infer<typeof sofiaCustomerServiceTransitionResultSchema>;
export type SofiaCrmCustomerSummary = z.infer<typeof sofiaCrmCustomerSummarySchema>;
export type SofiaCrmCustomerDetail = z.infer<typeof sofiaCrmCustomerDetailSchema>;
export type SofiaCrmSegment = z.infer<typeof sofiaCrmSegmentSchema>;
export type SofiaCrmTag = z.infer<typeof sofiaCrmTagSchema>;
export type SofiaCrmPipeline = z.infer<typeof sofiaCrmPipelineSchema>;
export type SofiaCrmPipelineStage = z.infer<typeof sofiaCrmPipelineStageSchema>;
export type SofiaCrmLeadSummary = z.infer<typeof sofiaCrmLeadSummarySchema>;
export type SofiaCrmLeadDetail = z.infer<typeof sofiaCrmLeadDetailSchema>;
export type SofiaCrmTask = z.infer<typeof sofiaCrmTaskSchema>;
export type SofiaCrmNote = z.infer<typeof sofiaCrmNoteSchema>;
export type SofiaCrmCampaign = z.infer<typeof sofiaCrmCampaignSchema>;
