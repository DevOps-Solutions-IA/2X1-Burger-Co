import { expect, test } from '@playwright/test';

const AUTH_FILE = process.env.PLAYWRIGHT_AUTH_FILE;

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
  await expect(page, `${route} redirected to login`).not.toHaveURL(/\/login/);
}

const fakeSale = {
  id: 'sys2-sale-whatsapp',
  number: 'SYS2-001',
  status: 'PAID',
  soldAt: new Date().toISOString(),
  channel: 'DOMICILIO',
  tableLabel: null,
  deliveryReference: 'SYS-2 degradacion WhatsApp',
  customerName: 'Cliente SYS-2',
  customerPhone: '3001234567',
  notes: null,
  total: 7000,
  subtotal: 0,
  items: [
    {
      quantity: 1,
      unitPrice: 7000,
      totalPrice: 7000,
      product: { name: 'Domicilio manual SYS-2' },
    },
  ],
  conversion: null,
};

test.describe('SYS-2: cash degraded secondary errors', () => {
  test.setTimeout(90000);

  test.afterEach(async ({ context }) => {
    if (AUTH_FILE) {
      await context.storageState({ path: AUTH_FILE });
    }
  });

  test('daily summary failure degrades locally without global cash banner', async ({ page }) => {
    await page.route('**/api/reports/operational', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-2 forced daily summary failure' }),
      });
    });

    await gotoProtected(page, '/cash');
    await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await expect(page.getByTestId('cash-current-status')).toBeVisible();
    await expect(page.getByTestId('cash-daily-summary-error')).toBeVisible();
  });

  test('operational log failure degrades locally without global cash banner', async ({ page }) => {
    await page.route('**/api/cash-register/operational-log', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-2 forced operational log failure' }),
      });
    });

    await gotoProtected(page, '/cash');
    await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await expect(page.getByTestId('cash-operational-log-error')).toBeVisible();
  });

  test('whatsapp session failure is local to receipt modal and does not break cash', async ({ page }) => {
    await page.route('**/api/sales**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([fakeSale]),
      });
    });
    await page.route('**/api/whatsapp/session', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-2 forced WhatsApp unavailable' }),
      });
    });

    await gotoProtected(page, '/cash');
    await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Enviar o reenviar por WhatsApp' }).click();
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await expect(page.getByTestId('cash-whatsapp-card')).toBeVisible();
    await expect(page.getByTestId('cash-whatsapp-warning')).toBeVisible();
  });

  test('current cash failure remains a global operational error without logging out', async ({ page }) => {
    await page.route('**/api/cash-register/current', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-2 forced current cash failure' }),
      });
    });

    await gotoProtected(page, '/cash');
    await expect(page.getByTestId('cash-global-error')).toBeVisible({ timeout: 15000 });
  });
});
