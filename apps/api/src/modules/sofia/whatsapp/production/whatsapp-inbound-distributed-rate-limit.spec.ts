import { PrismaWhatsappProductionRepository } from './persistence/prisma-whatsapp-production.repository';

function harness(accountCount: number, senderCount: number) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    whatsappInboundEvent: {
      count: jest.fn().mockResolvedValueOnce(accountCount).mockResolvedValueOnce(senderCount),
    },
  };
  const prisma = {
    $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  const repository = new PrismaWhatsappProductionRepository(prisma as never, {} as never);
  return { repository, prisma, tx };
}

describe('distributed WhatsApp inbound rate limit', () => {
  const input = {
    accountId: 'account-1',
    sender: '+573001112233',
    accountLimit: 300,
    senderLimit: 20,
    windowStartedAt: new Date('2026-08-09T08:00:00.000Z'),
  };

  it('serializes account and sender counters before allowing the bounded event', async () => {
    const { repository, tx } = harness(20, 20);

    await expect(repository.consumeInboundRateLimit(input)).resolves.toMatchObject({
      allowed: true,
      reasonCode: 'WHATSAPP_RATE_LIMIT_ALLOWED',
      accountCount: 20,
      senderCount: 20,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.whatsappInboundEvent.count).toHaveBeenNthCalledWith(1, {
      where: { accountId: 'account-1', receivedAt: { gte: input.windowStartedAt } },
    });
    expect(tx.whatsappInboundEvent.count).toHaveBeenNthCalledWith(2, {
      where: { accountId: 'account-1', phone: '+573001112233', receivedAt: { gte: input.windowStartedAt } },
    });
  });

  it('fails closed when the sender ceiling is exceeded across replicas', async () => {
    const { repository } = harness(21, 21);
    await expect(repository.consumeInboundRateLimit(input)).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'WHATSAPP_SENDER_RATE_LIMITED',
      senderCount: 21,
    });
  });

  it('fails before sender evaluation when the global account ceiling is exceeded', async () => {
    const { repository, tx } = harness(301, 0);
    await expect(repository.consumeInboundRateLimit(input)).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'WHATSAPP_ACCOUNT_RATE_LIMITED',
      accountCount: 301,
      senderCount: null,
    });
    expect(tx.whatsappInboundEvent.count).toHaveBeenCalledTimes(1);
  });
});
