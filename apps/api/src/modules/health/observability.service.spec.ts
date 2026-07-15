import type { PrismaService } from '../../prisma/prisma.service';
import { ObservabilityService } from './observability.service';

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

  it('publishes bounded, low-cardinality runtime metrics', async () => {
    process.env.WHATSAPP_QR_ALLOW_REAL_SEND = 'false';
    process.env.SOFIA_AUTO_REPLY_ENABLED = 'false';
    process.env.SOFIA_AUTO_SAFE_ENABLED = 'false';
    process.env.SOFIA_PRODUCTION_ENABLED = 'false';
    delete process.env.RECOVERY_STATUS_PATH;
    const service = new ObservabilityService(prismaMock());
    service.recordHttp({ durationMs: 12, statusCode: 200 });
    service.recordHttp({ durationMs: 25, statusCode: 503 });
    const snapshot = await service.snapshot();
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

    const protectedSnapshot = await service.snapshot({ includeBusiness: true });
    expect(protectedSnapshot.metrics.business).not.toBeNull();
  });

  it('evaluates unsafe runtime flags as critical alerts', async () => {
    process.env.WHATSAPP_QR_ALLOW_REAL_SEND = 'true';
    process.env.SOFIA_AUTO_SAFE_ENABLED = 'true';
    process.env.SOFIA_PRODUCTION_ENABLED = 'true';
    const service = new ObservabilityService(prismaMock());
    const snapshot = await service.snapshot();
    expect(snapshot.alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining(['REAL_SEND_UNEXPECTED', 'AUTO_SAFE_UNEXPECTED', 'PRODUCTION_UNEXPECTED']),
    );
  });
});
