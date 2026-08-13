import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { PrismaService } from '../../prisma/prisma.service';
import { GlobalSearchService } from './global-search.service';

describe('GlobalSearchService', () => {
  const customerFindMany = jest.fn();
  const orderFindMany = jest.fn();
  const paymentFindMany = jest.fn();
  const conversationFindMany = jest.fn();
  const caseFindMany = jest.fn();
  const prisma = {
    customer: { findMany: customerFindMany },
    orderTicket: { findMany: orderFindMany },
    paymentIntent: { findMany: paymentFindMany },
    whatsappConversation: { findMany: conversationFindMany },
    customerServiceCase: { findMany: caseFindMany },
  } as unknown as PrismaService;
  const service = new GlobalSearchService(prisma);

  const actor = (permissions: string[], roles: string[] = ['cashier']): AuthUser => ({
    sub: 'actor-1',
    email: 'operator@example.test',
    fullName: 'Operator',
    sessionVersion: 1,
    roles,
    permissions,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    customerFindMany.mockResolvedValue([]);
    orderFindMany.mockResolvedValue([]);
    paymentFindMany.mockResolvedValue([]);
    conversationFindMany.mockResolvedValue([]);
    caseFindMany.mockResolvedValue([]);
  });

  it('returns no domain results when the actor lacks every search permission', async () => {
    const result = await service.search({ q: 'cliente', limit: 5 }, actor([]));

    expect(result.items).toEqual([]);
    expect(customerFindMany).not.toHaveBeenCalled();
    expect(orderFindMany).not.toHaveBeenCalled();
    expect(paymentFindMany).not.toHaveBeenCalled();
    expect(conversationFindMany).not.toHaveBeenCalled();
    expect(caseFindMany).not.toHaveBeenCalled();
  });

  it('returns only masked customer identity and sanitized result fields', async () => {
    customerFindMany.mockResolvedValue([
      {
        id: 'customer-1',
        displayName: 'Cliente Uno',
        status: 'ACTIVE',
        identities: [{ valueMasked: '*** *** 3047', isPrimary: true }],
      },
    ]);

    const result = await service.search({ q: 'Cliente Uno', limit: 5 }, actor(['orders.read']));

    expect(result.items).toContainEqual({
      kind: 'CUSTOMER',
      id: 'customer-1',
      label: 'Cliente Uno',
      context: '*** *** 3047',
      status: 'ACTIVE',
      href: '/customers/customer-1',
    });
    expect(result.dataPolicy).toEqual({
      piiMasked: true,
      financialHashesExcluded: true,
      rawPayloadExcluded: true,
    });
    expect(JSON.stringify(result)).not.toContain('valueHash');
  });

  it('does not expose provider references or financial hashes in payment results', async () => {
    paymentFindMany.mockResolvedValue([
      {
        id: 'payment-intent-long-reference',
        status: 'UNKNOWN_RESULT',
        provider: 'BOLD',
        amount: new Prisma.Decimal(30_000),
        currency: 'COP',
      },
    ]);

    const result = await service.search({ q: 'payment', limit: 5 }, actor(['reports.read']));

    expect(result.items).toEqual([
      expect.objectContaining({
        kind: 'PAYMENT',
        status: 'UNKNOWN_RESULT',
        href: '/payments?intent=payment-intent-long-reference',
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty('providerReference');
    expect(result.items[0]).not.toHaveProperty('providerAccountHash');
    expect(result.items[0]).not.toHaveProperty('payloadHash');
  });

  it('allows an elevated role to search all authorized domains', async () => {
    await service.search({ q: 'abc', limit: 3 }, actor([], ['supervisor']));

    expect(customerFindMany).toHaveBeenCalledTimes(1);
    expect(orderFindMany).toHaveBeenCalledTimes(1);
    expect(paymentFindMany).toHaveBeenCalledTimes(1);
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
    expect(caseFindMany).toHaveBeenCalledTimes(1);
  });
});
