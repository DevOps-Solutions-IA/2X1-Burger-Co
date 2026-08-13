import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import { SofiaGovernanceService } from './sofia-governance.service';

describe('SofiaGovernanceService receive-only QR activation', () => {
  const safeConfig: Record<string, unknown> = {
    WHATSAPP_QR_ENABLED: true,
    WHATSAPP_QR_ALLOW_RECEIVE: true,
    WHATSAPP_QR_SANDBOX_ONLY: false,
    WHATSAPP_MODE: 'receive_only',
    WHATSAPP_PROVIDER: 'qr_gateway',
    WHATSAPP_QR_ALLOW_REAL_SEND: false,
    SOFIA_AUTO_REPLY_ENABLED: false,
    SOFIA_AUTO_SAFE_ENABLED: false,
    SOFIA_PRODUCTION_ENABLED: false,
    SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED: false,
    WHATSAPP_QR_SESSION_NAME: 'sofia-main',
    WHATSAPP_EXPECTED_ACCOUNT_ID: '573001234567',
    WHATSAPP_EXPECTED_BUSINESS_IDENTITY: '123456789012345@lid',
    WHATSAPP_EXPECTED_SESSION_OWNER: 'sofia-main',
  };

  function subject(overrides: Record<string, unknown> = {}) {
    const settings = new Map<string, Record<string, unknown>>();
    const settingFindMany = jest.fn().mockImplementation(async () =>
      [...settings.entries()].map(([key, value]) => ({ key, value })),
    );
    const settingUpsert = jest.fn().mockImplementation(async (input) => {
      settings.set(input.where.key, input.create.value);
      return {};
    });
    const auditLog = jest.fn().mockResolvedValue({ id: 'audit-id' });
    const service = new SofiaGovernanceService(
      {
        setting: { findMany: settingFindMany, upsert: settingUpsert },
      } as unknown as PrismaService,
      { log: auditLog } as unknown as AuditService,
      {
        get: (key: string) => ({ ...safeConfig, ...overrides })[key],
      } as unknown as ConfigService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, settingUpsert, auditLog };
  }

  it('allows only the governed receive-only QR capability', async () => {
    const { service, settingUpsert } = subject();

    await expect(service.updateGovernanceSettings('operator-id', { qrRealAllowed: true }))
      .resolves.toMatchObject({ qrRealAllowed: true });

    expect(settingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'SOFIA_QR_REAL_ALLOWED' },
        create: expect.objectContaining({ value: expect.objectContaining({ allowed: true }) }),
      }),
    );
  });

  it.each([
    ['WHATSAPP_QR_ALLOW_RECEIVE', false],
    ['WHATSAPP_QR_SANDBOX_ONLY', true],
    ['WHATSAPP_MODE', 'supervised'],
    ['WHATSAPP_QR_ALLOW_REAL_SEND', true],
    ['SOFIA_AUTO_REPLY_ENABLED', true],
    ['SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED', true],
    ['WHATSAPP_EXPECTED_ACCOUNT_ID', ''],
  ])('blocks QR governance when %s is unsafe', async (key, value) => {
    const { service, settingUpsert } = subject({ [key]: value });

    await expect(service.updateGovernanceSettings('operator-id', { qrRealAllowed: true }))
      .rejects.toMatchObject({ response: expect.objectContaining({ reason: 'PHASE_NOT_READY' }) });
    expect(settingUpsert).not.toHaveBeenCalled();
  });

  it('continues to reject real AI and automatic production activation', async () => {
    const { service } = subject();

    await expect(
      service.updateGovernanceSettings('operator-id', {
        deepSeekRealAllowed: true,
        autoSafeProductionAllowed: true,
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ reason: 'PHASE_NOT_READY' }) });
  });
});

describe('SofiaGovernanceService enterprise receive-only truth', () => {
  function subject() {
    let qrAllowed = false;
    let qrConnected = false;
    const safeConfig: Record<string, unknown> = {
      WHATSAPP_QR_ENABLED: true,
      WHATSAPP_QR_ALLOW_RECEIVE: true,
      WHATSAPP_QR_SANDBOX_ONLY: false,
      WHATSAPP_MODE: 'receive_only',
      WHATSAPP_PROVIDER: 'qr_gateway',
      WHATSAPP_QR_ALLOW_REAL_SEND: false,
      SOFIA_AUTO_REPLY_ENABLED: false,
      SOFIA_AUTO_SAFE_ENABLED: false,
      SOFIA_PRODUCTION_ENABLED: false,
      SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED: false,
      WHATSAPP_QR_SESSION_NAME: 'sofia-main',
      WHATSAPP_EXPECTED_ACCOUNT_ID: '573001234567',
      WHATSAPP_EXPECTED_BUSINESS_IDENTITY: '123456789012345@lid',
      WHATSAPP_EXPECTED_SESSION_OWNER: 'sofia-main',
    };
    const prisma = {
      sofiaAutoSafeDecisionEvent: { findFirst: jest.fn().mockResolvedValue(null) },
      sofiaCustomerMemory: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      sofiaConversationMemory: { count: jest.fn().mockResolvedValue(0) },
      whatsappInboundEvent: { count: jest.fn().mockResolvedValue(0) },
      whatsappOutboundMessage: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SofiaGovernanceService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
      { get: (key: string) => safeConfig[key] } as unknown as ConfigService,
      { getActivePrompt: jest.fn().mockResolvedValue(null) } as never,
      { listActiveItems: jest.fn().mockResolvedValue([]) } as never,
      {
        getStatus: jest.fn().mockReturnValue({
          provider: 'rules',
          mode: 'disabled',
          deepseekEnabled: false,
          safeByDefault: true,
        }),
      } as never,
      {} as never,
      {
        getStatus: jest.fn().mockImplementation(async () => ({
          adapterReal: true,
          connected: qrConnected,
          qrAvailable: !qrConnected,
          mode: 'receive_only',
          status: qrConnected ? 'CONNECTED' : 'QR_READY',
          sessionName: 'sofia-main',
          inboundToday: 0,
          outboundToday: 0,
          pendingOutbound: 0,
          autoReplyEnabled: false,
        })),
      } as never,
      {
        buildChecklist: jest.fn().mockReturnValue([]),
        summarize: jest.fn().mockReturnValue({
          status: 'BLOCKED',
          blockers: [],
          warnings: [],
          nextRequiredAction: 'NONE',
          checklist: [],
        }),
      } as never,
      {
        getState: jest.fn().mockResolvedValue({
          globalPaused: false,
          killSwitchActive: false,
          effective: { autoSafeEnabled: false },
        }),
      } as never,
    );
    const internal = service as unknown as {
      getGovernanceSettings(): Promise<Record<string, Record<string, unknown>>>;
      autoSafeCounts(): Promise<Record<string, unknown>>;
      conversationCounts(): Promise<Record<string, unknown>>;
      lastEvents(): Promise<unknown[]>;
    };
    jest.spyOn(internal, 'getGovernanceSettings').mockImplementation(async () => ({
      globalPaused: { paused: false },
      killSwitch: { active: false },
      autoSafeProductionAllowed: { allowed: false },
      qrRealAllowed: { allowed: qrAllowed },
      deepSeekRealAllowed: { allowed: false },
      secretRotationStatus: { status: 'PENDING' },
    }));
    jest.spyOn(internal, 'autoSafeCounts').mockResolvedValue({
      total: 0,
      approved: 0,
      humanRequired: 0,
      blocked: 0,
      draftOnly: 0,
      topReasonCodes: [],
    });
    jest.spyOn(internal, 'conversationCounts').mockResolvedValue({
      active: 0,
      humanRequired: 0,
      humanTaken: 0,
      paused: 0,
      resolvedToday: 0,
    });
    jest.spyOn(internal, 'lastEvents').mockResolvedValue([]);
    return {
      service,
      authorize: () => {
        qrAllowed = true;
      },
      revoke: () => {
        qrAllowed = false;
      },
      connect: () => {
        qrConnected = true;
      },
    };
  }

  it('reports receive-only activation unavailable before authorization', async () => {
    const { service } = subject();

    const status = await service.getEnterpriseStatus();

    expect(status.security.canActivateQrReal).toBe(false);
    expect(status.whatsapp.realSendingEnabled).toBe(false);
  });

  it('reports authorized receive-only truth before and after connection', async () => {
    const { service, authorize, connect } = subject();
    authorize();

    await expect(service.getEnterpriseStatus()).resolves.toMatchObject({
      security: { canActivateQrReal: true },
      whatsapp: { qrConnected: false, realSendingEnabled: false },
    });

    connect();
    await expect(service.getEnterpriseStatus()).resolves.toMatchObject({
      security: { canActivateQrReal: true },
      whatsapp: { qrConnected: true, realSendingEnabled: false },
    });
  });

  it('removes receive-only activation truth immediately after governance revocation', async () => {
    const { service, authorize, connect, revoke } = subject();
    authorize();
    connect();
    await expect(service.getEnterpriseStatus()).resolves.toMatchObject({
      security: { canActivateQrReal: true },
    });

    revoke();

    await expect(service.getEnterpriseStatus()).resolves.toMatchObject({
      security: { canActivateQrReal: false },
      whatsapp: { realSendingEnabled: false },
    });
  });
});
