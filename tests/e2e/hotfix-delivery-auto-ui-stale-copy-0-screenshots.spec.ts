import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/hotfix-delivery-auto-ui-stale-copy-0',
);

test.beforeAll(() => {
  mkdirSync(screenshotRoot, { recursive: true });
});

test.describe.configure({ retries: 0 });
test.setTimeout(90_000);

async function ensureLoggedIn(page: import('@playwright/test').Page) {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await Promise.race([
    page.getByTestId('settings-delivery-reset-panel').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
  ]);

  if (await page.getByTestId('settings-delivery-reset-panel').isVisible().catch(() => false)) {
    return;
  }

  if (await page.getByTestId('login-email').isVisible().catch(() => false)) {
    await page.getByTestId('login-email').fill('admin@2x1burger.co');
    await page.getByTestId('login-password').fill('DevAdmin12345*');
    await Promise.all([
      page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
      page.getByTestId('login-submit').click(),
    ]);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('settings-delivery-reset-panel')).toBeVisible({ timeout: 15000 });
  }
}

test('HOTFIX delivery automatic copy screenshots', async ({ page }) => {
  await ensureLoggedIn(page);

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-delivery-reset-panel')).toContainText('Cálculo automático activo');
  await expect(page.getByTestId('settings-delivery-reset-panel')).not.toContainText('manualmente');
  await page.screenshot({
    path: path.join(screenshotRoot, '01-settings-delivery-automatic-config.png'),
    fullPage: true,
  });

  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pos-page')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('pos-product-hamb-2x1').click();
  await page.getByTestId('pos-delivery-mode').selectOption('DELIVERY');
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('PENDIENTE');
  await page.screenshot({
    path: path.join(screenshotRoot, '02-pos-delivery-pending-clean-copy.png'),
    fullPage: true,
  });

  await page.getByTestId('pos-delivery-customer-name').fill('Hotfix Local');
  await page.getByTestId('pos-delivery-phone').fill('3005550101');
  await page.getByTestId('pos-delivery-reference').fill('Condados de la Alborada');
  await page.getByTestId('pos-delivery-neighborhood').fill('Condados de la Alborada');
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('GRATIS', { timeout: 15000 });
  await page.screenshot({
    path: path.join(screenshotRoot, '03-pos-delivery-local-free-clean-copy.png'),
    fullPage: true,
  });

  await page.getByTestId('pos-delivery-reference').fill('cerca de alborada');
  await expect(page.getByTestId('pos-delivery-pricing-status')).toContainText('NEEDS_ADDRESS_CORRECTION', { timeout: 15000 });
  await expect(page.getByTestId('pos-delivery-can-checkout')).toContainText('Checkout bloqueado');
  await page.screenshot({
    path: path.join(screenshotRoot, '04-pos-delivery-address-correction-clean-copy.png'),
    fullPage: true,
  });

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-delivery-reset-panel')).toContainText('Automático');
  await page.screenshot({
    path: path.join(screenshotRoot, '05-final-grep-summary.png'),
    fullPage: true,
  });
});
