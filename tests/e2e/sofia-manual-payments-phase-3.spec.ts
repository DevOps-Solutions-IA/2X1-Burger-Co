import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { expect, test } from './fixtures/worker-auth';

const prisma = new PrismaClient();
const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-manual-payments-phase-3',
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
        notes: 'Apertura controlada para E2E pagos manuales Sofía',
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
      paymentInstructionsText: 'Envía el comprobante por WhatsApp antes de preparar cambios de método.',
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function createSofiaOrderFromApi(page: import('@playwright/test').Page, accessToken: string, suffix: string) {
  const phone = `+57 318 55${Date.now().toString().slice(-5)}`;
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
      customerName: `Cliente Manual ${suffix}`,
      body: 'Hola Sofía, quiero validar pago manual',
    },
  });
  expect(conversation.status()).toBe(201);
  const conversationBody = await conversation.json();

  const draft = await page.request.post('/api/admin/sofia/order-drafts', {
    headers,
    data: {
      conversationId: conversationBody.id,
      customerName: `Cliente Manual ${suffix}`,
      customerPhone: phone,
      deliveryAddress: `Calle ${suffix} # 12-34`,
      deliveryNeighborhood: 'Jamundí',
      deliveryNotes: `Pedido ${suffix} para pagos manuales`,
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
  const password = 'E2eSofiaManual12345*';
  const email = `e2e-sofia-manual-${Date.now()}@2x1burgerco.local`;
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });

  await prisma.user.create({
    data: {
      email,
      fullName: 'E2E Operador Pago Manual Sofía',
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
  throw new Error(`No se pudo autenticar operador manual Sofía. Estado: ${lastStatus}`);
}

test('Sofia manual cash and Nequi payments remain operator-controlled', async ({
  page,
  browser,
  workerAccessToken,
}) => {
  await ensureCashOpen(page, workerAccessToken);
  await configureManualPayments(page, workerAccessToken);

  const cashOrderTicketId = await createSofiaOrderFromApi(page, workerAccessToken, 'Efectivo');
  const cashPaymentUrl = await generatePaymentLink(page, workerAccessToken, cashOrderTicketId);
  const publicCashContext = await browser.newContext();
  const publicCashPage = await publicCashContext.newPage();
  await publicCashPage.goto(cashPaymentUrl, { waitUntil: 'domcontentloaded' });
  await expect(publicCashPage.getByTestId('public-payment-methods')).toBeVisible({ timeout: 15000 });
  await publicCashPage.screenshot({ path: path.join(screenshotsDir, '01-payment-page-methods-before.png'), fullPage: true });
  await publicCashPage.getByTestId('public-payment-method-cash').click();
  await expect(publicCashPage.getByTestId('public-cash-instructions')).toContainText('Ten listo');
  await publicCashPage.screenshot({ path: path.join(screenshotsDir, '02-cash-method-selected.png'), fullPage: true });
  await publicCashPage.getByTestId('public-confirm-cash').click();
  await expect(publicCashPage.getByTestId('public-payment-status')).toContainText('Pago en efectivo contra entrega confirmado.', {
    timeout: 15000,
  });
  await expect(publicCashPage.getByTestId('public-payment-status')).not.toContainText('PAID');
  await publicCashPage.screenshot({ path: path.join(screenshotsDir, '03-cash-confirmed-public.png'), fullPage: true });
  const cashReference = (await publicCashPage.getByTestId('public-payment-reference').innerText()).trim();
  await publicCashPage.close();
  await publicCashContext.close();

  const operatorContext = await createFreshOperatorContext(browser);
  const deliveriesPage = await operatorContext.newPage();
  await deliveriesPage.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  const cashQueueItem = deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: cashReference }).first();
  await expect(cashQueueItem).toContainText('Efectivo contra entrega', { timeout: 15000 });
  await cashQueueItem.click();
  await expect(deliveriesPage.getByTestId('deliveries-detail-sofia-payment')).toContainText('Efectivo contra entrega');
  await expect(deliveriesPage.getByTestId('deliveries-detail-sofia-payment')).not.toContainText('PAID');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '04-delivery-card-cash-on-delivery.png'), fullPage: true });

  const nequiOrderTicketId = await createSofiaOrderFromApi(page, workerAccessToken, 'Nequi');
  const nequiPaymentUrl = await generatePaymentLink(page, workerAccessToken, nequiOrderTicketId);
  const publicNequiContext = await browser.newContext();
  const publicNequiPage = await publicNequiContext.newPage();
  await publicNequiPage.goto(nequiPaymentUrl, { waitUntil: 'domcontentloaded' });
  await publicNequiPage.getByTestId('public-payment-method-nequi_manual').click();
  await expect(publicNequiPage.getByTestId('public-nequi-instructions')).toBeVisible({ timeout: 15000 });
  await publicNequiPage.screenshot({ path: path.join(screenshotsDir, '05-nequi-method-selected.png'), fullPage: true });
  await expect(publicNequiPage.getByTestId('public-nequi-phone')).toContainText('3001234567');
  await expect(publicNequiPage.getByTestId('public-nequi-reference')).toContainText(/^ORD-\d{5}$/);
  await publicNequiPage.screenshot({ path: path.join(screenshotsDir, '06-nequi-instructions.png'), fullPage: true });
  await publicNequiPage.getByTestId('public-confirm-nequi').click();
  await expect(publicNequiPage.getByTestId('public-payment-status')).toContainText('Transferencia pendiente de verificación', {
    timeout: 15000,
  });
  await expect(publicNequiPage.getByTestId('public-payment-status')).not.toContainText('PAID');
  await publicNequiPage.screenshot({ path: path.join(screenshotsDir, '07-nequi-pending-verification-public.png'), fullPage: true });
  const nequiReference = (await publicNequiPage.getByTestId('public-payment-reference').innerText()).trim();

  await deliveriesPage.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  const nequiQueueItem = deliveriesPage.getByTestId('deliveries-sofia-queue-item').filter({ hasText: nequiReference }).first();
  await expect(nequiQueueItem).toContainText('Nequi por verificar', { timeout: 15000 });
  await nequiQueueItem.click();
  await expect(deliveriesPage.getByTestId('deliveries-detail-sofia-payment')).toContainText('Nequi por verificar');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '08-delivery-card-nequi-pending.png'), fullPage: true });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-mark-paid')).toBeVisible();
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '09-operator-mark-paid-action.png'), fullPage: true });
  deliveriesPage.once('dialog', (dialog) => dialog.accept());
  await deliveriesPage.getByTestId('deliveries-sofia-mark-paid').click();
  await expect(deliveriesPage.getByTestId('deliveries-detail-sofia-payment')).toContainText('Pagado', { timeout: 15000 });
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '10-delivery-card-paid.png'), fullPage: true });
  await expect(deliveriesPage.getByTestId('deliveries-sofia-payment-events')).toContainText('Pagado');
  await deliveriesPage.screenshot({ path: path.join(screenshotsDir, '11-payment-events-history.png'), fullPage: true });

  const unauthorized = await publicNequiPage.request.patch('/api/orders/invalid/sofia-payment-status', {
    data: { status: 'PAID' },
  });
  expect([401, 403, 404]).toContain(unauthorized.status());
  const publicCannotMarkPaid = await publicNequiPage.request.post(`/api/public/sofia/payments/${nequiPaymentUrl.split('/pagos/')[1]}/select-method`, {
    data: { method: 'PAID' },
  });
  expect(publicCannotMarkPaid.status()).toBe(400);

  const posPage = await operatorContext.newPage();
  await posPage.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(posPage.getByTestId('pos-sofia-order-origin').filter({ hasText: nequiReference }).first()).toContainText('Pagado', {
    timeout: 15000,
  });
  await posPage.screenshot({ path: path.join(screenshotsDir, '12-final-summary.png'), fullPage: true });

  await publicNequiPage.close();
  await publicNequiContext.close();
  await operatorContext.close();
});
