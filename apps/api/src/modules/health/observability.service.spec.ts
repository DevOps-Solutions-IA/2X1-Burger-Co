import type { PrismaService } from '../../prisma/prisma.service';
import { ObservabilityService } from './observability.service';
import { OperationalAlertPolicy } from './operational-alert-policy';
import type { OperationalBacklogService, OperationalBacklogSnapshot } from './operational-backlog.service';

describe('ObservabilityService', () => {
  const originalEnv = {
    realSend: process.env.WHATSAPP_QR_ALLOW_REAL_SEND,
    autoReply: process.env.SOFIA_AUTO_REPLY_ENABLED,
    autoSafe: process.env.SOFIA_AUTO_SAFE_ENABLED,
    production: process.env.SOFIA_PRODUCTION_ENABLED,
    recovery: process.env.RECOVERY_STATUS_PATH,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries({
      WHATSAPP_QR_ALLOW_REAL_SEND: originalEnv.realSend,
      SOFIA_AUTO_REPLY_ENABLED: originalEnv.autoReply,
      SOFIA_AUTO_SAFE_ENABLED: originalEnv.autoSafe,
      SOFIA_PRODUCTION_ENABLED: originalEnv.production,
      RECOVERY_STATUS_PATH: originalEnv.recovery,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function prismaMock() {
    const count = jest.fn().mockResolvedValue(0);
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      sale: { count },
      orderTicket: { count },
      cashSession: { count },
      inventoryMovement: { count },
      sofiaAutoSafeDecisionEvent: { count },
      whatsappInboundEvent: { count },
      whatsappConversation: { count },
      whatsappOutboundMessage: { count },
      auditLog: { count },
    } as unknown as PrismaService;
  }

  function operationalSnapshot(overrides: Partial<OperationalBacklogSnapshot> = {}): OperationalBacklogSnapshot {
    return {
      available: true,
      collectedAt: '2026-08-09T12:00:00.000Z',
      notifications: { active: 0, pending: 0, claimed: 0, commandPending: 0, dispatched: 0, failed: 0, unknownResult: 0, expiredLeases: 0, retryReady: 0, oldestActiveAgeSeconds: 0 },
      paymentWebhooks: { active: 0, retryReady: 0, expiredLeases: 0, financialReviewRequired: 0, invalidRecent: 0, oldestActiveAgeSeconds: 0 },
      whatsappInbound: { active: 0, retryReady: 0, expiredLeases: 0, attemptsExhausted: 0, missingDeterministicResult: 0, oldestActiveAgeSeconds: 0 },
      secureCommands: { active: 0, failed: 0, retryReady: 0, expiredLeases: 0, unknownResult: 0, oldestActiveAgeSeconds: 0 },
      commerce: { checkoutPaymentPending: 0, checkoutFinancialReviewRequired: 0, paymentPending: 0, paymentUnknownResult: 0, paymentFinancialReviewRequired: 0 },
      ...overrides,
    };
  }

  function service(snapshot = operationalSnapshot()) {
    const backlog = { snapshot: jest.fn().mockResolvedValue(snapshot) } as unknown as OperationalBacklogService;
    return new ObservabilityService(prismaMock(), backlog, new OperationalAlertPolicy());
  }

  it('publishes bounded, low-cardinality runtime metrics', async () => {
    process.env.WHATSAPP_QR_ALLOW_REAL_SEND = 'false';
    process.env.SOFIA_AUTO_REPLY_ENABLED = 'false';
    process.env.SOFIA_AUTO_SAFE_ENABLED = 'false';
    process.env.SOFIA_PRODUCTION_ENABLED = 'false';
    delete process.env.RECOVERY_STATUS_PATH;
    const subject = service();
    subject.recordHttp({ durationMs: 12, statusCode: 200 });
    subject.recordHttp({ durationMs: 25, statusCode: 503 });
    const snapshot = await subject.snapshot();
    expect(snapshot.status).toBe('READY');
    expect(snapshot.metrics.http).toMatchObject({ requestsTotal: 2, errorsTotal: 1 });
    expect(snapshot.metrics.effectiveFlags).toEqual({
      realSendingEnabled: false,
      autoReplyEnabled: false,
      autoSafeEnabled: false,
      productionEnabled: false,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:phone|orderId|userId|requestId)"\s*:/i);
    expect(snapshot.metrics.business).toBeNull();
    expect(snapshot.metrics.sofiaWhatsapp).toBeNull();

    const protectedSnapshot = await subject.snapshot({ includeBusiness: true });
    expect(protectedSnapshot.metrics.business).not.toBeNull();
  });

  it('evaluates unsafe runtime flags as critical alerts', async () => {
    process.env.WHATSAPP_QR_ALLOW_REAL_SEND = 'true';
    process.env.SOFIA_AUTO_SAFE_ENABLED = 'true';
    process.env.SOFIA_PRODUCTION_ENABLED = 'true';
    const snapshot = await service().snapshot();
    expect(snapshot.alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining(['REAL_SEND_UNEXPECTED', 'AUTO_SAFE_UNEXPECTED', 'PRODUCTION_UNEXPECTED']),
    );
  });

  it('exposes durable backlog alerts without high-cardinality labels', async () => {
    const snapshot = await service(operationalSnapshot({
      commerce: {
        checkoutPaymentPending: 2,
        checkoutFinancialReviewRequired: 1,
        paymentPending: 2,
        paymentUnknownResult: 1,
        paymentFinancialReviewRequired: 1,
      },
    })).snapshot();

    expect(snapshot.alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining(['PAYMENT_UNKNOWN_RESULT', 'FINANCIAL_REVIEW_REQUIRED']),
    );
    expect(JSON.stringify(snapshot.metrics.operational)).not.toMatch(/phone|customerId|orderId|requestId|payload/i);
  });
});
