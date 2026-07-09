import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();
const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-pos-delivery-operations-phase-4',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });
test.setTimeout(240_000);

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
        notes: 'Apertura controlada para E2E operaciones Sofía',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

async function configureManualPayments(page: import('@playwright/test').Page, accessToken: string) {
  const response = await page.request.patch('/api/admin/sofia/payment-settings', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      cashEnabled: true,
      nequiManualEnabled: true,
      nequiManualPhone: '3001234567',
      nequiManualHolderName: '2X1 Burger Co',
      paymentInstructionsText: 'Envía el comprobante por WhatsApp para validación manual.',
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function createSofiaOrderFromApi(page: import('@playwright/test').Page, accessToken: string, suffix: string) {
  const phone = `+57 319 44${Date.now().toString().slice(-5)}`;
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
      customerName: `Cliente Operaciones ${suffix}`,
      body: 'Hola Sofía, quiero un pedido a domicilio',
    },
  });
  expect(conversation.status()).toBe(201);
  const conversationBody = await conversation.json();

  const draft = await page.request.post('/api/admin/sofia/order-drafts', {
    headers,
    data: {
      conversationId: conversationBody.id,
      customerName: `Cliente Operaciones ${suffix}`,
      customerPhone: phone,
      deliveryAddress: `Carrera ${suffix} # 7-21`,
      deliveryNeighborhood: 'Jamundí',
      deliveryNotes: `Pedido ${suffix} para operaciones Sofía`,
      deliveryFee: 3000,
      items: [{ productId: product!.id, quantity: 1 }],
    },
  });
  expect(draft.status()).toBe(201);
  const draftBody = await draft.json();

  const confirmed = await page.request.post(`/api/admin/sofia/order-drafts/${draftBody.id}/confirm`, { headers });
  expect(confirmed.status()).toBe(201);

  const deliveryOrder = await page.request.post(`/api/admin/sofia/delivery-orders/from-draft/${draftBody.id}`, {
    headers,
    data: { createOperationalTicket: true },
  });
  expect(deliveryOrder.status()).toBe(201);
  const deliveryOrderBody = await deliveryOrder.json();
  expect(deliveryOrderBody.orderTicketId).toBeTruthy();
  return deliveryOrderBody.orderTicketId as string;
}

async function createManualDeliveryOrder(page: import('@playwright/test').Page, accessToken: string) {
  const product = await prisma.product.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  expect(product?.id).toBeTruthy();
  const response = await page.request.post('/api/orders', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      type: 'DELIVERY',
      customerName: 'Cliente Domicilio Manual',
      customerPhone: '3007654321',
      deliveryReference: 'Domicilio manual E2E fase 4',
      deliveryFee: 3000,
      items: [{ productId: product!.id, quantity: 1 }],
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function generatePaymentLink(page: import('@playwright/test').Page, accessToken: string, orderTicketId: string) {
  const response = await page.request.post(`/api/orders/${orderTicketId}/sofia-payment-link`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {},
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  const paymentUrl = String(body.publicPaymentUrl);
  const token = paymentUrl.split('/pagos/')[1];
  expect(token).toBeTruthy();
  return paymentUrl;
}

async function createFreshOperatorContext(browser: import('@playwright/test').Browser) {
  const password = 'E2eSofiaOperations12345*';
  const email = `e2e-sofia-operations-${Date.now()}@2x1burgerco.local`;
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });

  await prisma.user.create({
    data: {
      email,
      fullName: 'E2E Operador Sofía Operaciones',
      passwordHash: await hash(password, 12),
      isActive: true,
      roles: {
        create: [{ roleId: adminRole.id }],
      },
    },
  });

  const context = await browser.newContext();
  const retryDelays = [0, 15_000, 30_000, 45_000, 60_000];
  let lastStatus = 0;
  for (const delay of retryDelays) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const response = await context.request.post('/api/auth/login', {
      data: { email, password },
    });
    lastStatus = response.status();
    if (lastStatus === 201) {
      return context;
    }
    if (lastStatus !== 429 && lastStatus !== 503) {
      break;
    }
  }

  await context.close();
  throw new Error(`No se pudo autenticar operador operaciones Sofía. Estado: ${lastStatus}`);
}

test('Sofia orders are filtered, prioritized and manually validated from deliveries/POS', async ({
  page,
  browser,
  workerAccessToken,
}) => {
  await ensureCashOpen(page, workerAccessToken);
  await configureManualPayments(page, workerAccessToken);

  const cashOrderTicketId = await createSofiaOrderFromApi(page, workerAccessToken, 'Efectivo');
  const nequiOrderTicketId = await createSofiaOrderFromApi(page, workerAccessToken, 'Nequi');
  await createManualDeliveryOrder(page, workerAccessToken);

  const cashPaymentUrl = await generatePaymentLink(page, workerAccessToken, cashOrderTicketId);
  const nequiPaymentUrl = await generatePaymentLink(page, workerAccessToken, nequiOrderTicketId);

  const publicContext = await browser.newContext();
  const publicCashPage = await publicContext.newPage();
  await publicCashPage.goto(cashPaymentUrl, { waitUntil: 'domcontentloaded' });
  await publicCashPage.getByTestId('public-payment-method-cash').click();
  await publicCashPage.getByTestId('public-confirm-cash').click();
  await expect(publicCashPage.getByTestId('public-payment-status')).toContainText('efectivo contra entrega', { timeout: 15000 });
  const cashReference = (await publicCashPage.getByTestId('public-payment-reference').innerText()).trim();

  const publicNequiPage = await publicContext.newPage();
  await publicNequiPage.goto(nequiPaymentUrl, { waitUntil: 'domcontentloaded' });
  await publicNequiPage.getByTestId('public-payment-method-nequi_manual').click();
  await publicNequiPage.getByTestId('public-confirm-nequi').click();
  await expect(publicNequiPage.getByTestId('public-payment-status')).toContainText('pendiente de verificación', { timeout: 15000 });
  const nequiReference = (await publicNequiPage.getByTestId('public-payment-reference').innerText()).trim();

  const operatorContext = await createFreshOperatorContext(browser);
  const deliveriesPage = await operatorContext.newPage();
  await deliveriesPage.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  await expect(deliveriesPage.getByTestId('deliveries-status-filter')).toBeVisible({ timeout: 15000 });
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '01-deliveries-before-filters.png'), fullPage: true });

  await deliveriesPage.getByTestId('deliveries-filter-sofia').click();
  await expect(deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: cashReference }).first()).toBeVisible({ timeout: 15000 });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: nequiReference }).first()).toBeVisible();
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '02-deliveries-filter-sofia.png'), fullPage: true });

  await deliveriesPage.getByTestId('deliveries-filter-nequi-pending').click();
  const nequiQueueItem = deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: nequiReference }).first();
  await expect(nequiQueueItem).toContainText('Nequi por verificar', { timeout: 15000 });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: cashReference })).toHaveCount(0);
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '03-deliveries-filter-nequi-pending.png'), fullPage: true });

  await deliveriesPage.getByTestId('deliveries-filter-cash').click();
  const cashQueueItem = deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: cashReference }).first();
  await expect(cashQueueItem).toContainText('Efectivo contra entrega', { timeout: 15000 });
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '04-deliveries-filter-cash.png'), fullPage: true });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-ops-summary')).toBeVisible();
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '05-sofia-card-payment-statuses.png'), fullPage: true });

  await deliveriesPage.getByTestId('deliveries-filter-nequi-pending').click();
  await nequiQueueItem.click();
  await expect(deliveriesPage.getByTestId('deliveries-sofia-manual-payment-actions')).toBeVisible({ timeout: 15000 });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-copy-reference')).toBeVisible();
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '06-sofia-card-actions.png'), fullPage: true });

  await expect(deliveriesPage.getByTestId('deliveries-sofia-mark-paid')).toBeVisible();
  deliveriesPage.once('dialog', (dialog) => dialog.accept());
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '07-operator-mark-paid.png'), fullPage: true });
  await deliveriesPage.getByTestId('deliveries-sofia-mark-paid').click();
  await expect(deliveriesPage.getByTestId('deliveries-detail-sofia-payment')).toContainText('Pagado', { timeout: 15000 });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-payment-events')).toContainText('Pagado');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '08-payment-events-history.png'), fullPage: true });

  const posPage = await operatorContext.newPage();
  await posPage.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(posPage.getByTestId('pos-sofia-order-origin').filter({ hasText: nequiReference }).first()).toContainText('Pagado', {
    timeout: 15000,
  });
  await posPage.screenshot({ path: path.join(screenshotsDir, '09-pos-sofia-card.png'), fullPage: true });
  await posPage.close();

  await deliveriesPage.setViewportSize({ width: 390, height: 844 });
  await deliveriesPage.getByTestId('deliveries-filter-sofia').click();
  await expect(deliveriesPage.getByTestId('deliveries-sofia-queue-item').first()).toBeVisible({ timeout: 15000 });
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '10-mobile-sofia-card-actions.png'), fullPage: true });

  await deliveriesPage.setViewportSize({ width: 1280, height: 900 });
  await deliveriesPage.getByTestId('deliveries-filter-manual').click();
  await expect(deliveriesPage.getByTestId('deliveries-queue-item').filter({ hasText: 'Domicilio manual E2E fase 4' }).first()).toBeVisible({ timeout: 15000 });
  await expect(deliveriesPage.getByTestId('deliveries-queue-item').filter({ hasText: 'Domicilio manual E2E fase 4' }).first()).not.toContainText('Sofía');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '11-normal-order-unchanged.png'), fullPage: true });

  const publicCannotMarkPaid = await publicNequiPage.request.patch(`/api/orders/${nequiOrderTicketId}/sofia-payment-status`, {
    data: { status: 'PAID' },
  });
  expect([401, 403]).toContain(publicCannotMarkPaid.status());

  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '12-final-summary.png'), fullPage: true });
  await publicCashPage.close();
  await publicNequiPage.close();
  await publicContext.close();
  await operatorContext.close();
});
