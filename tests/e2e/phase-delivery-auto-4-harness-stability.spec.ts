import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from './fixtures/worker-auth';

const protectedRoutes = ['/dashboard', '/pos', '/cash', '/settings'];

async function waitForAppReady(page: import('@playwright/test').Page, route: string) {
  await Promise.race([
    page.getByTestId('app-main').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
    page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined),
  ]);

  if (await page.getByTestId('login-email').isVisible().catch(() => false)) {
    throw new Error(`${route} redirected to login while worker storageState should be valid`);
  }

  await expect(page, `${route} redirected to login`).not.toHaveURL(/\/login/);
  await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0);
}

async function gotoProtected(page: import('@playwright/test').Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, route);
}

test.describe('PHASE-DELIVERY-AUTO-4: Playwright harness stability', () => {
  test.setTimeout(120_000);

  test('auth storage is isolated and protected routes survive reloads', async ({ browser, baseURL, workerAuthFile }) => {
    const authFile = workerAuthFile;
    const authDir = process.env.PLAYWRIGHT_AUTH_DIR ?? '';

    expect(authFile).toBeTruthy();
    expect(authDir).toBeTruthy();
    expect(authFile).toContain('/tmp/playwright-auth/');
    expect(authFile).not.toContain('.auth-storage.json');
    expect(existsSync(authFile)).toBe(true);
    const storage = JSON.parse(readFileSync(authFile, 'utf8')) as {
      cookies?: unknown[];
    };
    expect(storage.cookies?.length ?? 0).toBeGreaterThan(0);

    const context = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost',
      storageState: authFile,
    });
    const page = await context.newPage();
    try {
      for (const route of protectedRoutes) {
        await gotoProtected(page, route);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForAppReady(page, `${route} after reload`);
      }

      await context.storageState({ path: authFile });
      const cookies = await context.cookies('http://localhost/api/auth/refresh');
      const refreshCookie = cookies.find((cookie) => cookie.name === 'refresh_token');
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.httpOnly).toBe(true);
      expect(refreshCookie?.path).toBe('/api/auth');
    } finally {
      await context.close();
    }
  });

  test('new browser contexts start isolated without inheriting mutable auth state', async ({ browser, baseURL }) => {
    const isolatedState = { cookies: [], origins: [] };
    const first = await browser.newContext({ baseURL: baseURL ?? 'http://localhost', storageState: isolatedState });
    const second = await browser.newContext({ baseURL: baseURL ?? 'http://localhost', storageState: isolatedState });
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();

    try {
      await Promise.all([
        firstPage.goto('/dashboard', { waitUntil: 'domcontentloaded' }),
        secondPage.goto('/cash', { waitUntil: 'domcontentloaded' }),
      ]);

      const firstCookies = await first.cookies('http://localhost/api/auth/refresh');
      const secondCookies = await second.cookies('http://localhost/api/auth/refresh');
      expect(firstCookies.some((cookie) => cookie.name === 'refresh_token')).toBe(false);
      expect(secondCookies.some((cookie) => cookie.name === 'refresh_token')).toBe(false);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
