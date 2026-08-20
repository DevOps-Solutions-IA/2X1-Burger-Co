import { PrismaClient } from '@prisma/client';
import { PrismaOrderCheckoutRepository } from '../../modules/order-checkout/persistence/prisma-order-checkout.repository';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * P6 timezone-matrix test infrastructure (SOFIA Payment webhook-lease timezone safety, round 6).
 *
 * Opens a genuinely separate PostgreSQL session/connection whose `timezone` GUC is set via the
 * libpq/`options=-c timezone=<tz>` connection-string startup parameter -- a real server-side
 * session setting, not a JS-side simulation and not a `SET TIME ZONE` issued against a
 * connection Prisma's pool might silently hand to a different logical caller. Each call opens
 * its own dedicated `PrismaClient` (its own connection pool against the target `_test`
 * database), so tests using different timezones never share a physical connection unless they
 * explicitly open one shared session and issue `SET LOCAL TIME ZONE` themselves mid-transaction
 * (the timezone-matrix spec's "same connection, timezone changed mid-transaction" scenario does
 * exactly that directly against its own `ctx.prisma`, since it needs to interleave typed-client
 * calls with `SET LOCAL` inside one `$transaction` callback).
 *
 * The session's actual `TimeZone` GUC is verified via `SHOW timezone` immediately after connect
 * -- if a pgbouncer/pooler in front of Postgres ever silently strips `options` (transaction-mode
 * poolers do this), this fails loudly instead of the whole matrix silently testing UTC five
 * times over.
 */

export type TzScopedContext = {
  tz: string;
  prisma: PrismaClient;
  repo: PrismaOrderCheckoutRepository;
  dispose: () => Promise<void>;
};

function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || !url.includes('_test')) {
    throw new Error(
      'P6 timezone-matrix tests require an isolated _test database via TEST_DATABASE_URL/DATABASE_URL.',
    );
  }
  return url;
}

function withTimezoneOption(url: string, tz: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}options=${encodeURIComponent(`-c timezone=${tz}`)}`;
}

async function assertSessionTimezone(prisma: PrismaClient, expectedTz: string): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW timezone');
  const actual = rows[0]?.TimeZone;
  if (actual !== expectedTz) {
    throw new Error(
      `P6 timezone-matrix: session TimeZone GUC did not take effect (expected "${expectedTz}", got ` +
        `${JSON.stringify(rows)}). This would silently invalidate the whole matrix -- failing closed.`,
    );
  }
}

/**
 * Opens a dedicated Postgres session pinned to `tz` for the lifetime of the returned context.
 * `repo` is a real `PrismaOrderCheckoutRepository` bound to that exact session, so every method
 * under test (`claimWebhookEvidence`, `findClaimedWebhookEvidence`, `claimRecoverableWebhook`,
 * `findRecoverableWebhookIds`, `advanceWebhookCheckpoint`, `completeWebhookClaim`,
 * `failWebhookClaim`, `assertWebhookClaimOwned`, `renewWebhookClaim`) runs its real SQL against a
 * connection whose server-side `timezone` GUC is genuinely `tz` -- exactly the condition PK6's
 * report says was previously unverified in production.
 */
export async function openTzScopedContext(tz: string): Promise<TzScopedContext> {
  const url = withTimezoneOption(resolveTestDatabaseUrl(), tz);
  const prisma = new PrismaClient({ datasourceUrl: url });
  await prisma.$connect();
  await assertSessionTimezone(prisma, tz);
  const repo = new PrismaOrderCheckoutRepository(prisma as unknown as PrismaService);
  return {
    tz,
    prisma,
    repo,
    dispose: async () => {
      await prisma.$disconnect();
    },
  };
}
