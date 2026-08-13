import { OrderCheckoutStatus, PaymentIntentStatus, Prisma } from '@prisma/client';
import { AdminPaymentReadService } from './admin-payment-read.service';

describe('AdminPaymentReadService', () => {
  it('returns exact financial state without exposing hashes, tokens or raw provider payloads', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'intent-1',
      checkoutId: 'checkout-1',
      attemptNumber: 1,
      provider: 'BOLD',
      amount: new Prisma.Decimal(30_000),
      currency: 'COP',
      status: 'UNKNOWN_RESULT',
      providerPaymentId: 'provider-payment-1',
      providerReference: 'provider-reference-1',
      providerAccountHash: 'a'.repeat(64),
      failureCode: null,
      expiresAt: null,
      completedAt: null,
      version: 2,
      createdAt: new Date('2026-08-12T12:00:00Z'),
      updatedAt: new Date('2026-08-12T12:05:00Z'),
      checkout: { total: new Prisma.Decimal(30_000), currency: 'COP' },
      links: [{ id: 'link-1', status: 'ACTIVE' }],
      transitions: [],
      webhookEvents: [{
        id: 'webhook-1',
        paymentIntentId: 'intent-1',
        payloadHash: 'b'.repeat(64),
        providerAccountHash: 'a'.repeat(64),
        processedStatus: 'CLAIMED',
        paymentTransition: null,
      }],
      salePayment: null,
    });
    const prisma = { paymentIntent: { findUnique } };
    const service = new AdminPaymentReadService(prisma as never);

    const result = await service.getIntent('intent-1');
    const serialized = JSON.stringify(result);

    expect(result).toEqual(expect.objectContaining({ status: 'UNKNOWN_RESULT', amount: 30_000, providerAccountBound: true }));
    expect(serialized).not.toContain('providerAccountHash');
    expect(serialized).not.toContain('payloadHash');
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain('rawPayload');
    expect(findUnique.mock.calls[0]?.[0].select.links.select).not.toHaveProperty('tokenHash');
  });

  it('keeps a successful payment distinct from an unknown result in list output', async () => {
    const prisma = {
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      paymentIntent: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { id: 'intent-success', status: 'SUCCEEDED', amount: new Prisma.Decimal(25_000), providerAccountHash: null },
          { id: 'intent-unknown', status: 'UNKNOWN_RESULT', amount: new Prisma.Decimal(25_000), providerAccountHash: null },
        ]),
      },
    };
    const service = new AdminPaymentReadService(prisma as never);

    const result = await service.listIntents({ page: 1, limit: 25 });

    expect(result.items.map((item) => item.status)).toEqual(['SUCCEEDED', 'UNKNOWN_RESULT']);
  });

  it('filters intent lists by effective checkout financial truth', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      paymentIntent: { count: jest.fn().mockResolvedValue(0), findMany },
    };
    const service = new AdminPaymentReadService(prisma as never);

    await service.listIntents({ page: 1, limit: 25, status: PaymentIntentStatus.SUCCEEDED });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      status: PaymentIntentStatus.SUCCEEDED,
      checkout: { is: { status: { not: OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED } } },
    });

    await service.listIntents({ page: 1, limit: 25, status: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED });
    expect(findMany.mock.calls[1]?.[0].where).toMatchObject({
      OR: [
        { status: PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED },
        { checkout: { is: { status: OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED } } },
      ],
    });
  });

  it('includes checkout status in payment-link list and detail reads', async () => {
    const link = {
      id: 'link-1',
      paymentIntentId: 'intent-1',
      status: 'ACTIVE',
      expiresAt: new Date('2026-08-13T13:00:00Z'),
      openedAt: null,
      revokedAt: null,
      createdAt: new Date('2026-08-13T12:00:00Z'),
      updatedAt: new Date('2026-08-13T12:00:00Z'),
      paymentIntent: {
        id: 'intent-1',
        checkoutId: 'checkout-1',
        status: PaymentIntentStatus.SUCCEEDED,
        provider: 'BOLD',
        amount: new Prisma.Decimal(30_000),
        currency: 'COP',
        expiresAt: null,
        checkout: { status: OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED },
      },
    };
    const findMany = jest.fn().mockResolvedValue([link]);
    const findUnique = jest.fn().mockResolvedValue(link);
    const prisma = {
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      paymentLink: { count: jest.fn().mockResolvedValue(1), findMany, findUnique },
    };
    const service = new AdminPaymentReadService(prisma as never);

    const list = await service.listLinks({ page: 1, limit: 25 });
    const detail = await service.getLink('link-1');

    expect(list.items[0]?.paymentIntent.checkout.status).toBe(OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED);
    expect(detail.paymentIntent.checkout.status).toBe(OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED);
    expect(findMany.mock.calls[0]?.[0].select.paymentIntent.select.checkout.select).toEqual({ status: true });
    expect(findUnique.mock.calls[0]?.[0].select.paymentIntent.select.checkout.select).toEqual({ status: true });
  });
});
