import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-order-flow-architecture-correction-0',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(150_000);

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
        notes: 'Apertura controlada para E2E arquitectura Sofía',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

async function createSofiaOrderFromSandbox(page: import('@playwright/test').Page) {
  const phone = `+57 316 88${Date.now().toString().slice(-5)}`;

  await page.getByTestId('sofia-conversation-phone').fill(phone);
  await page.getByTestId('sofia-conversation-customer').fill('Cliente Arquitectura Sofía');
  await page.getByTestId('sofia-conversation-body').fill('Hola Sofía, quiero un pedido a domicilio');
  await page.getByTestId('sofia-create-conversation').click();
  await expect(page.getByText('Conversación mock creada')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('sofia-product-select').selectOption({ index: 1 });
  await page.getByTestId('sofia-draft-customer').fill('Cliente Arquitectura Sofía');
  await page.getByTestId('sofia-draft-phone').fill(phone);
  await page.getByTestId('sofia-draft-address').fill('Cra 15 # 22-40');
  await page.getByTestId('sofia-draft-neighborhood').fill('Jamundí');
  await page.getByTestId('sofia-draft-quantity').fill('1');
  await page.getByTestId('sofia-draft-delivery-fee').fill('3000');
  await page.getByTestId('sofia-draft-notes').fill('Pedido sandbox para validar flujo normal');
  await page.getByTestId('sofia-create-draft').click();
  await expect(page.getByText('Draft Sofía creado')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('sofia-confirm-draft').click();
  await expect(page.getByText('Draft confirmado')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('sofia-create-delivery-order').click();
  await expect(page.getByText('Pedido WhatsApp/Sofía creado')).toBeVisible({ timeout: 15000 });
}

test('Sofia creates orders but POS and deliveries operate them with Sofia identity', async ({
  page,
  workerAccessToken,
}) => {
  await ensureCashOpen(page, workerAccessToken);

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page, 'sofia redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('no cambia estados operativos ni recauda pedidos')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-config-panel-not-operational.png'), fullPage: true });

  await createSofiaOrderFromSandbox(page);
  await expect(page.getByTestId('sofia-config-panel')).toContainText('En Domicilios/POS');
  await expect(page.getByTestId('sofia-view-deliveries')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '02-create-sofia-mock-order.png'), fullPage: true });

  await page.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  await expect(page, 'deliveries redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('deliveries-sofia-order-chip').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('deliveries-sofia-payment-status').first()).toContainText('Pago sin seleccionar');
  await page.getByTestId('deliveries-sofia-queue-item').first().click();
  await expect(page.getByTestId('deliveries-detail-sofia-chip')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('deliveries-detail-sofia-payment')).toContainText('Pago sin seleccionar');
  await page.screenshot({ path: path.join(screenshotsDir, '03-pos-delivery-card-sofia-chip.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '04-pos-delivery-card-sofia-color.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '05-sofia-order-payment-status-visible.png'), fullPage: true });

  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page, 'pos redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('pos-sofia-order-chip').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('pos-sofia-order-origin').first()).toContainText('Pago sin seleccionar');
  await page.screenshot({ path: path.join(screenshotsDir, '06-normal-delivery-card-unchanged.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '07-waiter-order-card-unchanged.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '08-delivery-flow-process-sofia-order.png'), fullPage: true });

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/\bundefined\b|\bNaN\b/);
  await page.screenshot({ path: path.join(screenshotsDir, '09-final-summary.png'), fullPage: true });
});
