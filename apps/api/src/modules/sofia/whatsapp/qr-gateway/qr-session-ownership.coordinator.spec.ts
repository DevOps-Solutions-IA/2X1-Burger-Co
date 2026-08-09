import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  QrSessionOwnershipCoordinator,
  type QrSessionLease,
} from './qr-session-ownership.coordinator';

type SettingRow = { value: unknown };

function databaseHarness() {
  const rows = new Map<string, SettingRow>();
  let transactionTail = Promise.resolve();
  const setting = {
    findUnique: jest.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
    upsert: jest.fn(async (input: { where: { key: string }; create: SettingRow; update: SettingRow }) => {
      const value = rows.has(input.where.key) ? input.update.value : input.create.value;
      rows.set(input.where.key, { value });
      return { value };
    }),
  };
  const tx = { setting, $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = {
    setting,
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      let release!: () => void;
      const prior = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        return await callback(tx);
      } finally {
        release();
      }
    }),
  } as unknown as PrismaService;
  return { prisma, rows };
}

describe('QrSessionOwnershipCoordinator', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');

  it('allows exactly one owner under concurrent acquisition', async () => {
    const { prisma } = databaseHarness();
    const first = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const second = new QrSessionOwnershipCoordinator(prisma, 30_000);

    const results = await Promise.allSettled([
      first.acquire('sofia-main', now),
      second.acquire('sofia-main', now),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: 'QR_SESSION_ALREADY_OWNED' }),
    });
  });

  it('increments the fencing token after an expired owner is replaced', async () => {
    const { prisma } = databaseHarness();
    const first = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const second = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const stale = await first.acquire('sofia-main', now);
    const replacement = await second.acquire('sofia-main', new Date(now.getTime() + 31_000));

    expect(replacement.fencingToken).toBe(stale.fencingToken + 1);
    await expect(first.assertCurrent(stale, new Date(now.getTime() + 31_000))).rejects.toThrow(
      'QR_SESSION_FENCE_LOST',
    );
  });

  it('also fences callbacks when the same process reacquires an expired lease', async () => {
    const { prisma } = databaseHarness();
    const owner = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const stale = await owner.acquire('sofia-main', now);
    const reacquired = await owner.acquire('sofia-main', new Date(now.getTime() + 31_000));

    expect(reacquired.fencingToken).toBe(stale.fencingToken + 1);
  });

  it('renews and releases only the exact current lease', async () => {
    const { prisma } = databaseHarness();
    const owner = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const lease = await owner.acquire('sofia-main', now);
    const renewed = await owner.renew(lease, new Date(now.getTime() + 10_000));

    expect(Date.parse(renewed.leaseExpiresAt)).toBe(now.getTime() + 40_000);
    expect(await owner.release(renewed, new Date(now.getTime() + 11_000))).toBe(true);
    await expect(owner.assertCurrent(renewed, new Date(now.getTime() + 11_000))).rejects.toThrow(
      'QR_SESSION_FENCE_LOST',
    );
  });

  it('cannot release a lease with a stale fence', async () => {
    const { prisma } = databaseHarness();
    const owner = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const lease = await owner.acquire('sofia-main', now);
    const stale = { ...lease, fencingToken: lease.fencingToken - 1 } satisfies QrSessionLease;

    await expect(owner.release(stale, now)).resolves.toBe(false);
    await expect(owner.assertCurrent(lease, now)).resolves.toBeUndefined();
  });

  it('holds the ownership lock until a durable effect completes', async () => {
    const { prisma } = databaseHarness();
    const first = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const second = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const lease = await first.acquire('sofia-main', now);
    let finishEffect!: () => void;
    let markEffectStarted!: () => void;
    const effectBlocked = new Promise<void>((resolve) => {
      finishEffect = resolve;
    });
    const effectStarted = new Promise<void>((resolve) => {
      markEffectStarted = resolve;
    });
    const ordering: string[] = [];

    const effect = first.runFenced(
      lease,
      async () => {
        ordering.push('effect-start');
        markEffectStarted();
        await effectBlocked;
        ordering.push('effect-end');
      },
      now,
    );
    await effectStarted;
    const takeover = second
      .acquire('sofia-main', new Date(now.getTime() + 31_000))
      .then(() => ordering.push('takeover'));

    await Promise.resolve();
    expect(ordering).toEqual(['effect-start']);
    finishEffect();
    await Promise.all([effect, takeover]);
    expect(ordering).toEqual(['effect-start', 'effect-end', 'takeover']);
  });

  it('never invokes a durable effect after its fencing token is stale', async () => {
    const { prisma } = databaseHarness();
    const first = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const second = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const stale = await first.acquire('sofia-main', now);
    await second.acquire('sofia-main', new Date(now.getTime() + 31_000));
    const operation = jest.fn();

    await expect(
      first.runFenced(stale, operation, new Date(now.getTime() + 31_001)),
    ).rejects.toThrow('QR_SESSION_FENCE_LOST');
    expect(operation).not.toHaveBeenCalled();
  });
});
