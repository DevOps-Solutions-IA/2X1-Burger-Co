import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { AuditService } from '../../../audit/audit.service';
import type { SofiaWhatsappService } from '../../sofia-whatsapp.service';
import type { SofiaWhatsappQrGatewayProvider } from './sofia-whatsapp-qr-gateway.provider';
import { SofiaWhatsappQrGatewayService } from './sofia-whatsapp-qr-gateway.service';

type ReconnectSubject = {
  activeLease: object | null;
  reconnectAttempts: number;
  real: { connectionStatus: string; lastErrorCode: string | null };
  performReconnect(): Promise<void>;
  releaseSessionOwnership(): Promise<void>;
  scheduleReconnect(): Promise<void>;
  cancelReconnect(): void;
};

describe('SofiaWhatsappQrGatewayService bounded reconnect', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function subject(maxAttempts = 2) {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'WHATSAPP_QR_RECONNECT_ENABLED') return true;
        if (key === 'WHATSAPP_QR_MAX_RECONNECT_ATTEMPTS') return maxAttempts;
        return false;
      }),
    } as unknown as ConfigService;
    return new SofiaWhatsappQrGatewayService(
      {} as PrismaService,
      {} as AuditService,
      config,
      {} as SofiaWhatsappService,
      {} as SofiaWhatsappQrGatewayProvider,
    ) as unknown as ReconnectSubject;
  }

  it('uses bounded exponential delays from the configured retry limit', async () => {
    const service = subject();
    service.activeLease = {};
    const reconnect = jest.spyOn(service, 'performReconnect').mockResolvedValue(undefined);

    await service.scheduleReconnect();
    await jest.advanceTimersByTimeAsync(999);
    expect(reconnect).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(reconnect).toHaveBeenCalledTimes(1);

    await service.scheduleReconnect();
    await jest.advanceTimersByTimeAsync(1_999);
    expect(reconnect).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(reconnect).toHaveBeenCalledTimes(2);
    service.cancelReconnect();
  });

  it('fails closed and releases ownership when attempts are exhausted', async () => {
    const service = subject(2);
    service.activeLease = {};
    service.reconnectAttempts = 2;
    const release = jest.spyOn(service, 'releaseSessionOwnership').mockResolvedValue(undefined);

    await service.scheduleReconnect();

    expect(service.real).toMatchObject({
      connectionStatus: 'FAILED',
      lastErrorCode: 'RECONNECT_ATTEMPTS_EXHAUSTED',
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
