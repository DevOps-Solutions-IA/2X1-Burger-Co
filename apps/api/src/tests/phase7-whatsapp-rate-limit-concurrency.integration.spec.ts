import { WhatsappInboundEventKind } from '@prisma/client';
import { PrismaWhatsappProductionRepository } from '../modules/sofia/whatsapp/production/persistence/prisma-whatsapp-production.repository';
import { QrSessionOwnershipCoordinator } from '../modules/sofia/whatsapp/qr-gateway/qr-session-ownership.coordinator';
import { PrismaService } from '../prisma/prisma.service';
import { resetDatabase } from './helpers/test-data';

describe('Phase 7 PostgreSQL WhatsApp rate-limit concurrency', () => {
  let prisma: PrismaService;
  let repository: PrismaWhatsappProductionRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('WhatsApp rate-limit concurrency requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaWhatsappProductionRepository(prisma, {} as never);
  });

  afterAll(async () => prisma.$disconnect());

  beforeEach(async () => resetDatabase(prisma));

  it('never admits more than the remaining sender capacity across concurrent replicas', async () => {
    const account = await repository.resolveAccount({
      provider: 'qr_gateway',
      externalAccountId: 'phase7-account',
      businessIdentity: 'phase7-business',
      sessionOwner: 'phase7-session-owner',
    });
    const sender = '573001234567';
    const windowStartedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000);

    for (let index = 0; index < 19; index += 1) {
      await repository.claimInbound({
        accountId: account.id,
        provider: 'qr_gateway',
        eventId: `phase7-pre-${index}`,
        messageId: `phase7-pre-message-${index}`,
        phone: sender,
        eventHash: `phase7-pre-hash-${index}`,
        normalizedPayloadHash: `phase7-pre-hash-${index}`,
        eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      });
    }

    const decisions = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      await repository.claimInbound({
        accountId: account.id,
        provider: 'qr_gateway',
        eventId: `phase7-race-${index}`,
        messageId: `phase7-race-message-${index}`,
        phone: sender,
        eventHash: `phase7-race-hash-${index}`,
        normalizedPayloadHash: `phase7-race-hash-${index}`,
        eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      });
      return repository.consumeInboundRateLimit({
        accountId: account.id,
        sender,
        accountLimit: 300,
        senderLimit: 20,
        windowStartedAt,
      });
    }));

    expect(decisions.filter((decision) => decision.allowed).length).toBeLessThanOrEqual(1);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(
      decisions.length - decisions.filter((decision) => decision.allowed).length,
    );
    expect(await prisma.whatsappInboundEvent.count({ where: { accountId: account.id } })).toBe(31);
  });

  it('grants one QR session lease and fences the competing replica', async () => {
    const first = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const second = new QrSessionOwnershipCoordinator(prisma, 30_000);
    const results = await Promise.allSettled([
      first.acquire('phase7-real-postgres-session'),
      second.acquire('phase7-real-postgres-session'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: 'QR_SESSION_ALREADY_OWNED' }),
    });
  });
});
