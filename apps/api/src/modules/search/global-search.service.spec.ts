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

  it.each([
    ['inventory', ['orders.read', 'reports.read']],
    ['waiter', ['orders.read']],
    ['delivery', ['orders.read']],
    ['unknown', ['orders.read', 'reports.read']],
  ])('does not let the %s role escalate search access through permissions', async (role, permissions) => {
    const result = await service.search({ q: 'cliente', limit: 5 }, actor(permissions, [role]));

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

    const result = await service.search({ q: 'Cliente Uno', limit: 5 }, actor([], ['cashier']));

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

  it.each(['admin', 'supervisor'])('allows %s to search payments without exposing sensitive evidence', async (role) => {
    paymentFindMany.mockResolvedValue([
      {
        id: 'payment-intent-long-reference',
        status: 'UNKNOWN_RESULT',
        provider: 'BOLD',
        amount: new Prisma.Decimal(30_000),
        currency: 'COP',
      },
    ]);

    const result = await service.search({ q: 'payment', limit: 5 }, actor([], [role]));

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

  it.each(['admin', 'supervisor'])('allows %s to search every canonical domain', async (role) => {
    await service.search({ q: 'abc', limit: 3 }, actor([], [role]));

    expect(customerFindMany).toHaveBeenCalledTimes(1);
    expect(orderFindMany).toHaveBeenCalledTimes(1);
    expect(paymentFindMany).toHaveBeenCalledTimes(1);
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
    expect(caseFindMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    { permissions: [] },
    { permissions: ['orders.read'] },
    { permissions: ['reports.read'] },
    { permissions: ['orders.read', 'reports.read'] },
  ])('never exposes restricted domains to a cashier with permissions $permissions', async ({ permissions }) => {
    paymentFindMany.mockResolvedValue([
      {
        id: 'payment-secret',
        status: 'SUCCEEDED',
        provider: 'BOLD',
        amount: new Prisma.Decimal(25_000),
        currency: 'COP',
      },
    ]);
    caseFindMany.mockResolvedValue([
      {
        id: 'case-secret',
        category: 'PAYMENT_PROBLEM',
        status: 'HUMAN_REQUIRED',
        sanitizedSummary: 'Resumen restringido',
      },
    ]);

    const result = await service.search({ q: 'restricted', limit: 5 }, actor(permissions, ['cashier']));

    expect(result.items).toEqual([]);
    expect(paymentFindMany).not.toHaveBeenCalled();
    expect(caseFindMany).not.toHaveBeenCalled();
    expect(customerFindMany).toHaveBeenCalledTimes(1);
    expect(orderFindMany).toHaveBeenCalledTimes(1);
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('payment-secret');
    expect(JSON.stringify(result)).not.toContain('case-secret');
    expect(JSON.stringify(result)).not.toContain('Resumen restringido');
  });

  it('preserves operational customer, order, and conversation search for cashiers', async () => {
    customerFindMany.mockResolvedValue([
      {
        id: 'customer-1',
        displayName: 'Cliente Uno',
        status: 'ACTIVE',
        identities: [{ valueMasked: '*** 3047', isPrimary: true }],
      },
    ]);
    orderFindMany.mockResolvedValue([
      {
        id: 'order-1',
        number: 'ORD-1',
        customerName: 'Cliente Uno',
        status: 'OPEN',
        type: 'TAKEAWAY',
      },
    ]);
    conversationFindMany.mockResolvedValue([
      {
        id: 'conversation-1',
        customerName: 'Cliente Uno',
        status: 'SOFIA_ACTIVE',
        customer: { identities: [{ valueMasked: '*** 3047', isPrimary: true }] },
      },
    ]);

    const result = await service.search({ q: 'Cliente Uno', limit: 5 }, actor([], ['cashier']));

    expect(result.items.map((item) => item.kind)).toEqual(['CUSTOMER', 'ORDER', 'CONVERSATION']);
    expect(paymentFindMany).not.toHaveBeenCalled();
    expect(caseFindMany).not.toHaveBeenCalled();
  });

  it('keeps restricted access when an elevated actor also has a lower-privilege role', async () => {
    await service.search({ q: 'abc', limit: 3 }, actor([], ['cashier', 'supervisor']));

    expect(customerFindMany).toHaveBeenCalledTimes(1);
    expect(orderFindMany).toHaveBeenCalledTimes(1);
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
    expect(paymentFindMany).toHaveBeenCalledTimes(1);
    expect(caseFindMany).toHaveBeenCalledTimes(1);
  });
});
