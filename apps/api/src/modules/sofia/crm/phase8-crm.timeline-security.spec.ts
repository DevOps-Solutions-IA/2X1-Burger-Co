import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import { Phase8CrmRepository } from './phase8-crm.repository';

describe('Phase8 CRM unified timeline projection', () => {
  const customerServiceCaseFindMany = jest.fn();
  const orderCheckoutFindMany = jest.fn();
  const emptyFindMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer-1' }) },
    customerInteraction: { findMany: emptyFindMany },
    whatsappConversation: { findMany: emptyFindMany },
    orderCheckout: { findMany: orderCheckoutFindMany },
    customerServiceCase: { findMany: customerServiceCaseFindMany },
    crmLead: { findMany: emptyFindMany },
    crmTask: { findMany: emptyFindMany },
    crmNote: { findMany: emptyFindMany },
    deliveryWorkflowEvent: { findMany: emptyFindMany },
  } as unknown as PrismaService;
  const repository = new Phase8CrmRepository(
    prisma,
    { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    { log: jest.fn() } as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    orderCheckoutFindMany.mockImplementation(({ select }) => Promise.resolve([{
      id: 'checkout-1',
      status: 'CREATED',
      fulfillment: 'TAKEAWAY',
      orderTicketId: 'ticket-1',
      createdAt: new Date('2026-08-13T12:00:00.000Z'),
      updatedAt: new Date('2026-08-13T12:00:00.000Z'),
      ...(select.paymentPreference ? {
        paymentPreference: 'ONLINE', total: 30000, currency: 'COP',
        paymentIntents: [{
          id: 'payment-1', status: 'SUCCEEDED', provider: 'BOLD', amount: 30000, currency: 'COP',
          updatedAt: new Date('2026-08-13T12:01:00.000Z'),
        }],
      } : {}),
    }]));
    customerServiceCaseFindMany.mockResolvedValue([{
      id: 'case-1', category: 'PAYMENT_PROBLEM', status: 'OPEN', sanitizedSummary: 'Restricted',
      createdAt: new Date('2026-08-13T12:02:00.000Z'), updatedAt: new Date('2026-08-13T12:02:00.000Z'),
    }]);
  });

  it('does not query or return payment and service-case facts for a cashier projection', async () => {
    const result = await repository.unifiedTimeline('customer-1', { page: 1, limit: 20 }, {
      paymentFacts: false,
      serviceCaseFacts: false,
    });

    expect(orderCheckoutFindMany.mock.calls[0][0].select).not.toHaveProperty('paymentPreference');
    expect(orderCheckoutFindMany.mock.calls[0][0].select).not.toHaveProperty('paymentIntents');
    expect(customerServiceCaseFindMany).not.toHaveBeenCalled();
    expect(result.data.map((event) => event.type)).toEqual(['ORDER_CHECKOUT']);
    expect(result.data[0]?.facts).toEqual({
      status: 'CREATED', fulfillment: 'TAKEAWAY', orderTicketId: 'ticket-1',
    });
    expect(JSON.stringify(result)).not.toMatch(/ONLINE|SUCCEEDED|BOLD|30000|PAYMENT_PROBLEM|Restricted/);
  });

  it('includes restricted facts only for an explicitly privileged projection', async () => {
    const result = await repository.unifiedTimeline('customer-1', { page: 1, limit: 20 }, {
      paymentFacts: true,
      serviceCaseFacts: true,
    });

    expect(orderCheckoutFindMany.mock.calls[0][0].select).toHaveProperty('paymentPreference', true);
    expect(customerServiceCaseFindMany).toHaveBeenCalledTimes(1);
    expect(result.data.map((event) => event.type)).toEqual([
      'SERVICE_CASE', 'PAYMENT_INTENT', 'ORDER_CHECKOUT',
    ]);
  });
});
