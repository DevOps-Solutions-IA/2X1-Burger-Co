import { expect, test } from '@playwright/test';
import path from 'node:path';

const adminEmail = 'admin@2x1burger.co';
const adminPassword = 'DevAdmin12345*';
const AUTH_FILE =
  process.env.PLAYWRIGHT_AUTH_FILE ??
  path.join('/tmp', 'playwright-auth', process.env.PLAYWRIGHT_AUTH_RUN_ID ?? 'local', 'worker-0.json');

async function fillLoginForm(page: import('@playwright/test').Page) {
  await page.waitForLoadState('load');
  await page.getByTestId('login-email').click();
  await page.getByTestId('login-email').pressSequentially(adminEmail);
  await page.getByTestId('login-password').click();
  await page.getByTestId('login-password').pressSequentially(adminPassword);
  await expect(page.getByTestId('login-email')).toHaveValue(adminEmail);
  await expect(page.getByTestId('login-password')).toHaveValue(adminPassword);
}

async function ensureAuthenticated(page: import('@playwright/test').Page) {
  await Promise.race([
    page.locator('main').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
  ]);

  if (!(await page.getByTestId('login-email').isVisible().catch(() => false))) {
    return;
  }

  await fillLoginForm(page);
  await Promise.all([
    page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
    page.getByTestId('login-submit').click(),
  ]);
}

async function gotoCash(page: import('@playwright/test').Page) {
  await page.goto('/cash', { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page);
  if (!new URL(page.url()).pathname.startsWith('/cash')) {
    await page.goto('/cash', { waitUntil: 'domcontentloaded' });
    await ensureAuthenticated(page);
  }
  await expect(page, 'cash redirected to login').not.toHaveURL(/\/login/);
}

const fakeDeliverySale = {
  id: 'phase4-delivery-sale',
  number: 'PHA4-001',
  status: 'PAID',
  soldAt: new Date().toISOString(),
  channel: 'DOMICILIO',
  tableLabel: null,
  deliveryReference: 'PHASE-4 domicilio auditado',
  customerName: 'Cliente PHASE-4',
  customerPhone: '3001234567',
  notes: null,
  total: 28500,
  subtotal: 20000,
  deliveryFee: 8500,
  items: [
    {
      quantity: 1,
      unitPrice: 20000,
      totalPrice: 20000,
      product: { name: 'Hamburguesa PHASE-4' },
    },
  ],
  conversion: null,
};

test.describe('PHASE-DELIVERY-AUTO-4: cash and WhatsApp degraded states', () => {
  test.setTimeout(120_000);

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: AUTH_FILE });
  });

  test('daily summary 503 is local and keeps cash usable', async ({ page }) => {
    await page.route('**/api/reports/operational', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'PHASE-4 forced daily summary failure' }),
      });
    });

    await gotoCash(page);
    await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await expect(page.getByTestId('cash-current-status')).toBeVisible();
    await expect(page.getByTestId('cash-daily-summary-error')).toBeVisible();
  });

  test('operational log 503 is local and keeps cash usable', async ({ page }) => {
    await page.route('**/api/cash-register/operational-log', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'PHASE-4 forced operational log failure' }),
      });
    });

    await gotoCash(page);
    await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await expect(page.getByTestId('cash-operational-log-error')).toBeVisible();
  });

  test('WhatsApp 503 is local and delivery fee remains visible', async ({ page }) => {
    await page.route('**/api/sales**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([fakeDeliverySale]),
      });
    });
    await page.route('**/api/whatsapp/session', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'PHASE-4 forced WhatsApp unavailable' }),
      });
    });

    await gotoCash(page);
    await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`cash-sale-delivery-fee-${fakeDeliverySale.id}`)).toContainText('COP 8.500');
    await page.getByRole('button', { name: 'Enviar o reenviar por WhatsApp' }).click();
    await expect(page.getByTestId('cash-global-error')).toHaveCount(0);
    await expect(page.getByTestId('cash-whatsapp-card')).toBeVisible();
    await expect(page.getByTestId('cash-whatsapp-warning')).toBeVisible();
  });

  test('current cash 503 shows global operational error without logout', async ({ page }) => {
    await page.route('**/api/cash-register/current', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'PHASE-4 forced current cash failure' }),
      });
    });

    await gotoCash(page);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId('cash-global-error')).toBeVisible({ timeout: 15000 });
  });
});
