import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { OrdersService } from '../orders/orders.service';
import type { ReportsService } from '../reports/reports.service';
import type { SalesService } from '../sales/sales.service';
import { WhatsappService } from './whatsapp.service';

describe('WhatsappService outbound safety gate', () => {
  function subject(
    values: Record<string, unknown>,
    settings: Array<{ key: string; value: Record<string, unknown> }> = [],
  ) {
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    const prisma = {
      setting: { findMany: jest.fn().mockResolvedValue(settings) },
    } as unknown as PrismaService;
    const sales = { findOne: jest.fn() } as unknown as SalesService;
    const service = new WhatsappService(
      config,
      prisma,
      sales,
      {} as OrdersService,
      {} as ReportsService,
      {} as AuditService,
    );
    return { service, sales };
  }

  it('blocks legacy receipt sending while the platform is receive-only', async () => {
    const { service, sales } = subject({
      NODE_ENV: 'development',
      WHATSAPP_INTERNAL_ENABLED: true,
      WHATSAPP_MODE: 'receive_only',
      WHATSAPP_QR_ALLOW_REAL_SEND: false,
      SOFIA_PRODUCTION_ENABLED: false,
    });

    await expect(service.sendSaleReceipt('sale-1', '573000000001', 'actor-1')).rejects.toThrow(
      'WHATSAPP_RECEIVE_ONLY',
    );
    expect(sales.findOne).not.toHaveBeenCalled();
  });

  it('gives the kill switch precedence even if outbound flags are declared on', async () => {
    const { service, sales } = subject(
      {
        NODE_ENV: 'development',
        WHATSAPP_INTERNAL_ENABLED: true,
        WHATSAPP_MODE: 'supervised',
        WHATSAPP_QR_ALLOW_REAL_SEND: true,
        SOFIA_PRODUCTION_ENABLED: true,
      },
      [{ key: 'SOFIA_KILL_SWITCH', value: { active: true } }],
    );

    await expect(service.sendSaleReceipt('sale-1', '573000000001', 'actor-1')).rejects.toThrow(
      'KILL_SWITCH_ACTIVE',
    );
    expect(sales.findOne).not.toHaveBeenCalled();
  });
});
