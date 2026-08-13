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
    WHATSAPP_EXPECTED_ACCOUNT_ID: 'account-expected',
    WHATSAPP_EXPECTED_BUSINESS_IDENTITY: 'business-expected',
    WHATSAPP_EXPECTED_SESSION_OWNER: 'session-expected',
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
