import { PrismaClient } from '@prisma/client';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });

async function operationalSnapshot() {
  const [checkouts, tickets, intents, links, transitions, salePayments, sales, cashMovements] = await Promise.all([
    prisma.orderCheckout.count(),
    prisma.orderTicket.count(),
    prisma.paymentIntent.count(),
    prisma.paymentLink.count(),
    prisma.paymentTransition.count(),
    prisma.salePayment.count(),
    prisma.sale.count(),
    prisma.cashMovement.count(),
  ]);
  return { checkouts, tickets, intents, links, transitions, salePayments, sales, cashMovements };
}

test('legacy Orders payment-link mutation is retired before touching POS or delivery state', async ({
  page,
  workerAccessToken,
}) => {
  const before = await operationalSnapshot();
  const response = await page.request.post('/api/orders/retired-phase4/sofia-payment-link', {
    headers: { Authorization: 'Bearer ' + workerAccessToken },
    data: {},
  });

  expect(response.status()).toBe(404);
  expect(await operationalSnapshot()).toEqual(before);
});

test('legacy operator payment status cannot establish payment truth', async ({ page, workerAccessToken }) => {
  const before = await operationalSnapshot();
  const response = await page.request.patch('/api/orders/retired-phase4/sofia-payment-status', {
    headers: { Authorization: 'Bearer ' + workerAccessToken },
    data: { status: 'FAILED', paymentMethod: 'ONLINE' },
  });

  expect(response.status()).toBe(404);
  expect(await operationalSnapshot()).toEqual(before);
});
