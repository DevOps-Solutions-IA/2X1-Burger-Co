import { z } from 'zod';

const nullableString = z.string().nullable();

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.object({ permission: z.object({ code: z.string() }) })).optional(),
});

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  accessName: nullableString,
  hasAccessCode: z.boolean(),
  isActive: z.boolean(),
  lastLoginAt: nullableString,
  createdAt: z.string(),
  roles: z.array(roleSchema.pick({ id: true, name: true })),
});

export const usersSchema = z.array(userSchema);
export const rolesSchema = z.array(roleSchema);

export const auditResultSchema = z.enum([
  'SUCCESS',
  'REJECTED',
  'FAILED',
  'CONFLICT',
  'BLOCKED',
  'NO_OP',
  'ROLLED_BACK',
]);

export const auditEventSchema = z.object({
  id: z.string(),
  eventVersion: z.number(),
  timestamp: z.string(),
  actorId: nullableString,
  actorType: z.enum(['USER', 'SYSTEM', 'PROVIDER']),
  actorRole: nullableString,
  action: z.string(),
  module: z.string(),
  entityType: z.string(),
  entityId: nullableString,
  result: auditResultSchema,
  reasonCode: nullableString,
  reasonText: nullableString,
  requestId: nullableString,
  correlationId: nullableString,
  traceId: nullableString,
  idempotencyKey: nullableString,
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  metadata: z.unknown().optional(),
  source: z.string(),
  environment: nullableString,
  releaseVersion: nullableString,
  legacy: z.boolean(),
  contextAvailable: z.boolean(),
});

export const auditPageSchema = z.object({
  data: z.array(auditEventSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    pages: z.number(),
  }),
});

export const settingRecordSchema = z.object({
  key: z.string(),
  category: nullableString,
  description: nullableString,
  value: z.record(z.unknown()),
});

export const settingsSchema = z.array(settingRecordSchema);

export const operationsStatusSchema = z.object({
  backup: z.object({
    cronExpression: z.string(),
    nextRunAt: nullableString,
    latest: z.object({
      fileName: z.string(),
      absolutePath: z.string(),
      sizeBytes: z.number(),
      createdAt: z.string(),
    }).nullable(),
  }),
  catalogSyncEvents: z.array(z.object({
    id: z.string(),
    action: z.string(),
    createdAt: z.string(),
    entityId: nullableString,
    actor: z.string(),
    source: nullableString,
    reason: nullableString,
  })),
});

const readinessStatusSchema = z.enum(['PASS', 'WARNING', 'BLOCKED']);

export const enterpriseStatusSchema = z.object({
  generatedAt: z.string(),
  overallStatus: z.enum(['READY_FOR_SANDBOX', 'BLOCKED_FOR_PRODUCTION', 'WARNING', 'ERROR']),
  productionReadiness: z.object({
    status: readinessStatusSchema,
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
    nextRequiredAction: z.string(),
    checklist: z.array(z.object({
      key: z.string(),
      label: z.string(),
      status: readinessStatusSchema,
      reason: z.string(),
      evidence: z.string(),
    })),
  }),
  security: z.object({
    secretRotationStatus: z.enum(['PENDING', 'COMPLETE', 'UNKNOWN']),
    canActivateQrReal: z.boolean(),
    canActivateDeepSeekReal: z.boolean(),
    canActivateAutoSafeProduction: z.boolean(),
    blockers: z.array(z.string()),
  }),
  sofia: z.object({
    enabled: z.boolean(),
    globalPaused: z.boolean(),
    killSwitchActive: z.boolean(),
    mode: z.string(),
    activePromptVersion: nullableString,
    promptStatus: nullableString,
    promptUpdatedAt: nullableString,
  }),
  ai: z.object({
    provider: z.string(),
    mode: z.string(),
    deepSeekEnabled: z.boolean(),
    deepSeekReady: z.boolean(),
    fallbackProvider: z.string(),
    healthStatus: readinessStatusSchema,
  }),
  whatsapp: z.object({
    provider: z.string(),
    mode: z.string(),
    qrGatewayReady: z.boolean(),
    qrConnected: z.boolean(),
    qrStatus: z.string().optional(),
    qrSessionName: z.string().optional(),
    qrReceiveOnlyReady: z.boolean().optional(),
    realSendingEnabled: z.boolean(),
    inboundToday: z.number(),
    outboundToday: z.number(),
    pendingOutbound: z.number(),
  }),
  payments: z.object({
    whatsappCanMarkPaid: z.literal(false),
    paymentLinksEnabled: z.boolean(),
    manualPaymentsEnabled: z.boolean(),
    nequiManualEnabled: z.boolean(),
    cashEnabled: z.boolean(),
  }),
  operations: z.object({
    posStatus: readinessStatusSchema,
    deliveriesStatus: readinessStatusSchema,
    checkoutStatus: readinessStatusSchema,
    stockProtected: z.boolean(),
    cashProtected: z.boolean(),
  }),
  conversations: z.object({
    active: z.number(),
    humanRequired: z.number(),
    humanTaken: z.number(),
    paused: z.number(),
    resolvedToday: z.number(),
  }),
  lastEvents: z.array(z.object({
    type: z.string(),
    status: z.string(),
    detail: z.string(),
    createdAt: z.string(),
  })),
}).passthrough();

export const runtimeSafetySchema = z.object({
  generatedAt: z.string(),
  state: z.object({
    policy: z.string(),
    declared: z.object({
      realSendingEnabled: z.boolean(),
      autoReplyEnabled: z.boolean(),
      autoSafeEnabled: z.boolean(),
      productionEnabled: z.boolean(),
    }),
    effective: z.object({
      realSendingEnabled: z.boolean(),
      autoReplyEnabled: z.boolean(),
      autoSafeEnabled: z.boolean(),
      productionEnabled: z.boolean(),
      whatsappCanMarkPaid: z.boolean(),
    }),
    globalPaused: z.boolean(),
    killSwitchActive: z.boolean(),
    automationBlocked: z.boolean(),
    precedence: z.array(z.string()),
  }),
  counters: z.record(z.number()),
  noSecrets: z.boolean(),
  noPii: z.boolean(),
});

export const qrStatusSchema = z.object({
  provider: z.literal('qr_gateway'),
  mode: z.enum(['disabled', 'receive_only', 'supervised', 'auto_safe']),
  status: z.enum(['DISABLED', 'DISCONNECTED', 'CONNECTING', 'WAITING_QR', 'QR_READY', 'CONNECTED', 'RECONNECTING', 'FAILED', 'LOGGED_OUT']),
  ok: z.boolean(),
  connected: z.boolean(),
  adapterReal: z.boolean(),
  phoneNumber: nullableString,
  deviceName: nullableString,
  qrAvailable: z.boolean(),
  qrIssuedAt: nullableString,
  qrExpiresAt: nullableString,
  lastConnectedAt: nullableString,
  lastDisconnectedAt: nullableString,
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
  productionBlocked: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  reason: nullableString,
  operatorMessage: z.string(),
  updatedAt: z.string(),
}).passthrough();

export type UserRecord = z.infer<typeof userSchema>;
export type RoleRecord = z.infer<typeof roleSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditResult = z.infer<typeof auditResultSchema>;
export type SettingsRecord = z.infer<typeof settingRecordSchema>;
export type EnterpriseStatus = z.infer<typeof enterpriseStatusSchema>;
