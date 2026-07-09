import { expect, test } from '@playwright/test';

const adminEmail = 'admin@2x1burger.co';
const adminPassword = 'DevAdmin12345*';

const protectedRoutes = [
  '/dashboard',
  '/pos',
  '/cash',
  '/tables',
  '/settings',
  '/deliveries',
  '/inventory',
  '/products',
  '/purchases',
  '/expenses',
  '/reports',
  '/users',
];

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

async function gotoProtected(page: import('@playwright/test').Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page);
  if (!new URL(page.url()).pathname.startsWith(route)) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await ensureAuthenticated(page);
  }
  await expect(page, `${route} redirected to login`).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
}

test.describe('PHASE-DELIVERY-AUTO-4: secondary routes stability', () => {
  test.setTimeout(180_000);

  test('protected routes load and reload without logout or critical failed requests', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      if (failure !== 'net::ERR_ABORTED' && /\/api\/|\/dashboard|\/pos|\/cash|\/settings/.test(request.url())) {
        failedRequests.push(`${request.method()} ${request.url()} -> ${failure}`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 500 && /\/api\//.test(response.url())) {
        failedRequests.push(`${response.request().method()} ${response.url()} -> HTTP ${response.status()}`);
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of protectedRoutes) {
      await gotoProtected(page, route);
      await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} desktop overflow`).toBeLessThanOrEqual(2);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page, `${route} redirected to login after reload`).not.toHaveURL(/\/login/);
      await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    }

    expect(failedRequests, `critical failed requests:\n${failedRequests.join('\n')}`).toEqual([]);
  });

  test('mobile POS and cash remain usable without critical overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const route of ['/pos', '/cash', '/deliveries']) {
      await gotoProtected(page, route);
      await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} mobile overflow`).toBeLessThanOrEqual(2);
    }
  });
});
