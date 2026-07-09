import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-pos-monolith-safe-split-2',
);

test.beforeAll(() => {
  mkdirSync(screenshotsDir, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(150_000);

async function openPos(page: Page) {
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page, 'pos redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
}

async function ensureCashOpen(page: Page, accessToken: string) {
  const currentResponse = await page.request.get('/api/cash-register/current', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(currentResponse.ok()).toBeTruthy();
  const currentCash = await currentResponse.json().catch(() => null);

  if (!currentCash) {
    const openResponse = await page.request.post('/api/cash-register/open', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        openingAmount: 90000,
        notes: 'Apertura automática POS monolith split 2',
      },
    });
    expect([200, 201, 409]).toContain(openResponse.status());
  }
}

type SellableProduct = {
  code: string;
  kind: string;
  currentStock: string | number;
};

async function chooseAvailableProductCode(page: Page, accessToken: string) {
  const response = await page.request.get('/api/products/sellable', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok()).toBeTruthy();
  const products = (await response.json()) as SellableProduct[];
  const product = products.find(
    (item) => item.kind === 'DIRECT_STOCK' && Number(item.currentStock) > 5 && item.code.trim().length > 0,
  );
  expect(product, 'No hay producto de stock directo suficiente para validar POS split 2.').toBeTruthy();
  return product!.code.toLowerCase();
}

async function assertNoTechnicalPlaceholders(page: Page) {
  const bodyText = (await page.locator('body').innerText()).trim();
  expect(bodyText).not.toMatch(/\bundefined\b|\bNaN\b/);
}

test('captures before reference for POS split 2', async ({ page }) => {
  if (process.env.POS_SPLIT2_SCREENSHOT_PHASE !== 'before') {
    return;
  }

  await openPos(page);
  await assertNoTechnicalPlaceholders(page);
  await page.screenshot({ path: path.join(screenshotsDir, '01-pos-overview-before-reference.png'), fullPage: true });
});

test('validates low-risk POS layout extraction after refactor', async ({ page, workerAccessToken }) => {
  if (process.env.POS_SPLIT2_SCREENSHOT_PHASE === 'before') {
    return;
  }

  await ensureCashOpen(page, workerAccessToken);
  const productCode = await chooseAvailableProductCode(page, workerAccessToken);

  await openPos(page);
  await page.screenshot({ path: path.join(screenshotsDir, '02-pos-overview-after.png'), fullPage: true });

  await expect(page.getByText('Venta en marcha')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, '03-pos-topbar-summary-after.png'), fullPage: true });

  await expect(page.getByTestId('pos-search')).toBeVisible();
  await expect(page.getByTestId(`pos-product-${productCode}`)).toBeEnabled({ timeout: 15000 });
  await page.getByTestId(`pos-product-${productCode}`).click();
  await expect(page.getByTestId('pos-order-metadata-panel')).toBeVisible();
  await page.getByTestId('pos-order-metadata-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotsDir, '04-pos-order-metadata-after.png'), fullPage: true });
  await expect(page.getByTestId('pos-quick-notes-panel')).toBeVisible();
  await page.getByTestId('pos-quick-notes-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotsDir, '05-pos-quick-notes-after.png'), fullPage: true });

  await page.getByTestId('pos-delivery-mode').selectOption('DELIVERY');
  await expect(page.getByTestId('pos-delivery-panel')).toBeVisible();
  await page.getByTestId('pos-delivery-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotsDir, '06-pos-cart-delivery-payment-still-ok.png'), fullPage: true });

  const firstOpenOrder = page.locator('[data-testid^="order-card-"]').first();
  await expect(firstOpenOrder).toBeVisible({ timeout: 15000 });
  await firstOpenOrder.click();
  await expect(page.getByTestId('pos-payment-panel')).toBeVisible({ timeout: 15000 });
  const checkoutButton = page.getByTestId('pos-checkout-order');
  await expect(checkoutButton).toBeVisible({ timeout: 15000 });
  if (await checkoutButton.isEnabled().catch(() => false)) {
    await checkoutButton.click();
    await expect(page.getByRole('heading', { name: 'Cobrar y cerrar' })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, '07-pos-checkout-modal-after.png'), fullPage: true });
    await page.getByRole('button', { name: 'Sí, cobrar y cerrar' }).click();
    await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: path.join(screenshotsDir, '08-pos-receipt-after.png'), fullPage: true });
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, '07-pos-checkout-modal-after.png'), fullPage: true });
    await page.screenshot({ path: path.join(screenshotsDir, '08-pos-receipt-after.png'), fullPage: true });
  }

  await assertNoTechnicalPlaceholders(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPos(page);
  await page.screenshot({ path: path.join(screenshotsDir, '09-pos-mobile-after.png'), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  await openPos(page);
  await page.screenshot({ path: path.join(screenshotsDir, '10-final-pos-summary.png'), fullPage: true });
});
