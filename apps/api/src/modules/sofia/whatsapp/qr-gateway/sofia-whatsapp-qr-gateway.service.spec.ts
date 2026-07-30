import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { AuditService } from '../../../audit/audit.service';
import type { SofiaWhatsappService } from '../../sofia-whatsapp.service';
import type { SofiaWhatsappQrGatewayProvider } from './sofia-whatsapp-qr-gateway.provider';
import { SofiaWhatsappQrGatewayService } from './sofia-whatsapp-qr-gateway.service';

describe('SofiaWhatsappQrGatewayService governance gate', () => {
  const settingFindMany = jest.fn();
  const auditLog = jest.fn();
  const configGet = jest.fn();
  const service = new SofiaWhatsappQrGatewayService(
    { setting: { findMany: settingFindMany } } as unknown as PrismaService,
    { log: auditLog } as unknown as AuditService,
    { get: configGet } as unknown as ConfigService,
    {} as SofiaWhatsappService,
    {} as SofiaWhatsappQrGatewayProvider,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configGet.mockImplementation((key: string) => key === 'WHATSAPP_QR_ENABLED');
    settingFindMany.mockResolvedValue([]);
    auditLog.mockResolvedValue({ id: 'audit-qr-blocked' });
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('does not bootstrap Baileys when governance has not approved real QR', async () => {
    await expect(service.connect('operator-id')).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'QR_GOVERNANCE_NOT_APPROVED' }),
    });

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SOFIA_QR_CONNECT_BLOCKED',
        newValues: expect.objectContaining({ reason: 'QR_GOVERNANCE_NOT_APPROVED' }),
      }),
    );
  });

  it.each([
    ['SOFIA_KILL_SWITCH', { active: true }, 'KILL_SWITCH_ACTIVE'],
    ['SOFIA_GLOBAL_PAUSED', { paused: true }, 'GLOBAL_PAUSED'],
  ])('blocks QR when %s is active', async (key, value, reason) => {
    settingFindMany.mockResolvedValue([
      { key: 'SOFIA_QR_REAL_ALLOWED', value: { allowed: true } },
      { key, value },
    ]);

    await expect(service.connect('operator-id')).rejects.toMatchObject({
      response: expect.objectContaining({ reason }),
    });
  });
});
