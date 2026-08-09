import { PaymentIntentProvider, PaymentIntentStatus } from '@prisma/client';
import { PrismaOrderCheckoutRepository } from './prisma-order-checkout.repository';

describe('PrismaOrderCheckoutRepository provider binding protocol', () => {
  const intent = {
    id: 'intent-1',
    provider: PaymentIntentProvider.BOLD,
    status: PaymentIntentStatus.LINK_READY,
    version: 2,
    providerReference: null,
    providerPaymentId: null,
    providerAccountHash: null,
  };

  function transactionHarness(overrides: Record<string, unknown> = {}) {
    const current = { ...intent, ...overrides };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: current.id }]),
      paymentIntent: {
        findUnique: jest.fn().mockResolvedValue(current),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...current,
          ...data,
          version: current.version + 1,
        })),
      },
      paymentTransition: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
      paymentIntent: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    return { repository: new PrismaOrderCheckoutRepository(prisma as never), prisma, tx };
  }

  it('atomically binds the deterministic reference and PENDING claim before provider I/O', async () => {
    const { repository, tx } = transactionHarness();

    await expect(repository.beginProviderPayment({
      paymentIntentId: 'intent-1',
      expectedVersion: 2,
      providerReference: 'checkout_intent-1',
      providerAccountHash: 'account-hash',
      idempotencyKey: 'intent-1:provider-requested',
    })).resolves.toMatchObject({ started: true });

    expect(tx.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-1' },
      data: expect.objectContaining({
        status: PaymentIntentStatus.PENDING,
        providerReference: 'checkout_intent-1',
        providerAccountHash: 'account-hash',
        transitions: {
          create: expect.objectContaining({
            reasonCode: 'PROVIDER_PAYMENT_REQUESTED',
            idempotencyKey: 'intent-1:provider-requested',
          }),
        },
      }),
    });
  });

  it('does not grant a second external-call claim after the request transition exists', async () => {
    const { repository, tx } = transactionHarness({
      status: PaymentIntentStatus.PENDING,
      version: 3,
      providerReference: 'checkout_intent-1',
      providerAccountHash: 'account-hash',
    });
    tx.paymentTransition.findUnique.mockResolvedValue({ id: 'transition-1' });

    await expect(repository.beginProviderPayment({
      paymentIntentId: 'intent-1',
      expectedVersion: 2,
      providerReference: 'checkout_intent-1',
      providerAccountHash: 'account-hash',
      idempotencyKey: 'intent-1:provider-requested',
    })).resolves.toMatchObject({ started: false });
    expect(tx.paymentIntent.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal webhook result when timeout handling loses the race', async () => {
    const { repository, tx } = transactionHarness({
      status: PaymentIntentStatus.SUCCEEDED,
      version: 4,
      providerReference: 'checkout_intent-1',
      providerPaymentId: 'bold-payment-1',
    });

    await expect(repository.markProviderPaymentUnknown({
      paymentIntentId: 'intent-1',
      providerReference: 'checkout_intent-1',
      idempotencyKey: 'intent-1:unknown-result',
    })).resolves.toMatchObject({
      marked: false,
      paymentIntent: { status: PaymentIntentStatus.SUCCEEDED },
    });
    expect(tx.paymentIntent.update).not.toHaveBeenCalled();
  });

  it('accepts result enrichment that an early webhook already persisted', async () => {
    const { repository, tx } = transactionHarness({
      status: PaymentIntentStatus.SUCCEEDED,
      version: 4,
      providerReference: 'checkout_intent-1',
      providerPaymentId: 'bold-payment-1',
    });

    await expect(repository.bindProviderPaymentResult({
      paymentIntentId: 'intent-1',
      providerReference: 'checkout_intent-1',
      providerPaymentId: 'bold-payment-1',
    })).resolves.toMatchObject({ status: PaymentIntentStatus.SUCCEEDED });
    expect(tx.paymentIntent.update).not.toHaveBeenCalled();
  });

  it('falls back to the pre-bound reference when the early webhook payment id is not stored yet', async () => {
    const { repository, prisma } = transactionHarness();
    const matched = {
      ...intent,
      status: PaymentIntentStatus.PENDING,
      providerReference: 'checkout_intent-1',
      checkout: { id: 'checkout-1' },
    };
    prisma.paymentIntent.findUnique.mockResolvedValue(null);
    prisma.paymentIntent.findMany.mockResolvedValue([matched]);

    await expect(repository.findIntentByProvider({
      provider: PaymentIntentProvider.BOLD,
      providerPaymentId: 'bold-payment-1',
      providerReference: 'checkout_intent-1',
    })).resolves.toEqual(matched);
    expect(prisma.paymentIntent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        provider: PaymentIntentProvider.BOLD,
        providerReference: 'checkout_intent-1',
      },
    }));
  });

  it('fails closed instead of falling back when payment id and reference identify different intents', async () => {
    const { repository, prisma } = transactionHarness();
    prisma.paymentIntent.findUnique.mockResolvedValue({
      ...intent,
      providerPaymentId: 'bold-payment-1',
      providerReference: 'checkout_other-intent',
      checkout: { id: 'checkout-2' },
    });

    await expect(repository.findIntentByProvider({
      provider: PaymentIntentProvider.BOLD,
      providerPaymentId: 'bold-payment-1',
      providerReference: 'checkout_intent-1',
    })).resolves.toBeNull();
    expect(prisma.paymentIntent.findMany).not.toHaveBeenCalled();
  });
});
