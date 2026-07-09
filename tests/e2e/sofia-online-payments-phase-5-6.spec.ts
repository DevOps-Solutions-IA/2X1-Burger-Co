import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();
const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-online-payments-adapter-webhooks-phase-5-6',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });
test.setTimeout(300_000);

async function ensureCashOpen(page: import('@playwright/test').Page, accessToken: string) {
  const currentResponse = await page.request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(currentResponse.ok()).toBeTruthy();
  const currentCash = await currentResponse.json().catch(() => null);

  if (!currentCash) {
    const openResponse = await page.request.post('/api/cash-register/open', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        openingAmount: 50000,
        notes: 'Apertura controlada para E2E pagos online Sofía',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

async function configureOnlinePayments(page: import('@playwright/test').Page, accessToken: string) {
  const response = await page.request.patch('/api/admin/sofia/payment-settings', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      cashEnabled: true,
      nequiManualEnabled: true,
      nequiManualPhone: '3001234567',
      onlinePaymentsEnabled: true,
      onlinePaymentProvider: 'MOCK',
      mockOnlinePaymentsEnabled: true,
      onlinePaymentExpiresMinutes: 20,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function createSofiaOrderFromApi(page: import('@playwright/test').Page, accessToken: string, suffix: string) {
  const phone = `+57 320 77${Date.now().toString().slice(-5)}`;
  const product = await prisma.product.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  expect(product?.id).toBeTruthy();

  const headers = { Authorization: `Bearer ${accessToken}` };
  const conversation = await page.request.post('/api/admin/sofia/conversations/mock-inbound', {
    headers,
    data: {
      phone,
      customerName: `Cliente Online ${suffix}`,
      body: 'Hola Sofía, quiero pagar online',
    },
  });
  expect(conversation.status()).toBe(201);
  const conversationBody = await conversation.json();

  const draft = await page.request.post('/api/admin/sofia/order-drafts', {
    headers,
    data: {
      conversationId: conversationBody.id,
      customerName: `Cliente Online ${suffix}`,
      customerPhone: phone,
      deliveryAddress: `Avenida Online ${suffix} # 5-10`,
      deliveryNeighborhood: 'Jamundí',
      deliveryNotes: `Pedido online ${suffix}`,
      deliveryFee: 3000,
      items: [{ productId: product!.id, quantity: 1 }],
    },
  });
  expect(draft.status()).toBe(201);
  const draftBody = await draft.json();

  await page.request.post(`/api/admin/sofia/order-drafts/${draftBody.id}/confirm`, { headers });
  const deliveryOrder = await page.request.post(`/api/admin/sofia/delivery-orders/from-draft/${draftBody.id}`, {
    headers,
    data: { createOperationalTicket: true },
  });
  expect(deliveryOrder.status()).toBe(201);
  const deliveryOrderBody = await deliveryOrder.json();
  expect(deliveryOrderBody.orderTicketId).toBeTruthy();
  return deliveryOrderBody.orderTicketId as string;
}

async function generatePaymentLink(page: import('@playwright/test').Page, accessToken: string, orderTicketId: string) {
  const response = await page.request.post(`/api/orders/${orderTicketId}/sofia-payment-link`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {},
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  const baseUrl = process.env.BASE_URL ?? 'http://localhost';
  return String(body.publicPaymentUrl).replace(/^http:\/\/localhost:3301/i, baseUrl);
}

async function startOnlinePayment(
  browser: import('@playwright/test').Browser,
  paymentUrl: string,
  screenshotPrefix?: string,
) {
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(paymentUrl, { waitUntil: 'domcontentloaded' });
  await expect(publicPage.getByTestId('public-payment-method-online')).toBeVisible({ timeout: 15000 });
  if (screenshotPrefix) {
    await publicPage.screenshot({ path: path.join(screenshotsDir, `${screenshotPrefix}-online-available.png`), fullPage: true });
  }
  await publicPage.getByTestId('public-payment-method-online').click();
  await publicPage.getByTestId('public-confirm-online').click();
  await expect(publicPage.getByTestId('public-payment-status')).toContainText(/pago en línea|online/i, { timeout: 15000 });
  await expect(publicPage.getByTestId('public-online-checkout-link')).toBeVisible({ timeout: 15000 });
  const checkoutUrl = await publicPage.getByTestId('public-online-checkout-link').getAttribute('href');
  const reference = (await publicPage.getByTestId('public-payment-reference').innerText()).trim();
  return { publicContext, publicPage, checkoutUrl: checkoutUrl ?? '', reference };
}

async function getSofiaPaymentRecord(orderTicketId: string) {
  const order = await prisma.orderTicket.findUniqueOrThrow({
    where: { id: orderTicketId },
    include: { whatsappDeliveryOrder: true },
  });
  expect(order.whatsappDeliveryOrder).toBeTruthy();
  return order.whatsappDeliveryOrder!;
}

async function simulateMockWebhook(
  page: import('@playwright/test').Page,
  _accessToken: string,
  input: {
    orderReference: string;
    status: 'PAID' | 'FAILED' | 'REVIEW';
    amount: number;
    eventId: string;
  },
) {
  const response = await page.request.post('/api/integrations/payments/webhook/mock', {
    headers: { 'x-mock-payment-signature': 'mock-dev-signature' },
    data: { ...input, currency: 'COP' },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function createFreshOperatorContext(browser: import('@playwright/test').Browser) {
  const password = 'E2eSofiaOnline12345*';
  const email = `e2e-sofia-online-${Date.now()}@2x1burgerco.local`;
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });

  await prisma.user.create({
    data: {
      email,
      fullName: 'E2E Operador Online Sofía',
      passwordHash: await hash(password, 12),
      isActive: true,
      roles: {
        create: [{ roleId: adminRole.id }],
      },
    },
  });

  const context = await browser.newContext();
  let lastStatus = 0;
  for (const [attempt, delayMs] of [0, 10_000, 20_000, 30_000].entries()) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const response = await context.request.post('/api/auth/login', {
      headers: { 'X-Forwarded-For': `10.251.${process.pid % 250}.${attempt + 1}` },
      data: { email, password },
    });
    lastStatus = response.status();
    if (response.status() === 201) break;
    if (response.status() !== 429 && response.status() !== 503) break;
  }
  expect(lastStatus).toBe(201);
  return context;
}

async function createFreshApiAccessToken(page: import('@playwright/test').Page) {
  const password = 'E2eSofiaOnlineApi12345*';
  const email = `e2e-sofia-online-api-${Date.now()}@2x1burgerco.local`;
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });

  await prisma.user.create({
    data: {
      email,
      fullName: 'E2E API Online Sofía',
      passwordHash: await hash(password, 12),
      isActive: true,
      roles: {
        create: [{ roleId: adminRole.id }],
      },
    },
  });

  let body: { accessToken?: string } | null = null;
  let lastStatus = 0;
  for (const [attempt, delayMs] of [0, 10_000, 20_000, 30_000, 45_000].entries()) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const response = await page.request.post('/api/auth/login', {
      headers: { 'X-Forwarded-For': `10.252.${process.pid % 250}.${attempt + 1}` },
      data: { email, password },
    });
    lastStatus = response.status();
    if (response.status() === 201) {
      body = (await response.json()) as { accessToken?: string };
      break;
    }
    if (response.status() !== 429 && response.status() !== 503) {
      break;
    }
  }
  expect(lastStatus).toBe(201);
  expect(body?.accessToken).toBeTruthy();
  return body!.accessToken!;
}

test('Sofia online payments use mock adapter, idempotent webhooks and POS/deliveries reflection', async ({
  page,
  browser,
}) => {
  const runId = Date.now();
  const apiAccessToken = await createFreshApiAccessToken(page);
  await ensureCashOpen(page, apiAccessToken);
  await configureOnlinePayments(page, apiAccessToken);

  const paidOrderTicketId = await createSofiaOrderFromApi(page, apiAccessToken, 'Aprobado');
  const paidPaymentUrl = await generatePaymentLink(page, apiAccessToken, paidOrderTicketId);
  const paidOnline = await startOnlinePayment(browser, paidPaymentUrl);
  await paidOnline.publicPage.screenshot({ path: path.join(screenshotsDir, '01-payment-page-online-available.png'), fullPage: true });
  await paidOnline.publicPage.screenshot({ path: path.join(screenshotsDir, '02-online-payment-selected-pending.png'), fullPage: true });
  const mockCheckoutPage = await paidOnline.publicContext.newPage();
  await mockCheckoutPage.goto(paidOnline.checkoutUrl, { waitUntil: 'domcontentloaded' });
  await expect(mockCheckoutPage.getByTestId('mock-payment-checkout-page')).toBeVisible({ timeout: 15000 });
  await mockCheckoutPage.screenshot({ path: path.join(screenshotsDir, '03-mock-checkout.png'), fullPage: true });

  const paidRecord = await getSofiaPaymentRecord(paidOrderTicketId);
  const paidWebhook = await simulateMockWebhook(page, apiAccessToken, {
    orderReference: paidRecord.orderReference!,
    status: 'PAID',
    amount: Number(paidRecord.total),
    eventId: `e2e-online-paid-${runId}`,
  });
  expect(paidWebhook.paymentStatus).toBe('PAID');
  await mockCheckoutPage.screenshot({ path: path.join(screenshotsDir, '04-mock-payment-approved.png'), fullPage: true });

  const operatorContext = await createFreshOperatorContext(browser);
  const deliveriesPage = await operatorContext.newPage();
  await deliveriesPage.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  await deliveriesPage.getByTestId('deliveries-filter-paid').click();
  const paidQueueItem = deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: paidRecord.orderReference! }).first();
  await expect(paidQueueItem).toContainText('Pagado', { timeout: 15000 });
  await paidQueueItem.click();
  await expect(deliveriesPage.getByTestId('deliveries-detail-sofia-payment')).toContainText('Pagado');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '05-deliveries-online-paid.png'), fullPage: true });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-payment-events')).toContainText('Webhook válido marcó el pago online como pagado');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '06-payment-event-webhook-paid.png'), fullPage: true });

  const failedOrderTicketId = await createSofiaOrderFromApi(page, apiAccessToken, 'Fallido');
  const failedPaymentUrl = await generatePaymentLink(page, apiAccessToken, failedOrderTicketId);
  const failedOnline = await startOnlinePayment(browser, failedPaymentUrl);
  const failedRecord = await getSofiaPaymentRecord(failedOrderTicketId);
  const failedWebhook = await simulateMockWebhook(page, apiAccessToken, {
    orderReference: failedRecord.orderReference!,
    status: 'FAILED',
    amount: Number(failedRecord.total),
    eventId: `e2e-online-failed-${runId}`,
  });
  expect(failedWebhook.paymentStatus).toBe('FAILED');
  await failedOnline.publicPage.screenshot({ path: path.join(screenshotsDir, '07-mock-payment-failed.png'), fullPage: true });
  await deliveriesPage.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  await deliveriesPage.getByTestId('deliveries-filter-failed').click();
  await expect(deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: failedRecord.orderReference! }).first()).toContainText('Pago fallido', {
    timeout: 15000,
  });
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '08-deliveries-online-failed.png'), fullPage: true });

  const mismatchOrderTicketId = await createSofiaOrderFromApi(page, apiAccessToken, 'Mismatch');
  const mismatchPaymentUrl = await generatePaymentLink(page, apiAccessToken, mismatchOrderTicketId);
  const mismatchOnline = await startOnlinePayment(browser, mismatchPaymentUrl);
  const mismatchRecord = await getSofiaPaymentRecord(mismatchOrderTicketId);
  const mismatchWebhook = await simulateMockWebhook(page, apiAccessToken, {
    orderReference: mismatchRecord.orderReference!,
    status: 'PAID',
    amount: Number(mismatchRecord.total) + 1000,
    eventId: `e2e-online-mismatch-${runId}`,
  });
  expect(mismatchWebhook.paymentStatus).toBe('MANUAL_REVIEW');
  await deliveriesPage.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  await deliveriesPage.getByTestId('deliveries-filter-manual-review').click();
  await expect(deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: mismatchRecord.orderReference! }).first()).toContainText('Revisión manual', {
    timeout: 15000,
  });
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '09-manual-review-amount-mismatch.png'), fullPage: true });

  const duplicateWebhook = await simulateMockWebhook(page, apiAccessToken, {
    orderReference: paidRecord.orderReference!,
    status: 'PAID',
    amount: Number(paidRecord.total),
    eventId: `e2e-online-paid-${runId}`,
  });
  expect(duplicateWebhook.processedStatus).toBe('DUPLICATE_IGNORED');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '10-idempotent-webhook-duplicate.png'), fullPage: true });

  const posPage = await operatorContext.newPage();
  await posPage.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(posPage.getByTestId('pos-sofia-order-origin').filter({ hasText: paidRecord.orderReference! }).first()).toContainText('Pagado', {
    timeout: 15000,
  });
  await posPage.screenshot({ path: path.join(screenshotsDir, '11-pos-sofia-online-paid.png'), fullPage: true });

  const publicCannotMarkPaid = await paidOnline.publicPage.request.patch(`/api/orders/${paidOrderTicketId}/sofia-payment-status`, {
    data: { status: 'PAID' },
  });
  expect([401, 403]).toContain(publicCannotMarkPaid.status());

  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '12-final-summary.png'), fullPage: true });

  await paidOnline.publicContext.close();
  await failedOnline.publicContext.close();
  await mismatchOnline.publicContext.close();
  await operatorContext.close();
});
