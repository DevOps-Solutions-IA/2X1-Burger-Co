import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();
const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-payment-link-page-phase-2',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ retries: 0 });
test.setTimeout(210_000);

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
        notes: 'Apertura controlada para E2E link público Sofía',
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
      paymentInstructionsText: 'Envía el comprobante por WhatsApp.',
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function createSofiaOrderFromSandbox(page: import('@playwright/test').Page, accessToken: string) {
  const phone = `+57 318 42${Date.now().toString().slice(-5)}`;
  const customerName = `Cliente Link Sofía ${Date.now()}`;
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
      customerName,
      body: 'Hola Sofía, necesito link para pagar mi pedido',
    },
  });
  expect(conversation.status()).toBe(201);
  const conversationBody = await conversation.json();

  const draft = await page.request.post('/api/admin/sofia/order-drafts', {
    headers,
    data: {
      conversationId: conversationBody.id,
      customerName,
      customerPhone: phone,
      deliveryAddress: 'Avenida 9 # 12-34',
      deliveryNeighborhood: 'Jamundí',
      deliveryNotes: 'Pedido para validar link público de pago',
      deliveryFee: 3000,
      items: [{ productId: product!.id, quantity: 1 }],
    },
  });
  expect(draft.status()).toBe(201);
  const draftBody = await draft.json();

  const confirm = await page.request.post(`/api/admin/sofia/order-drafts/${draftBody.id}/confirm`, { headers });
  expect(confirm.status()).toBe(201);

  const deliveryOrder = await page.request.post(`/api/admin/sofia/delivery-orders/from-draft/${draftBody.id}`, {
    headers,
    data: { createOperationalTicket: true },
  });
  expect(deliveryOrder.status()).toBe(201);
  const deliveryOrderBody = await deliveryOrder.json();
  expect(deliveryOrderBody.orderTicketId).toBeTruthy();
  return customerName;
}

async function createFreshOperatorContext(browser: import('@playwright/test').Browser) {
  const password = 'E2eSofiaPaymentLink12345*';
  const email = `e2e-sofia-payment-link-${Date.now()}@2x1burgerco.local`;
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });

  await prisma.user.create({
    data: {
      email,
      fullName: 'E2E Operador Link Sofía',
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
  throw new Error(`No se pudo autenticar operador E2E para link Sofía. Estado: ${lastStatus}`);
}

test('Sofia public payment link is generated from deliveries and loads without login', async ({
  page,
  browser,
  workerAccessToken,
}) => {
  await ensureCashOpen(page, workerAccessToken);
  await configureManualPayments(page, workerAccessToken);
  await createSofiaOrderFromSandbox(page, workerAccessToken);

  await page.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('deliveries-sofia-queue-item').first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId('deliveries-sofia-queue-item').first().click();
  await expect(page.getByTestId('deliveries-detail-sofia-chip')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-order-in-deliveries-before-link.png'), fullPage: true });

  await page.getByTestId('deliveries-generate-sofia-payment-link').click();
  await expect(page.getByText('Link de pago copiado')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('deliveries-sofia-payment-url')).toBeVisible({ timeout: 15000 });
  const paymentUrl = (await page.getByTestId('deliveries-sofia-payment-url').innerText()).trim();
  const token = paymentUrl.split('/pagos/')[1];
  expect(token).toBeTruthy();
  await page.screenshot({ path: path.join(screenshotsDir, '02-sofia-order-generate-payment-link.png'), fullPage: true });
  await page.getByTestId('deliveries-copy-sofia-payment-link').click();
  await page.screenshot({ path: path.join(screenshotsDir, '03-sofia-order-copy-payment-link.png'), fullPage: true });

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(paymentUrl, { waitUntil: 'domcontentloaded' });
  await expect(publicPage.getByTestId('public-payment-page')).toBeVisible({ timeout: 15000 });
  await expect(publicPage.getByTestId('public-payment-reference')).toContainText(/^ORD-\d{5}$/);
  const orderReference = (await publicPage.getByTestId('public-payment-reference').innerText()).trim();
  await expect(publicPage.getByTestId('public-payment-customer')).toContainText(/Cliente Link Sofía/);
  await expect(publicPage.getByTestId('public-payment-customer')).toContainText('Avenida 9 # 12-34');
  await expect(publicPage.getByTestId('public-payment-order-summary')).toBeVisible();
  await expect(publicPage.getByTestId('public-payment-total')).toContainText('COP');
  await expect(publicPage.getByTestId('public-payment-method-online')).toBeVisible();
  await expect(publicPage.getByTestId('public-payment-method-nequi_manual')).toBeVisible();
  await expect(publicPage.getByTestId('public-payment-method-cash')).toBeVisible();
  await expect(publicPage.locator('body')).not.toContainText('Caja');
  await publicPage.screenshot({ path: path.join(screenshotsDir, '04-public-payment-page-loaded.png'), fullPage: true });
  await publicPage.screenshot({ path: path.join(screenshotsDir, '05-public-payment-order-summary.png'), fullPage: true });
  await publicPage.screenshot({ path: path.join(screenshotsDir, '06-public-payment-methods.png'), fullPage: true });

  await publicPage.getByTestId('public-payment-method-nequi_manual').click();
  await expect(publicPage.getByTestId('public-nequi-instructions')).toBeVisible({ timeout: 15000 });
  await expect(publicPage.getByTestId('public-nequi-phone')).toContainText('3001234567');
  await publicPage.getByTestId('public-confirm-nequi').click();
  await expect(publicPage.getByTestId('public-payment-status')).toContainText('Transferencia pendiente de verificación', {
    timeout: 15000,
  });
  await expect(publicPage.getByTestId('public-payment-status')).not.toContainText('PAID');
  await publicPage.screenshot({ path: path.join(screenshotsDir, '07-public-method-selected.png'), fullPage: true });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.screenshot({ path: path.join(screenshotsDir, '11-public-mobile-view.png'), fullPage: true });

  const operatorContext = await createFreshOperatorContext(browser);
  const deliveriesPage = await operatorContext.newPage();
  await deliveriesPage.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  const reflectedQueueItem = deliveriesPage
    .getByTestId('deliveries-sofia-queue-item')
    .filter({ hasText: orderReference })
    .first();
  await expect(reflectedQueueItem).toBeVisible({ timeout: 15000 });
  await expect(reflectedQueueItem.getByTestId('deliveries-sofia-payment-status')).toContainText('Nequi');
  await reflectedQueueItem.click();
  await expect(deliveriesPage.getByTestId('deliveries-detail-sofia-payment')).toContainText('Nequi por verificar');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '08-pos-delivery-payment-method-reflected.png'), fullPage: true });

  const invalidPage = await publicContext.newPage();
  await invalidPage.goto('/pagos/token-invalido-no-real', { waitUntil: 'domcontentloaded' });
  await expect(invalidPage.getByTestId('public-payment-invalid')).toBeVisible({ timeout: 15000 });
  await invalidPage.screenshot({ path: path.join(screenshotsDir, '09-public-token-invalid.png'), fullPage: true });
  await invalidPage.close();

  await prisma.whatsappDeliveryOrder.update({
    where: { publicPaymentToken: token },
    data: { publicPaymentTokenExpiresAt: new Date(Date.now() - 1000) },
  });

  const expiredPage = await publicContext.newPage();
  await expiredPage.goto(paymentUrl, { waitUntil: 'domcontentloaded' });
  await expect(expiredPage.getByTestId('public-payment-expired')).toBeVisible({ timeout: 15000 });
  await expiredPage.screenshot({ path: path.join(screenshotsDir, '10-public-token-expired.png'), fullPage: true });
  await expiredPage.close();

  await publicPage.close();
  await publicContext.close();

  const posPage = await operatorContext.newPage();
  await posPage.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(posPage.getByTestId('pos-sofia-order-origin').filter({ hasText: orderReference }).first()).toContainText('Nequi', {
    timeout: 15000,
  });
  await posPage.screenshot({ path: path.join(screenshotsDir, '12-final-summary.png'), fullPage: true });
  await operatorContext.close();
});
