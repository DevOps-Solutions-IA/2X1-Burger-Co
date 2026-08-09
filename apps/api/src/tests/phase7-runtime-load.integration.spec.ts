import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SofiaWhatsappService } from '../modules/sofia/sofia-whatsapp.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

jest.setTimeout(90_000);

describe('Phase 7 bounded runtime load integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsapp: SofiaWhatsappService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Phase 7 runtime load requires an isolated _test database.');
    }
    process.env.JWT_ACCESS_SECRET ??= 'phase7-load-access-secret-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET ??= 'phase7-load-refresh-secret-different-at-least-32-chars';
    process.env.NODE_ENV = 'test';
    ({ app, prisma } = await createTestApp());
    whatsapp = app.get(SofiaWhatsappService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
  });

  it('processes a bounded canonical QR inbound burst without outbound or financial effects', async () => {
    const before = await irreversibleCounts(prisma);
    const burst = await inConcurrentBatches(Array.from({ length: 24 }, (_, index) => index), 8, (index) =>
      whatsapp.processInboundWebhook('qr_gateway', qrPayload(index), qrHeaders(), { trustedBaileysTransport: true }),
    );

    expect(new Set(burst.map((response) => response.inboundEventId)).size).toBe(24);
    expect(await prisma.whatsappInboundEvent.count()).toBe(24);
    expect(await irreversibleCounts(prisma)).toEqual({ ...before, inbound: 24 });
  });

  it('collapses a concurrent replay burst to one durable inbound identity', async () => {
    const payload = qrPayload('duplicate');
    const first = await whatsapp.processInboundWebhook(
      'qr_gateway',
      payload,
      qrHeaders(),
      { trustedBaileysTransport: true },
    );
    const responses = await inConcurrentBatches(Array.from({ length: 32 }, (_, index) => index), 8, () =>
      whatsapp.processInboundWebhook('qr_gateway', payload, qrHeaders(), { trustedBaileysTransport: true }),
    );

    expect(new Set([first.inboundEventId, ...responses.map((response) => response.inboundEventId)]).size).toBe(1);
    expect(await prisma.whatsappInboundEvent.count()).toBe(1);
    expect(await prisma.whatsappOutboundMessage.count()).toBe(0);
  });
});

function qrHeaders() {
  return {
    'x-sofia-whatsapp-mode': 'receive_only',
    'x-sofia-whatsapp-provider': 'qr_gateway',
  };
}

function qrPayload(identity: number | string) {
  const senderSuffix = typeof identity === 'number' ? String(identity).padStart(7, '0').slice(-7) : '9990000';
  return {
    providerEventId: `phase7-qr-event-${identity}`,
    externalMessageId: `phase7-qr-message-${identity}`,
    phone: `+57310${senderSuffix}`,
    text: identity === 'duplicate' ? 'duplicado determinista' : 'mensaje acotado de prueba',
    messageType: 'TEXT',
    providerAccountId: 'phase7-load-account',
    businessIdentity: 'phase7-load-business',
    sessionOwner: 'phase7-load-session-owner',
    timestamp: '2026-08-09T00:00:00.000Z',
  };
}

async function irreversibleCounts(prisma: PrismaService) {
  const [inbound, outbound, checkouts, intents, transitions, sales, cash, inventory] = await Promise.all([
    prisma.whatsappInboundEvent.count(),
    prisma.whatsappOutboundMessage.count(),
    prisma.orderCheckout.count(),
    prisma.paymentIntent.count(),
    prisma.paymentTransition.count(),
    prisma.sale.count(),
    prisma.cashMovement.count(),
    prisma.inventoryMovement.count(),
  ]);
  return { inbound, outbound, checkouts, intents, transitions, sales, cash, inventory };
}

async function inConcurrentBatches<T, R>(
  values: readonly T[],
  batchSize: number,
  execute: (value: T) => Promise<R>,
) {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...await Promise.all(values.slice(index, index + batchSize).map(execute)));
  }
  return results;
}
