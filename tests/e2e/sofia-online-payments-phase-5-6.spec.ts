import { PrismaClient } from '@prisma/client';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });

async function paymentSnapshot() {
  const [checkouts, intents, links, transitions, webhooks, salePayments, sales, cashMovements] = await Promise.all([
    prisma.orderCheckout.count(),
    prisma.paymentIntent.count(),
    prisma.paymentLink.count(),
    prisma.paymentTransition.count(),
    prisma.paymentWebhookEvent.count(),
    prisma.salePayment.count(),
    prisma.sale.count(),
    prisma.cashMovement.count(),
  ]);
  return { checkouts, intents, links, transitions, webhooks, salePayments, sales, cashMovements };
}

test('the legacy public mock payment webhook route is absent and cannot mutate payment truth', async ({ page }) => {
  const before = await paymentSnapshot();
  const response = await page.request.post('/api/integrations/payments/webhook/mock', {
    headers: { 'x-mock-payment-signature': 'synthetic-test-signature' },
    data: {
      eventId: 'retired-phase56-' + Date.now(),
      status: 'PAID',
      amount: 1,
      currency: 'COP',
    },
  });

  expect(response.status()).toBe(404);
  expect(await paymentSnapshot()).toEqual(before);
});

test('the authenticated dev mock webhook is retired without creating financial evidence', async ({
  page,
  workerAccessToken,
}) => {
  const before = await paymentSnapshot();
  const response = await page.request.post('/api/dev/sofia/payments/mock-webhook', {
    headers: { Authorization: 'Bearer ' + workerAccessToken },
    data: {
      orderReference: 'ORD-RETIRED-PHASE56',
      status: 'PAID',
      amount: 1,
    },
  });

  expect([404, 410]).toContain(response.status());
  if (response.status() === 410) {
    await expect(response.json()).resolves.toMatchObject({
      code: 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED',
      canonicalAuthority: 'ORDER_CHECKOUT_PAYMENT_ORCHESTRATION',
    });
  }
  expect(await paymentSnapshot()).toEqual(before);
});
