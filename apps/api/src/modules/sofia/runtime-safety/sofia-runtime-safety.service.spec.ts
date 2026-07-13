import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../prisma/prisma.service';
import { SofiaRuntimeSafetyService } from './sofia-runtime-safety.service';
import type { SofiaRuntimeSafetyState } from './sofia-runtime-safety.types';

describe('SofiaRuntimeSafetyService', () => {
  const originalEnv = { ...process.env };
  const settingFindMany = jest.fn();
  const auditCreate = jest.fn();
  const prisma = {
    setting: { findMany: settingFindMany },
    auditLog: { create: auditCreate },
  } as unknown as PrismaService;
  const config = { get: jest.fn() } as unknown as ConfigService;
  const service = new SofiaRuntimeSafetyService(prisma, config);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    settingFindMany.mockResolvedValue([]);
    auditCreate.mockResolvedValue({ id: 'audit-safe' });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('keeps all critical effective controls fail-closed even if declared values are true', async () => {
    process.env.WHATSAPP_QR_ALLOW_REAL_SEND = 'true';
    process.env.SOFIA_AUTO_REPLY_ENABLED = '1';
    process.env.SOFIA_AUTO_SAFE_ENABLED = 'TRUE';
    process.env.SOFIA_PRODUCTION_ENABLED = 'true';

    const state = await service.getState();

    expect(state.declared).toEqual({
      realSendingEnabled: true,
      autoReplyEnabled: true,
      autoSafeEnabled: true,
      productionEnabled: true,
    });
    expect(state.effective).toEqual({
      realSendingEnabled: false,
      autoReplyEnabled: false,
      autoSafeEnabled: false,
      productionEnabled: false,
      whatsappCanMarkPaid: false,
    });
  });

  it('enforces kill switch before pause and blocks all real outbound operations', async () => {
    const state: SofiaRuntimeSafetyState = {
      policy: 'SUPERVISED_PREPRODUCTION',
      declared: {
        realSendingEnabled: false,
        autoReplyEnabled: false,
        autoSafeEnabled: false,
        productionEnabled: false,
      },
      effective: {
        realSendingEnabled: false,
        autoReplyEnabled: false,
        autoSafeEnabled: false,
        productionEnabled: false,
        whatsappCanMarkPaid: false,
      },
      globalPaused: true,
      killSwitchActive: true,
      automationBlocked: true,
      precedence: ['KILL_SWITCH', 'PAUSE', 'PRODUCTION', 'AUTO_SAFE', 'AUTO_REPLY', 'REAL_SEND'],
    };

    const decision = await service.evaluate('OUTBOUND_SEND', { state });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('KILL_SWITCH_ACTIVE');
    expect(decision.blockers).toEqual([
      'KILL_SWITCH_ACTIVE',
      'GLOBAL_PAUSED',
      'PRODUCTION_DISABLED',
      'REAL_SEND_DISABLED',
    ]);
  });

  it('allows an in-memory sandbox adapter only while pause and kill switch are inactive', async () => {
    const active = await service.getState();
    expect((await service.evaluate('OUTBOUND_SEND', { simulated: true, state: active })).allowed).toBe(true);

    const paused = { ...active, globalPaused: true, automationBlocked: true };
    expect((await service.evaluate('OUTBOUND_SEND', { simulated: true, state: paused })).reason).toBe('GLOBAL_PAUSED');
  });

  it.each([
    ['300 000 0000', true],
    ['+57 300-000-0000', true],
    ['00573000000000', true],
    ['300000000', false],
    ['***0000', false],
    ['573000000001', false],
    ['', false],
  ])('normalizes exact synthetic allowlist identity %s without partial matches', (phone, allowed) => {
    const decision = service.evaluateAllowlist(phone, {
      enabled: true,
      allowedPhones: '573000000000',
    });

    expect(decision.allowed).toBe(allowed);
    expect(decision.phoneMasked ?? '').not.toContain('573000000000');
  });

  it('writes a blocked audit event without raw phone or idempotency key', async () => {
    await service.recordBlocked('MARK_PAID', {
      phone: '573000000000',
      idempotencyKey: 'sensitive-event-key',
      reason: 'WHATSAPP_PAID_FORBIDDEN',
    });

    const payload = JSON.stringify(auditCreate.mock.calls[0]);
    expect(payload).not.toContain('573000000000');
    expect(payload).not.toContain('sensitive-event-key');
    expect(payload).toContain('***0000');
    expect(payload).toContain('valuesSanitized');
  });
});
