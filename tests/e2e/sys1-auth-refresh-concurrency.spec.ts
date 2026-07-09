import { expect, test } from '@playwright/test';
import path from 'node:path';

const AUTH_FILE =
  process.env.PLAYWRIGHT_AUTH_FILE ??
  path.join('/tmp', 'playwright-auth', process.env.PLAYWRIGHT_AUTH_RUN_ID ?? 'local', 'worker-0.json');
const adminEmail = 'admin@2x1burger.co';
const adminPassword = 'DevAdmin12345*';

const protectedCashEndpoints = [
  '/api/cash-register/current',
  '/api/reports/operational',
  '/api/sales',
  '/api/expenses',
  '/api/purchases',
];

function isTargetEndpoint(url: string) {
  const { pathname } = new URL(url);
  return protectedCashEndpoints.includes(pathname);
}

async function warmAuthenticatedSession(page: import('@playwright/test').Page) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  if (await page.getByTestId('login-email').isVisible().catch(() => false)) {
    await page.waitForLoadState('load');
    await page.getByTestId('login-email').click();
    await page.getByTestId('login-email').pressSequentially(adminEmail);
    await page.getByTestId('login-password').click();
    await page.getByTestId('login-password').pressSequentially(adminPassword);
    await expect(page.getByTestId('login-email')).toHaveValue(adminEmail);
    await expect(page.getByTestId('login-password')).toHaveValue(adminPassword);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  }
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText('Cargando sesión...')).toHaveCount(0, { timeout: 15000 });
}

async function openCashWithinApp(page: import('@playwright/test').Page) {
  const cashLink = page.getByTestId('nav-cash');
  if (await cashLink.isVisible().catch(() => false)) {
    await cashLink.click();
  } else {
    await page.goto(`/cash?sys1=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  }
  await expect(page).toHaveURL(/\/cash/);
  await expect(page.getByTestId('cash-page')).toBeVisible({ timeout: 15000 });
}

test.describe('SYS-1: auth refresh single-flight', () => {
  test.setTimeout(90000);

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: AUTH_FILE });
  });

  test('deduplicates concurrent 401 responses into one refresh and keeps cash session active', async ({ page }) => {
    await warmAuthenticatedSession(page);

    let refreshRequests = 0;
    let forced401Count = 0;
    const forced = new Set<string>();

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const pathname = new URL(url).pathname;

      if (isTargetEndpoint(url) && !forced.has(pathname)) {
        forced.add(pathname);
        forced401Count += 1;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'SYS-1 forced expired access token' }),
        });
        return;
      }

      await route.continue();
    });

    await page.route('**/api/auth/refresh', async (route) => {
      refreshRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });

    await openCashWithinApp(page);
    await expect(page, 'cash must not redirect to login after forced concurrent 401s').not.toHaveURL(/\/login/);
    await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0, { timeout: 15000 });

    await expect.poll(() => forced401Count).toBeGreaterThanOrEqual(3);
    expect(forced401Count, 'test must force several protected 401s').toBeGreaterThanOrEqual(3);
    expect(refreshRequests, 'single-flight refresh must issue exactly one refresh request').toBe(1);
  });

  test('does not convert transient refresh failure into logout', async ({ page }) => {
    await warmAuthenticatedSession(page);
    await page.waitForTimeout(1700);

    let refreshRequests = 0;
    let forcedCurrentCash = false;

    await page.route('**/api/cash-register/current', async (route) => {
      if (!forcedCurrentCash) {
        forcedCurrentCash = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'SYS-1 forced expired access token' }),
        });
        return;
      }

      await route.continue();
    });

    await page.route('**/api/auth/refresh', async (route) => {
      refreshRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-1 transient refresh failure' }),
      });
    });

    await openCashWithinApp(page);
    await expect(page, 'transient refresh failure must not redirect to login').not.toHaveURL(/\/login/);
    expect(refreshRequests).toBe(1);

    await page.unroute('**/api/auth/refresh');
    await page.unroute('**/api/cash-register/current');
    await page.getByRole('link', { name: 'Inicio' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page, 'session should remain recoverable after transient refresh failure').not.toHaveURL(/\/login/);
  });

  test('does not call refresh or logout for a normal 429 response', async ({ page }) => {
    await warmAuthenticatedSession(page);

    let refreshRequests = 0;

    await page.route('**/api/auth/refresh', async (route) => {
      refreshRequests += 1;
      await route.continue();
    });

    await page.route('**/api/reports/operational', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SYS-1 forced rate limit' }),
      });
    });

    await openCashWithinApp(page);
    await expect(page, '429 response must not redirect to login').not.toHaveURL(/\/login/);
    await page.waitForTimeout(1000);
    expect(refreshRequests).toBe(0);
  });
});
