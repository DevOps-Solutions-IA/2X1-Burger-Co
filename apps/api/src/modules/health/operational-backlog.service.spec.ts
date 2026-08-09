import type { PrismaService } from '../../prisma/prisma.service';
import { OperationalBacklogService } from './operational-backlog.service';

describe('OperationalBacklogService', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');

  it('returns one bounded aggregate snapshot without durable identifiers', async () => {
    const query = jest.fn().mockResolvedValue([row({
      notificationActive: 4n,
      notificationExpiredLeases: 1n,
      webhookFinancialReview: 2n,
      inboundAttemptsExhausted: 3n,
      commandUnknownResult: 1n,
      checkoutFinancialReview: 1n,
      paymentUnknownResult: 2n,
    })]);
    const service = new OperationalBacklogService({ $queryRaw: query } as unknown as PrismaService);

    const snapshot = await service.snapshot(now);

    expect(query).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      available: true,
      collectedAt: now.toISOString(),
      notifications: { active: 4, expiredLeases: 1 },
      paymentWebhooks: { financialReviewRequired: 2 },
      whatsappInbound: { attemptsExhausted: 3 },
      secureCommands: { unknownResult: 1 },
      commerce: { checkoutFinancialReviewRequired: 1, paymentUnknownResult: 2 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/customer|phone|orderId|eventId|payload|errorCode/i);
  });

  it('fails closed as unavailable without leaking database errors', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('password=do-not-leak')),
    } as unknown as PrismaService;
    const snapshot = await new OperationalBacklogService(prisma).snapshot(now);

    expect(snapshot).toMatchObject({ available: false, collectedAt: now.toISOString() });
    expect(JSON.stringify(snapshot)).not.toContain('do-not-leak');
  });

  it('normalizes invalid database numeric values to safe non-negative values', async () => {
    const malformed = row({
      notificationActive: -1n,
      notificationOldestAgeSeconds: Number.NaN,
      webhookOldestAgeSeconds: -5,
    });
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([malformed]) } as unknown as PrismaService;

    const snapshot = await new OperationalBacklogService(prisma).snapshot(now);

    expect(snapshot.notifications.active).toBe(0);
    expect(snapshot.notifications.oldestActiveAgeSeconds).toBe(0);
    expect(snapshot.paymentWebhooks.oldestActiveAgeSeconds).toBe(0);
  });
});

function row(overrides: Record<string, bigint | number> = {}) {
  return {
    notificationActive: 0n,
    notificationPending: 0n,
    notificationClaimed: 0n,
    notificationCommandPending: 0n,
    notificationDispatched: 0n,
    notificationFailed: 0n,
    notificationUnknownResult: 0n,
    notificationExpiredLeases: 0n,
    notificationRetryReady: 0n,
    notificationOldestAgeSeconds: 0,
    webhookActive: 0n,
    webhookRetryReady: 0n,
    webhookExpiredLeases: 0n,
    webhookFinancialReview: 0n,
    webhookInvalidRecent: 0n,
    webhookOldestAgeSeconds: 0,
    inboundActive: 0n,
    inboundRetryReady: 0n,
    inboundExpiredLeases: 0n,
    inboundAttemptsExhausted: 0n,
    inboundMissingResult: 0n,
    inboundOldestAgeSeconds: 0,
    commandActive: 0n,
    commandFailed: 0n,
    commandRetryReady: 0n,
    commandExpiredLeases: 0n,
    commandUnknownResult: 0n,
    commandOldestAgeSeconds: 0,
    checkoutPaymentPending: 0n,
    checkoutFinancialReview: 0n,
    paymentPending: 0n,
    paymentUnknownResult: 0n,
    paymentFinancialReview: 0n,
    ...overrides,
  };
}
