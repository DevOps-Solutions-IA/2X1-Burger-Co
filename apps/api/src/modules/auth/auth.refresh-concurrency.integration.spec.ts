import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppEnv } from '../../config/env';
import { AuditContextService } from '../audit/audit-context.service';
import { AuditService } from '../audit/audit.service';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { AuthService } from './auth.service';

describe('Auth refresh-token rotation concurrency', () => {
  let prisma: PrismaService;
  let service: AuthService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refresh concurrency tests require an isolated _test database.');
    }
    process.env.JWT_ACCESS_SECRET ??= 'change-this-access-secret-with-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET ??= 'change-this-refresh-secret-with-at-least-32-characters';

    prisma = new PrismaService();
    await prisma.$connect();
    const values: Partial<AppEnv> = {
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      MAX_ACTIVE_REFRESH_TOKENS_PER_USER: 5,
    };
    const config = { get: (key: keyof AppEnv) => values[key] } as ConfigService<AppEnv, true>;
    service = new AuthService(
      prisma,
      new JwtService(),
      config,
      new AuditService(prisma, new AuditContextService()),
    );
  });

  afterAll(async () => prisma.$disconnect());

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
  });

  it('keeps a single rotation lineage usable when the parent is used once', async () => {
    const login = await service.login(
      { email: 'admin@2x1burgerco.local', password: 'Admin12345*' },
      requestMeta('10.20.0.1'),
    );
    const parent = login.refreshToken;

    const child = await service.refresh(parent, requestMeta('10.20.0.2'));
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    const activeAfterRace = await prisma.refreshToken.findMany({
      where: { userId: admin.id, revokedAt: null },
      select: { tokenHash: true },
    });
    expect(activeAfterRace).toEqual([{ tokenHash: hashToken(child.refreshToken) }]);
    await expect(service.refresh(child.refreshToken, requestMeta('10.20.0.3'))).resolves.toHaveProperty(
      'refreshToken',
    );
  });

  it('invalidates an attacker race winner when the victim concurrently uses the same parent', async () => {
    const login = await service.login(
      { email: 'admin@2x1burgerco.local', password: 'Admin12345*' },
      requestMeta('10.30.0.1'),
    );
    const parent = login.refreshToken;
    const parentHash = hashToken(parent);
    let attackerAttempt!: ReturnType<AuthService['refresh']>;
    let victimAttempt!: ReturnType<AuthService['refresh']>;

    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "refresh_tokens"
          WHERE "tokenHash" = ${parentHash}
          FOR UPDATE
        `;

        attackerAttempt = service.refresh(parent, requestMeta('198.51.100.10'));
        await waitForRefreshLock(prisma, parentHash, true);

        victimAttempt = service.refresh(parent, requestMeta('10.30.0.1'));
        await waitForRefreshLock(prisma, parentHash, false);
      },
      { timeout: 30_000 },
    );

    const [attacker, victim] = await Promise.allSettled([attackerAttempt, victimAttempt]);
    expect(attacker.status).toBe('fulfilled');
    expect(victim.status).toBe('rejected');
    if (attacker.status !== 'fulfilled') {
      throw new Error('The deterministic lock queue did not select the attacker first.');
    }

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    expect(await prisma.refreshToken.count({ where: { userId: admin.id, revokedAt: null } })).toBe(0);
    expect(admin.sessionVersion).toBeGreaterThan(0);
    await expect(
      service.refresh(attacker.value.refreshToken, requestMeta('198.51.100.10')),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('revokes the active descendant when the parent is replayed later', async () => {
    const login = await service.login(
      { email: 'admin@2x1burgerco.local', password: 'Admin12345*' },
      requestMeta('10.40.0.1'),
    );
    const parent = login.refreshToken;
    const child = await service.refresh(parent, requestMeta('10.40.0.2'));

    await expect(service.refresh(parent, requestMeta('10.40.0.3'))).rejects.toMatchObject({ status: 401 });

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    expect(await prisma.refreshToken.count({ where: { userId: admin.id, revokedAt: null } })).toBe(0);
    expect(admin.sessionVersion).toBeGreaterThan(0);
    await expect(service.refresh(child.refreshToken, requestMeta('10.40.0.4'))).rejects.toMatchObject({
      status: 401,
    });
  });
});

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function requestMeta(ip: string) {
  return {
    headers: { 'x-forwarded-for': ip, 'user-agent': 'phase7-auth-concurrency-test' },
    ip,
  } as unknown as Request;
}

async function waitForRefreshLock(prisma: PrismaService, tokenHash: string, granted: boolean) {
  const lockIdentity = `auth-refresh:${tokenHash}`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [state] = await prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "pg_locks"
        WHERE "locktype" = 'advisory'
          AND "classid" = (
            (hashtextextended(${lockIdentity}, 0) >> 32) & 4294967295
          )::oid
          AND "objid" = (
            hashtextextended(${lockIdentity}, 0) & 4294967295
          )::oid
          AND "objsubid" = 1
          AND "granted" = ${granted}
      ) AS "present"
    `;
    if (state?.present) return;
    await delay(10);
  }

  throw new Error(`Timed out waiting for refresh advisory lock (granted=${granted}).`);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
