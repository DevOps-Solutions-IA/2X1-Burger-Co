import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-sofia-config-panel-cleanup-0',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(180_000);

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
        notes: 'Apertura controlada para E2E panel Sofía limpio',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

async function screenshotSection(page: import('@playwright/test').Page, testId: string, fileName: string) {
  const section = page.getByTestId(testId);
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotsDir, fileName), fullPage: true });
}

async function createSofiaOrderFromSandbox(page: import('@playwright/test').Page) {
  const phone = `+57 317 90${Date.now().toString().slice(-5)}`;

  await page.getByTestId('sofia-technical-sandbox').scrollIntoViewIfNeeded();
  await page.getByTestId('sofia-conversation-phone').fill(phone);
  await page.getByTestId('sofia-conversation-customer').fill('Cliente Panel Sofía');
  await page.getByTestId('sofia-conversation-body').fill('Hola Sofía, quiero validar un pedido desde sandbox');
  await page.getByTestId('sofia-create-conversation').click();
  await expect(page.getByText('Conversación mock creada')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('sofia-product-select').selectOption({ index: 1 });
  await page.getByTestId('sofia-draft-customer').fill('Cliente Panel Sofía');
  await page.getByTestId('sofia-draft-phone').fill(phone);
  await page.getByTestId('sofia-draft-address').fill('Calle 22 # 8-14');
  await page.getByTestId('sofia-draft-neighborhood').fill('Jamundí');
  await page.getByTestId('sofia-draft-quantity').fill('1');
  await page.getByTestId('sofia-draft-delivery-fee').fill('3000');
  await page.getByTestId('sofia-draft-notes').fill('Pedido sandbox para validar panel limpio');
  await page.getByTestId('sofia-create-draft').click();
  await expect(page.getByText('Draft Sofía creado')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('sofia-confirm-draft').click();
  await expect(page.getByText('Draft confirmado')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('sofia-create-delivery-order').click();
  await expect(page.getByText('Pedido WhatsApp/Sofía creado')).toBeVisible({ timeout: 15000 });
}

test('Sofia panel is configuration-only and Sofia orders remain in POS and deliveries', async ({
  page,
  workerAccessToken,
}) => {
  await ensureCashOpen(page, workerAccessToken);

  await page.goto('/sofia', { waitUntil: 'domcontentloaded' });
  await expect(page, 'sofia redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('sofia-admin-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Centro de configuración, conexiones, reglas, monitoreo y aprendizaje')).toBeVisible();
  await expect(page.getByText('Los pedidos se operan en Domicilios/POS, no aquí.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Preparar|Despachar|Cobrar/i })).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshotsDir, '01-sofia-panel-before-cleanup.png'), fullPage: true });

  await screenshotSection(page, 'sofia-panel-header', '02-sofia-panel-after-header.png');
  await screenshotSection(page, 'sofia-agent-status', '03-sofia-agent-status.png');
  await screenshotSection(page, 'sofia-connections', '04-sofia-connections.png');
  await screenshotSection(page, 'sofia-operational-rules', '05-sofia-operational-rules.png');
  await screenshotSection(page, 'sofia-data-consumed', '06-sofia-data-consumed.png');
  await screenshotSection(page, 'sofia-payment-methods-config', '07-sofia-payment-methods-config.png');
  await screenshotSection(page, 'sofia-feedback-monitoring', '08-sofia-feedback-monitoring.png');
  await screenshotSection(page, 'sofia-operational-links', '09-link-to-deliveries-pos.png');

  await expect(page.getByTestId('sofia-view-deliveries')).toBeVisible();
  await expect(page.getByTestId('sofia-view-pos')).toBeVisible();
  await createSofiaOrderFromSandbox(page);

  await page.goto('/deliveries', { waitUntil: 'domcontentloaded' });
  await expect(page, 'deliveries redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('deliveries-sofia-order-chip').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('deliveries-sofia-payment-status').first()).toContainText('UNSELECTED');
  await page.screenshot({ path: path.join(screenshotsDir, '10-sofia-order-in-deliveries-chip.png'), fullPage: true });

  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page, 'pos redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('pos-sofia-order-chip').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('pos-sofia-order-origin').first()).toContainText('UNSELECTED');
  await page.screenshot({ path: path.join(screenshotsDir, '11-sofia-order-in-pos-chip.png'), fullPage: true });

  await expect(page.locator('body')).not.toContainText(/\bundefined\b|\bNaN\b/);
  await page.screenshot({ path: path.join(screenshotsDir, '12-final-summary.png'), fullPage: true });
});
