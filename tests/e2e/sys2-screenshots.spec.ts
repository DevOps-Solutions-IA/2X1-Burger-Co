import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/sys2-global-stability-remediation',
);

async function ensureAuthenticated(page: import('@playwright/test').Page) {
  await Promise.race([
    page.locator('main').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
  ]);

  if (!(await page.getByTestId('login-email').isVisible().catch(() => false))) {
    return;
  }

  await page.getByTestId('login-email').fill('admin@2x1burger.co');
  await page.getByTestId('login-password').fill('DevAdmin12345*');
  await Promise.all([
    page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
    page.getByTestId('login-submit').click(),
  ]);
}

async function gotoProtected(page: import('@playwright/test').Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page);
  if (!page.url().endsWith(route)) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await ensureAuthenticated(page);
  }
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main, [data-testid="cash-page"], [data-testid="pos-page"]').first()).toBeVisible({
    timeout: 15000,
  });
}

test.describe('SYS-2: screenshot evidence', () => {
  test.setTimeout(120000);

  test.beforeAll(() => {
    mkdirSync(screenshotRoot, { recursive: true });
  });

  test('captures global stability evidence screens', async ({ page }) => {
    await gotoProtected(page, '/dashboard');
    await page.screenshot({ path: path.join(screenshotRoot, '01-dashboard-stable.png'), fullPage: true });

    await gotoProtected(page, '/pos');
    await page.screenshot({ path: path.join(screenshotRoot, '02-pos-stable.png'), fullPage: true });
    await page.screenshot({ path: path.join(screenshotRoot, '06-delivery-regression-pass.png'), fullPage: true });

    await gotoProtected(page, '/cash');
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await page.screenshot({ path: path.join(screenshotRoot, '03-cash-stable-no-banner.png'), fullPage: true });

    await page.route('**/api/reports/operational', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-2 screenshot daily summary unavailable' }),
      });
    });
    await gotoProtected(page, '/cash');
    await expect(page.getByTestId('cash-daily-summary-error')).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: path.join(screenshotRoot, '04-cash-daily-summary-degraded-local-error.png'),
      fullPage: true,
    });
    await page.unroute('**/api/reports/operational');

    await page.route('**/api/sales**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'sys2-screenshot-whatsapp',
            number: 'SYS2-WA-SHOT',
            status: 'PAID',
            soldAt: new Date().toISOString(),
            channel: 'MOSTRADOR',
            tableLabel: null,
            deliveryReference: null,
            customerName: 'Cliente WhatsApp Screenshot',
            customerPhone: '3001234567',
            notes: null,
            total: 12000,
            subtotal: 12000,
            items: [
              {
                quantity: 1,
                unitPrice: 12000,
                totalPrice: 12000,
                product: { name: 'Producto Screenshot' },
              },
            ],
            conversion: null,
          },
        ]),
      });
    });
    await page.route('**/api/whatsapp/session', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-2 screenshot WhatsApp unavailable' }),
      });
    });
    await gotoProtected(page, '/cash');
    await page.getByRole('button', { name: 'Enviar o reenviar por WhatsApp' }).click();
    await expect(page.getByTestId('cash-whatsapp-card')).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: path.join(screenshotRoot, '05-cash-whatsapp-degraded-local-warning.png'),
      fullPage: true,
    });

    await gotoProtected(page, '/settings');
    await page.screenshot({ path: path.join(screenshotRoot, '07-settings-stable.png'), fullPage: true });

    await gotoProtected(page, '/tables');
    await page.screenshot({ path: path.join(screenshotRoot, '08-tables-stable.png'), fullPage: true });

    await gotoProtected(page, '/deliveries');
    await page.screenshot({ path: path.join(screenshotRoot, '09-deliveries-stable.png'), fullPage: true });

    await gotoProtected(page, '/dashboard');
    await page.screenshot({ path: path.join(screenshotRoot, '10-final-regression-summary.png'), fullPage: true });
  });
});
