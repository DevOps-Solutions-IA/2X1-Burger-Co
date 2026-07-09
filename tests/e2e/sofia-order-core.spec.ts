import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-whatsapp-order-core-phase-1',
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
        notes: 'Apertura controlada para E2E Sofía order core',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

test('admin creates Sofia mock conversation, draft and internal WhatsApp delivery order', async ({
  page,
  workerAccessToken,
}) => {
  await ensureCashOpen(page, workerAccessToken);

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page, 'sofia redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '01-admin-sofia-conversations.png'), fullPage: true });

  const phone = `+57 316 77${Date.now().toString().slice(-5)}`;
  await page.getByTestId('sofia-conversation-phone').fill(phone);
  await page.getByTestId('sofia-conversation-customer').fill('Cliente Sofía E2E');
  await page.getByTestId('sofia-conversation-body').fill('Hola Sofía, quiero una bebida a domicilio');
  await page.getByTestId('sofia-create-conversation').click();
  await expect(page.getByText('Conversación mock creada')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, '02-create-mock-conversation.png'), fullPage: true });

  await page.getByTestId('sofia-product-select').selectOption({ index: 1 });
  await page.getByTestId('sofia-draft-customer').fill('Cliente Sofía E2E');
  await page.getByTestId('sofia-draft-phone').fill(phone);
  await page.getByTestId('sofia-draft-address').fill('Cra 10 # 20-30');
  await page.getByTestId('sofia-draft-neighborhood').fill('Jamundí');
  await page.getByTestId('sofia-draft-quantity').fill('1');
  await page.getByTestId('sofia-draft-delivery-fee').fill('3000');
  await page.getByTestId('sofia-draft-notes').fill('Casa blanca, pedido creado por mock admin');
  await page.getByTestId('sofia-create-draft').click();
  await expect(page.getByText('Draft Sofía creado')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('sofia-draft-detail')).toContainText('READY_TO_CONFIRM');
  await page.screenshot({ path: path.join(screenshotsDir, '03-create-sofia-draft.png'), fullPage: true });

  await page.getByTestId('sofia-confirm-draft').click();
  await expect(page.getByText('Draft confirmado')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('sofia-draft-detail')).toContainText('CONFIRMED');
  await page.screenshot({ path: path.join(screenshotsDir, '04-confirm-draft.png'), fullPage: true });

  await page.getByTestId('sofia-create-delivery-order').click();
  await expect(page.getByText('Pedido WhatsApp/Sofía creado')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('sofia-config-panel')).toContainText('En Domicilios/POS');
  await expect(page.getByTestId('sofia-view-deliveries')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '05-create-whatsapp-delivery-order.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '06-order-detail-source-sofia.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '07-payment-status-unselected.png'), fullPage: true });

  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page, 'pos redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('pos-sofia-order-chip').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('pos-sofia-order-origin').first()).toContainText('UNSELECTED');
  await page.screenshot({ path: path.join(screenshotsDir, '08-delivery-pos-unchanged.png'), fullPage: true });

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('body')).not.toContainText(/\bundefined\b|\bNaN\b/);
  await page.screenshot({ path: path.join(screenshotsDir, '09-final-summary.png'), fullPage: true });
});
