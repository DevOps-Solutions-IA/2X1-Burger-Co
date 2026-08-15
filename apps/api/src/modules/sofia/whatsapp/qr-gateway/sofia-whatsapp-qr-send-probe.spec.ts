import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { AuditService } from '../../../audit/audit.service';
import type { SofiaWhatsappService } from '../../sofia-whatsapp.service';
import type { SofiaWhatsappQrGatewayProvider } from './sofia-whatsapp-qr-gateway.provider';
import { SofiaWhatsappQrGatewayService } from './sofia-whatsapp-qr-gateway.service';
import type { AuthUser } from '../../../../common/types/auth-user.type';

describe('SofiaWhatsappQrGatewayService send safety probe', () => {
  it('proves the block without invoking any provider transport', async () => {
    const provider = { sendTextMessage: jest.fn() };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new SofiaWhatsappQrGatewayService(
      {} as PrismaService,
      audit as unknown as AuditService,
      { get: jest.fn((key: string) => key === 'NODE_ENV' ? 'test' : undefined) } as unknown as ConfigService,
      {} as SofiaWhatsappService,
      provider as unknown as SofiaWhatsappQrGatewayProvider,
    );

    const actor: AuthUser = {
      sub: 'test-operator', email: 'operator@example.test', fullName: 'Operator', sessionVersion: 1,
      roles: ['supervisor'], permissions: ['settings.update'],
    };
    await expect(service.testSend({ to: '573000000000', body: 'blocked' }, actor)).resolves.toMatchObject({
      provider: 'qr_gateway',
      status: 'BLOCKED_REAL_SEND_DISABLED',
      sent: false,
      realSendingEnabled: false,
    });
    expect(provider.sendTextMessage).not.toHaveBeenCalled();
  });
});
