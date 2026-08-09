import { PrismaClient } from '@prisma/client';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });

async function paymentEvidenceCounts() {
  const [intents, links, transitions, webhooks, legacyEvents] = await Promise.all([
    prisma.paymentIntent.count(),
    prisma.paymentLink.count(),
    prisma.paymentTransition.count(),
    prisma.paymentWebhookEvent.count(),
    prisma.sofiaPaymentEvent.count(),
  ]);
  return { intents, links, transitions, webhooks, legacyEvents };
}

test('legacy Sofia public payment links are retired without financial mutation', async ({ page }) => {
  const before = await paymentEvidenceCounts();
  const token = 'retired-phase2-' + Date.now();

  const read = await page.request.get('/api/public/sofia/payments/' + token);
  expect(read.status()).toBe(404);

  const selectMethod = await page.request.post('/api/public/sofia/payments/' + token + '/select-method', {
    data: { method: 'ONLINE' },
  });
  expect(selectMethod.status()).toBe(404);

  expect(await paymentEvidenceCounts()).toEqual(before);
});

test('the owned payment page resolves only the canonical public payment authority', async ({ page }) => {
  const before = await paymentEvidenceCounts();
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));

  await page.goto('/pagos/unknown-phase7-' + Date.now(), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('public-payment-invalid')).toBeVisible({ timeout: 15_000 });

  expect(requestedUrls.some((url) => url.includes('/public/payments/'))).toBe(true);
  expect(requestedUrls.some((url) => url.includes('/public/sofia/payments/'))).toBe(false);
  expect(await paymentEvidenceCounts()).toEqual(before);
});
