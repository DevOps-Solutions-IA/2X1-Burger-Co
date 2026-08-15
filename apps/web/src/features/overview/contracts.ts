import { z } from 'zod';

export const commercialValueSchema = z.union([z.number(), z.string()]);

export type CustomerAutomationFlags = {
  realSendingEnabled: boolean;
  autoReplyEnabled: boolean;
  autoSafeEnabled: boolean;
  productionEnabled: boolean;
};

export function describeCustomerAutomation(flags: CustomerAutomationFlags) {
  const enabled = [
    flags.productionEnabled && 'Producción habilitada',
    flags.realSendingEnabled && 'WhatsApp outbound habilitado',
    flags.autoReplyEnabled && 'Auto reply habilitado',
    flags.autoSafeEnabled && 'Auto Safe habilitado',
  ].filter(Boolean) as string[];

  if (enabled.length > 0) {
    return { state: 'degraded' as const, details: enabled.join(' · ') };
  }

  return {
    state: 'blocked' as const,
    details: 'Producción, WhatsApp outbound, auto reply y Auto Safe deshabilitados',
  };
}

const bestSellerSchema = z.object({
  productName: z.string(),
  quantity: commercialValueSchema,
  total: commercialValueSchema,
}).passthrough();

const reportBreakdownSchema = z.object({
  name: z.string().optional(),
  label: z.string().optional(),
  channel: z.string().optional(),
  paymentMethod: z.string().optional(),
  count: z.number().optional(),
  total: commercialValueSchema.optional(),
}).passthrough();

const stockAlertSchema = z.object({
  productId: z.string().optional(),
  ingredientId: z.string().optional(),
  productName: z.string().optional(),
  ingredientName: z.string().optional(),
  severity: z.string().optional(),
}).passthrough();

const activeOrderSchema = z.object({
  id: z.string(),
  number: z.union([z.string(), z.number()]),
  status: z.string(),
  type: z.string(),
  tableLabel: z.string().nullable(),
  customerName: z.string().nullable(),
  subtotal: commercialValueSchema,
  itemsCount: commercialValueSchema,
  updatedAt: z.string(),
}).passthrough();

export const operationalReportSchema = z.object({
  period: z.object({
    start: z.string(),
    end: z.string(),
  }).passthrough(),
  journey: z.object({
    status: z.string(),
    openedAt: z.string().nullable().optional(),
    closedAt: z.string().nullable().optional(),
    responsibleUser: z.string().nullable().optional(),
  }).passthrough(),
  cash: z.object({
    expectedAmount: commercialValueSchema.nullable(),
    totalRevenue: commercialValueSchema.optional(),
    totalExpenses: commercialValueSchema.optional(),
  }).passthrough(),
  sales: z.object({
    total: commercialValueSchema,
    count: z.number(),
    itemsSold: commercialValueSchema,
    pendingCount: z.number().optional(),
    canceledCount: z.number().optional(),
    byPaymentMethod: z.array(reportBreakdownSchema),
    byChannel: z.array(reportBreakdownSchema),
    bestSellers: z.array(bestSellerSchema),
  }).passthrough(),
  purchases: z.object({
    total: commercialValueSchema,
    count: z.number(),
  }).passthrough(),
  expenses: z.object({
    total: commercialValueSchema,
    count: z.number(),
  }).passthrough(),
  metrics: z.object({
    costOfSales: commercialValueSchema,
    grossProfit: commercialValueSchema,
    netProfit: commercialValueSchema,
  }).passthrough(),
  replenishment: z.object({
    lowStock: z.array(stockAlertSchema),
    criticalStock: z.array(stockAlertSchema),
    outOfStock: z.array(stockAlertSchema),
    productLowStock: z.array(stockAlertSchema),
    productCriticalStock: z.array(stockAlertSchema),
    productOutOfStock: z.array(stockAlertSchema),
  }).passthrough(),
  operations: z.object({
    activeOrdersCount: z.number(),
    occupiedTablesCount: z.number(),
    activeOrders: z.array(activeOrderSchema),
  }).passthrough().optional(),
  metadata: z.object({
    source: z.string(),
    generatedAt: z.string(),
    snapshotId: z.string().nullable(),
  }).passthrough(),
}).passthrough();

const backlogGroupSchema = z.record(z.string(), z.number());

export const observabilitySchema = z.object({
  status: z.string(),
  metrics: z.object({
    generatedAt: z.string(),
    http: z.object({
      requestsTotal: z.number(),
      errorsTotal: z.number(),
      errorRate: z.number(),
      latencyMs: z.object({
        samples: z.number(),
        p50: z.number().nullable(),
        p95: z.number().nullable(),
        p99: z.number().nullable(),
      }).passthrough(),
      readinessFailuresTotal: z.number(),
    }).passthrough(),
    database: z.object({
      available: z.boolean(),
      queryDurationMs: z.number().nullable(),
      connections: z.number().nullable(),
    }).passthrough(),
    operational: z.object({
      available: z.boolean(),
      notifications: backlogGroupSchema,
      paymentWebhooks: backlogGroupSchema,
      whatsappInbound: backlogGroupSchema,
      secureCommands: backlogGroupSchema,
      commerce: backlogGroupSchema,
    }).passthrough(),
    effectiveFlags: z.object({
      realSendingEnabled: z.boolean(),
      autoReplyEnabled: z.boolean(),
      autoSafeEnabled: z.boolean(),
      productionEnabled: z.boolean(),
    }),
  }).passthrough(),
  alerts: z.array(z.object({
    code: z.string().optional(),
    severity: z.string().optional(),
    message: z.string().optional(),
  }).passthrough()),
}).passthrough();

export const sofiaDashboardSummarySchema = z.object({
  generatedAt: z.string(),
  general: z.object({
    sofiaMode: z.string(),
    globalPaused: z.boolean(),
    killSwitchActive: z.boolean(),
    automationBlocked: z.boolean(),
    productionEnabled: z.boolean(),
    productionBlocked: z.boolean(),
    receiveOnly: z.boolean(),
    realSendingEnabled: z.boolean(),
    autoReplyEnabled: z.boolean(),
    autoSafeEnabled: z.boolean(),
  }).passthrough(),
  whatsappQr: z.object({
    provider: z.string(),
    mode: z.string(),
    status: z.string(),
    connected: z.boolean(),
    inboundToday: z.number(),
    lastInboundAt: z.string().nullable(),
  }).passthrough(),
  ai: z.object({
    aiProvider: z.string(),
    aiMode: z.string(),
    externalProviderEnabled: z.boolean(),
  }).passthrough(),
  conversations: z.object({
    totalConversations: z.number(),
    realConversations: z.number(),
    sandboxConversations: z.number(),
    humanRequired: z.number(),
    pendingReview: z.number(),
  }).passthrough(),
  security: z.object({
    productionReadinessStatus: z.string(),
    blockedChecks: z.array(z.string()),
    pendingChecks: z.array(z.string()),
  }).passthrough(),
}).passthrough();

export type OperationalReport = z.infer<typeof operationalReportSchema>;
export type OperationalOrder = NonNullable<OperationalReport['operations']>['activeOrders'][number];
export type ObservabilitySnapshot = z.infer<typeof observabilitySchema>;
export type SofiaDashboardSummary = z.infer<typeof sofiaDashboardSummarySchema>;
