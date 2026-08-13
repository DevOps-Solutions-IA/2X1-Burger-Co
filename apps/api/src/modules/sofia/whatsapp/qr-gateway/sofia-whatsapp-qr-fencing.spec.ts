import type { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { AuditService } from '../../../audit/audit.service';
import type { SofiaWhatsappService } from '../../sofia-whatsapp.service';
import type { SofiaWhatsappQrGatewayProvider } from './sofia-whatsapp-qr-gateway.provider';
import { SofiaWhatsappQrGatewayService } from './sofia-whatsapp-qr-gateway.service';

type FencingSubject = {
  activeLease: {
    sessionName: string;
    ownerHash: string;
    fencingToken: number;
    leaseExpiresAt: string;
  } | null;
  intentionalShutdown: boolean;
  ownership: {
    runFenced: jest.Mock;
  };
  real: { socket: object | null };
  clearAuthDir(): Promise<void>;
  getSessionState(): Promise<object>;
  getStatus(): Promise<object>;
  releaseSessionOwnership(): Promise<void>;
  runFencedOwnerEffect(
    socket: object,
    fencingToken: number,
    operation: () => Promise<unknown>,
  ): Promise<unknown>;
  saveSessionState(): Promise<void>;
  teardownRealSocket(resetPhone: boolean): Promise<void>;
};

describe('SofiaWhatsappQrGatewayService fencing boundaries', () => {
  const operator: AuthUser = {
    sub: 'operator',
    email: 'operator@example.test',
    fullName: 'Operator',
    sessionVersion: 1,
    roles: ['supervisor'],
    permissions: ['settings.update'],
  };

  function subject(): FencingSubject {
    return new SofiaWhatsappQrGatewayService(
      {} as PrismaService,
      {} as AuditService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {} as SofiaWhatsappService,
      {} as SofiaWhatsappQrGatewayProvider,
    ) as unknown as FencingSubject;
  }

  it('rechecks shutdown state inside queued owner callbacks', async () => {
    const service = subject();
    const socket = {};
    const operation = jest.fn();
    service.real.socket = socket;
    service.activeLease = {
      sessionName: 'sofia-main',
      ownerHash: 'owner',
      fencingToken: 7,
      leaseExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    service.intentionalShutdown = true;
    const runFenced = jest.spyOn(service.ownership, 'runFenced');

    await service.runFencedOwnerEffect(socket, 7, operation);

    expect(operation).not.toHaveBeenCalled();
    expect(runFenced).not.toHaveBeenCalled();
  });

  it('clears session credentials inside the fence before releasing ownership', async () => {
    const service = subject();
    const ordering: string[] = [];
    const lease = {
      sessionName: 'sofia-main',
      ownerHash: 'owner',
      fencingToken: 9,
      leaseExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    const socket = {
      logout: jest.fn(async () => {
        ordering.push('logout');
      }),
    };
    service.activeLease = lease;
    service.real.socket = socket;
    service.ownership.runFenced = jest.fn(async (_lease, operation) => {
      ordering.push('fence-start');
      const result = await operation();
      ordering.push('fence-end');
      return { lease, result };
    });
    jest.spyOn(service, 'getSessionState').mockResolvedValue({ sessionName: 'sofia-main' });
    jest.spyOn(service, 'teardownRealSocket').mockImplementation(async () => {
      ordering.push('teardown');
      service.real.socket = null;
    });
    jest.spyOn(service, 'clearAuthDir').mockImplementation(async () => {
      ordering.push('clear-auth');
    });
    jest.spyOn(service, 'releaseSessionOwnership').mockImplementation(async () => {
      ordering.push('release');
    });
    jest.spyOn(service, 'saveSessionState').mockResolvedValue(undefined);
    jest.spyOn(service, 'getStatus').mockResolvedValue({ status: 'LOGGED_OUT' });

    await (service as unknown as SofiaWhatsappQrGatewayService).logout(operator);

    expect(ordering).toEqual([
      'fence-start',
      'logout',
      'teardown',
      'clear-auth',
      'fence-end',
      'release',
    ]);
  });
});
