import { PrismaClient } from '@prisma/client';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });

async function financialSnapshot() {
  const [settings, checkouts, intents, links, transitions, sales, cashMovements] = await Promise.all([
    prisma.sofiaPaymentSettings.findUnique({ where: { id: 'default' } }),
    prisma.orderCheckout.count(),
    prisma.paymentIntent.count(),
    prisma.paymentLink.count(),
    prisma.paymentTransition.count(),
    prisma.sale.count(),
    prisma.cashMovement.count(),
  ]);
  return { settings, checkouts, intents, links, transitions, sales, cashMovements };
}

test('legacy Sofia manual payment configuration is immutable and retired', async ({ page, workerAccessToken }) => {
  const before = await financialSnapshot();

  const update = await page.request.patch('/api/admin/sofia/payment-settings', {
    headers: { Authorization: 'Bearer ' + workerAccessToken },
    data: {
      cashEnabled: true,
      nequiManualEnabled: true,
      nequiManualPhone: '3000000000',
      onlinePaymentsEnabled: true,
      onlinePaymentProvider: 'MOCK',
      mockOnlinePaymentsEnabled: true,
    },
  });

  expect(update.status()).toBe(404);
  expect(await financialSnapshot()).toEqual(before);
});

test('legacy Sofia payment settings cannot be used as a public fallback', async ({ page }) => {
  const before = await financialSnapshot();
  const response = await page.request.get('/api/admin/sofia/payment-settings');

  expect(response.status()).toBe(404);
  expect(await financialSnapshot()).toEqual(before);
});
