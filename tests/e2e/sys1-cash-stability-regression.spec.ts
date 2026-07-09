import { expect, test } from '@playwright/test';

const criticalCashEndpoints = [
  '/api/cash-register/current',
  '/api/reports/operational',
];

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
  await page.goto('/cash', { waitUntil: 'domcontentloaded' });
}

test.describe('SYS-1: cash stability regression', () => {
  test.setTimeout(90000);

  test('cash opens without global error banner or logout', async ({ page }) => {
    const criticalStatuses: Array<{ endpoint: string; status: number }> = [];

    page.on('response', (response) => {
      const { pathname } = new URL(response.url());
      if (criticalCashEndpoints.includes(pathname)) {
        criticalStatuses.push({ endpoint: pathname, status: response.status() });
      }
    });

    await page.goto('/cash', { waitUntil: 'domcontentloaded' });
    await ensureAuthenticated(page);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0, { timeout: 15000 });

    await expect
      .poll(() => criticalCashEndpoints.every((endpoint) => criticalStatuses.some((entry) => entry.endpoint === endpoint)))
      .toBe(true);

    expect(criticalStatuses.every((entry) => entry.status === 200)).toBe(true);
  });
});
