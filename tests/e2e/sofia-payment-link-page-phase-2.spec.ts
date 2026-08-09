import {
  OrderCheckoutSource,
  OrderCheckoutStatus,
  OrderTicketType,
  PaymentIntentProvider,
  PaymentIntentStatus,
  PaymentLinkStatus,
  PrismaClient,
  SofiaPaymentPreference,
} from '@prisma/client';
import { createHash, createHmac, randomBytes } from 'node:crypto';
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

test('an active owned payment link renders canonical facts while production payment stays gated', async ({ page }) => {
  const before = await paymentEvidenceCounts();
  const suffix = randomBytes(12).toString('hex');
  const checkoutId = `phase7-checkout-${suffix}`;
  const intentId = `phase7-intent-${suffix}`;
  const linkId = randomBytes(18).toString('base64url');
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const publicReference = issuePublicReference(linkId, expiresAt);
  const apiBaseUrl = process.env.EPHEMERAL_API_BASE_URL;
  if (!apiBaseUrl) throw new Error('EPHEMERAL_API_BASE_URL is required.');

  try {
    await prisma.orderCheckout.create({
      data: {
        id: checkoutId,
        source: OrderCheckoutSource.POS,
        sourceReference: `PHASE7-E2E-${suffix}`,
        idempotencyKey: `phase7-checkout-${suffix}`,
        itemsSnapshot: [{ code: 'COMBO-2X1', name: 'Combo 2x1', quantity: 1, unitPrice: 25_000, totalPrice: 25_000 }],
        subtotal: 25_000,
        deliveryFee: 5_000,
        total: 30_000,
        currency: 'COP',
        fulfillment: OrderTicketType.DELIVERY,
        paymentPreference: SofiaPaymentPreference.ONLINE,
        status: OrderCheckoutStatus.PAYMENT_PENDING,
      },
    });
    await prisma.paymentIntent.create({
      data: {
        id: intentId,
        checkoutId,
        attemptNumber: 1,
        idempotencyKey: `phase7-intent-${suffix}`,
        provider: PaymentIntentProvider.BOLD,
        amount: 30_000,
        currency: 'COP',
        status: PaymentIntentStatus.LINK_READY,
        expiresAt,
      },
    });
    await prisma.paymentLink.create({
      data: {
        id: linkId,
        paymentIntentId: intentId,
        tokenHash: createHash('sha256').update(`discarded-${suffix}`).digest('hex'),
        status: PaymentLinkStatus.ACTIVE,
        expiresAt,
      },
    });

    await page.goto(`/pagos/${publicReference}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('public-payment-page')).toBeVisible();
    await expect(page.getByTestId('public-payment-total')).toContainText('30.000');
    await expect(page.getByTestId('public-payment-order-summary')).toContainText('1 x Combo 2x1');
    await expect(page.getByTestId('public-payment-order-summary')).toContainText('25.000');
    await expect(page.getByTestId('public-payment-order-summary')).toContainText('5.000');
    await expect(page.getByTestId('public-payment-status')).toContainText('Pago productivo deshabilitado');
    await expect(page.getByTestId('public-payment-method-online')).toBeDisabled();

    const start = await page.request.post(`${apiBaseUrl}/public/payments/${publicReference}/start-online`, {
      data: { method: 'ONLINE' },
    });
    expect(start.status()).toBe(403);
    expect(await prisma.orderCheckout.count({ where: { id: checkoutId } })).toBe(1);
    expect(await prisma.paymentIntent.count({ where: { id: intentId } })).toBe(1);
    expect(await prisma.paymentLink.count({ where: { id: linkId } })).toBe(1);
    expect(await prisma.paymentTransition.count({ where: { paymentIntentId: intentId } })).toBe(0);
  } finally {
    await prisma.paymentLink.deleteMany({ where: { id: linkId } });
    await prisma.paymentIntent.deleteMany({ where: { id: intentId } });
    await prisma.orderCheckout.deleteMany({ where: { id: checkoutId } });
  }

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

function issuePublicReference(linkId: string, expiresAt: Date) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is required for the public payment E2E.');
  const payload = Buffer.from(JSON.stringify({ v: 1, l: linkId, e: expiresAt.getTime() }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`2x1-payment-link:v1.${payload}`, 'utf8')
    .digest('base64url');
  return `${payload}.${signature}`;
}
