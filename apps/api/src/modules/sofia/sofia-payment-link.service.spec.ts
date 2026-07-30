import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { PaymentProviderFactory } from './payments/payment-provider.factory';
import type { SofiaPrivacyService } from './privacy/sofia-privacy.service';
import type { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';

describe('SofiaPaymentLinkService production gate', () => {
  const prisma = { whatsappDeliveryOrder: { findUnique: jest.fn() } } as unknown as PrismaService;
  const evaluate = jest.fn();
  const recordBlocked = jest.fn();
  const service = new SofiaPaymentLinkService(
    prisma,
    {} as AuditService,
    {} as RealtimeService,
    {} as PaymentProviderFactory,
    { evaluate, recordBlocked } as unknown as SofiaRuntimeSafetyService,
    {} as SofiaPrivacyService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    evaluate.mockResolvedValue({
      allowed: false,
      reason: 'PRODUCTION_DISABLED',
      blockers: ['PRODUCTION_DISABLED'],
    });
    recordBlocked.mockResolvedValue({ id: 'audit-payment-blocked' });
  });

  it.each(['CASH', 'NEQUI_MANUAL', 'ONLINE'] as const)(
    'blocks %s before reading or mutating an order',
    async (method) => {
      await expect(service.selectPublicPaymentMethod('opaque-public-token', method)).rejects.toThrow(
        'La selección de pago está bloqueada',
      );

      expect(evaluate).toHaveBeenCalledWith('PRODUCTIVE_ACTION');
      expect(recordBlocked).toHaveBeenCalledWith(
        'PRODUCTIVE_ACTION',
        expect.objectContaining({ reason: 'PRODUCTION_DISABLED' }),
      );
      expect(prisma.whatsappDeliveryOrder.findUnique).not.toHaveBeenCalled();
    },
  );
});
