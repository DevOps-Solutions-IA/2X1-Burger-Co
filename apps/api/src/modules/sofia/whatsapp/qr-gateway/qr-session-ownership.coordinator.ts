import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { PrismaService } from '../../../../prisma/prisma.service';

const OWNERSHIP_SETTING_PREFIX = 'SOFIA_WHATSAPP_QR_SESSION_OWNER:';

export type QrSessionLease = {
  sessionName: string;
  ownerHash: string;
  fencingToken: number;
  leaseExpiresAt: string;
};

export type QrSessionFencedResult<T> = {
  lease: QrSessionLease;
  result: T;
};

type PersistedLease = {
  ownerHash?: string | null;
  fencingToken?: number;
  leaseExpiresAt?: string | null;
  releasedAt?: string | null;
};

export class QrSessionOwnershipCoordinator {
  readonly ownerHash = createHash('sha256').update(randomUUID()).digest('hex');

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaseMs = 30_000,
  ) {}

  async acquire(sessionName: string, now?: Date): Promise<QrSessionLease> {
    return this.prisma.$transaction(async (tx) => {
      const key = this.settingKey(sessionName);
      await this.lock(tx, key);
      const checkedAt = now ?? new Date();
      const current = await this.read(tx, key);
      const activeOtherOwner =
        current.ownerHash &&
        current.ownerHash !== this.ownerHash &&
        this.isFuture(current.leaseExpiresAt, checkedAt);
      if (activeOtherOwner) {
        throw new ConflictException('QR_SESSION_ALREADY_OWNED');
      }

      const sameActiveOwner =
        current.ownerHash === this.ownerHash && this.isFuture(current.leaseExpiresAt, checkedAt);
      const fencingToken = sameActiveOwner
        ? this.safeFencingToken(current.fencingToken)
        : this.safeFencingToken(current.fencingToken) + 1;
      const lease = this.lease(sessionName, fencingToken, checkedAt);
      await this.write(tx, key, lease);
      return lease;
    });
  }

  async renew(lease: QrSessionLease, now?: Date): Promise<QrSessionLease> {
    return this.prisma.$transaction(async (tx) => {
      const key = this.settingKey(lease.sessionName);
      await this.lock(tx, key);
      const checkedAt = now ?? new Date();
      const current = await this.read(tx, key);
      this.assertMatching(current, lease, checkedAt);
      const renewed = this.lease(lease.sessionName, lease.fencingToken, checkedAt);
      await this.write(tx, key, renewed);
      return renewed;
    });
  }

  async assertCurrent(lease: QrSessionLease, now = new Date()): Promise<void> {
    const current = await this.read(this.prisma, this.settingKey(lease.sessionName));
    this.assertMatching(current, lease, now);
  }

  async runFenced<T>(
    lease: QrSessionLease,
    operation: () => Promise<T> | T,
    now?: Date,
  ): Promise<QrSessionFencedResult<T>> {
    return this.prisma.$transaction(
      async (tx) => {
        const key = this.settingKey(lease.sessionName);
        await this.lock(tx, key);
        const checkedAt = now ?? new Date();
        const current = await this.read(tx, key);
        this.assertMatching(current, lease, checkedAt);

        // Keep replacement owners behind this transaction-scoped fence until
        // the credential or inbound effect has reached its durable boundary.
        await this.write(tx, key, this.lease(lease.sessionName, lease.fencingToken, checkedAt));
        const result = await operation();
        const completedAt = new Date(Math.max(Date.now(), checkedAt.getTime()));
        const renewed = this.lease(lease.sessionName, lease.fencingToken, completedAt);
        await this.write(tx, key, renewed);
        return { lease: renewed, result };
      },
      { maxWait: 5_000, timeout: 120_000 },
    );
  }

  async release(lease: QrSessionLease, now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const key = this.settingKey(lease.sessionName);
      await this.lock(tx, key);
      const current = await this.read(tx, key);
      if (
        current.ownerHash !== lease.ownerHash ||
        this.safeFencingToken(current.fencingToken) !== lease.fencingToken
      ) {
        return false;
      }
      await this.write(tx, key, {
        ownerHash: null,
        fencingToken: lease.fencingToken,
        leaseExpiresAt: now.toISOString(),
        releasedAt: now.toISOString(),
      });
      return true;
    });
  }

  private lease(sessionName: string, fencingToken: number, now: Date): QrSessionLease {
    return {
      sessionName,
      ownerHash: this.ownerHash,
      fencingToken,
      leaseExpiresAt: new Date(now.getTime() + this.leaseMs).toISOString(),
    };
  }

  private assertMatching(current: PersistedLease, lease: QrSessionLease, now: Date): void {
    if (
      current.ownerHash !== lease.ownerHash ||
      this.safeFencingToken(current.fencingToken) !== lease.fencingToken ||
      !this.isFuture(current.leaseExpiresAt, now)
    ) {
      throw new ConflictException('QR_SESSION_FENCE_LOST');
    }
  }

  private settingKey(sessionName: string): string {
    return `${OWNERSHIP_SETTING_PREFIX}${createHash('sha256').update(sessionName).digest('hex')}`;
  }

  private safeFencingToken(value: unknown): number {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }

  private isFuture(value: unknown, now: Date): boolean {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now.getTime();
  }

  private async lock(tx: Prisma.TransactionClient, key: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private async read(
    client: Pick<Prisma.TransactionClient, 'setting'>,
    key: string,
  ): Promise<PersistedLease> {
    const setting = await client.setting.findUnique({ where: { key }, select: { value: true } });
    const value = setting?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as PersistedLease)
      : {};
  }

  private async write(
    tx: Prisma.TransactionClient,
    key: string,
    value: PersistedLease | QrSessionLease,
  ): Promise<void> {
    await tx.setting.upsert({
      where: { key },
      create: {
        key,
        value: value as Prisma.InputJsonValue,
        category: 'sofia_whatsapp_qr_ownership',
        description: 'Sanitized QR session owner lease and fencing token',
      },
      update: { value: value as Prisma.InputJsonValue },
    });
  }
}
