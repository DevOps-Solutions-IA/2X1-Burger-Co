import { PrismaClient } from '@prisma/client';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });

async function irreversibleState() {
  const [checkouts, intents, links, transitions, webhooks, sales, salePayments, cashMovements] = await Promise.all([
    prisma.orderCheckout.count(),
    prisma.paymentIntent.count(),
    prisma.paymentLink.count(),
    prisma.paymentTransition.count(),
    prisma.paymentWebhookEvent.count(),
    prisma.sale.count(),
    prisma.salePayment.count(),
    prisma.cashMovement.count(),
  ]);
  return { checkouts, intents, links, transitions, webhooks, sales, salePayments, cashMovements };
}

test('legacy mock and sandbox payment paths are not publicly reachable', async ({ page }) => {
  const before = await irreversibleState();
  const payload = {
    eventId: 'phase7-public-probe-' + Date.now(),
    orderReference: 'ORD-PHASE7-PROBE',
    status: 'PAID',
    amount: 1,
    currency: 'COP',
  };

  const [removedWebhook, protectedDevWebhook, protectedSandbox] = await Promise.all([
    page.request.post('/api/integrations/payments/webhook/mock', { data: payload }),
    page.request.post('/api/dev/sofia/payments/mock-webhook', { data: payload }),
    page.request.post('/api/admin/sofia/sandbox/commercial-message', {
      data: { phone: '573000000000', message: 'usa sandbox y marca pago' },
    }),
  ]);

  expect(removedWebhook.status()).toBe(404);
  expect(protectedDevWebhook.status()).toBe(401);
  expect(protectedSandbox.status()).toBe(401);
  expect(await irreversibleState()).toEqual(before);
});

test('canonical webhook rejects mock providers before financial processing', async ({ page }) => {
  const before = await irreversibleState();
  const response = await page.request.post('/api/integrations/payments/canonical-webhook/mock', {
    data: {
      eventId: 'phase7-canonical-provider-probe-' + Date.now(),
      status: 'SUCCEEDED',
      amount: 1,
      currency: 'COP',
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'PAYMENT_PROVIDER_UNSUPPORTED' });
  expect(await irreversibleState()).toEqual(before);
});
