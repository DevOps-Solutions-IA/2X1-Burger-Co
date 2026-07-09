import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

async function ensureAuthenticated(page: import('@playwright/test').Page) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await Promise.race([
    page.locator('main').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
  ]);

  if (await page.getByTestId('login-email').isVisible().catch(() => false)) {
    await page.getByTestId('login-email').fill('admin@2x1burger.co');
    await page.getByTestId('login-password').fill('DevAdmin12345*');
    await Promise.all([
      page.waitForURL(/\/dashboard\/?$/, { timeout: 15000 }),
      page.getByTestId('login-submit').click(),
    ]);
  }
}

test.describe('SYS-2: auth harness isolation', () => {
  test.setTimeout(90000);

  test('noserver auth state is run-scoped and not the legacy shared repo file', async ({ page, context }) => {
    const authFile = process.env.PLAYWRIGHT_AUTH_FILE ?? '';
    const authDir = process.env.PLAYWRIGHT_AUTH_DIR ?? '';

    expect(authFile, 'PLAYWRIGHT_AUTH_FILE must be configured by noserver profile').toBeTruthy();
    expect(authDir, 'PLAYWRIGHT_AUTH_DIR must be configured by noserver profile').toBeTruthy();
    expect(authFile).not.toContain('.auth-storage.json');
    expect(authFile).toContain('/tmp/playwright-auth/');
    expect(existsSync(authFile)).toBe(true);

    await ensureAuthenticated(page);
    await context.storageState({ path: authFile });

    const cookies = await context.cookies('http://localhost/api/auth/refresh');
    const refreshCookie = cookies.find((cookie) => cookie.name === 'refresh_token');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.path).toBe('/api/auth');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);
  });
});
