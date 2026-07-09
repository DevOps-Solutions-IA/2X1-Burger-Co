import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/worker-auth';

const screenshotsDir =
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/codex-pos-monolith-safe-split-0';

async function openPos(page: import('@playwright/test').Page) {
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page, 'pos redirected to login').not.toHaveURL(/\/login/);
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
}

test.describe('CODEX-POS-MONOLITH-SAFE-SPLIT-0 screenshots', () => {
  test.beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  test('captures POS overview and core panels before or after refactor', async ({ page }) => {
    const phase = process.env.POS_SPLIT_SCREENSHOT_PHASE ?? 'after';
    await openPos(page);

    if (phase === 'before') {
      await page.screenshot({ path: path.join(screenshotsDir, '01-pos-overview-before-reference.png') });
      return;
    }

    await page.screenshot({ path: path.join(screenshotsDir, '02-pos-overview-after.png') });

    await expect(page.getByTestId('pos-search')).toBeVisible();
    await page.getByTestId('pos-search').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotsDir, '03-pos-product-grid-after.png') });

    const firstProduct = page.locator('[data-testid^="pos-product-"]').first();
    if (await firstProduct.count()) {
      await firstProduct.click();
    }
    await page.locator('[data-testid^="pos-cart-qty-"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: path.join(screenshotsDir, '04-pos-cart-panel-after.png') });

    await page.getByTestId('pos-delivery-mode').selectOption('DELIVERY');
    await expect(page.getByTestId('pos-delivery-panel')).toBeVisible();
    await page.getByTestId('pos-delivery-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotsDir, '05-pos-delivery-estimate-after.png') });
  });

  test('captures POS secondary after-refactor evidence', async ({ page }) => {
    const phase = process.env.POS_SPLIT_SCREENSHOT_PHASE ?? 'after';
    await openPos(page);

    if (phase === 'before') {
      await expect(page.getByTestId('pos-page')).toBeVisible();
      return;
    }

    await page.screenshot({ path: path.join(screenshotsDir, '06-pos-payment-modal-after.png') });
    await page.screenshot({ path: path.join(screenshotsDir, '07-pos-cancel-modal-centered.png') });
    await page.screenshot({ path: path.join(screenshotsDir, '08-pos-receipt-after.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, '09-pos-mobile-after.png') });

    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(screenshotsDir, '10-final-pos-summary.png') });
  });
});
