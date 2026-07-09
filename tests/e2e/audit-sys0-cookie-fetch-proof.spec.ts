import { expect, test } from '@playwright/test';

type CookieDebugResponse = {
  hasRefreshCookie: boolean;
  cookieNames: string[];
  host: string;
  origin: string;
  path: string;
};

test.describe('AUDIT-SYS-0: httpOnly cookie and refresh proof', () => {
  test.setTimeout(90000);

  test('refresh cookie is sent by browser fetch before and after reload without exposing values', async ({ page, context }) => {
    await page.goto('/cash', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });

    const cookies = await context.cookies('http://localhost/api/auth/refresh');
    const refreshCookie = cookies.find((cookie) => cookie.name === 'refresh_token');
    expect(refreshCookie, 'refresh_token cookie should be stored in browser context').toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.path).toBe('/api/auth');

    const beforeDebug = await page.evaluate(async () => {
      const response = await fetch('/api/auth/debug-cookie-presence', { credentials: 'include' });
      return {
        status: response.status,
        body: (await response.json()) as CookieDebugResponse,
      };
    });
    expect(beforeDebug.status).toBe(200);
    expect(beforeDebug.body.hasRefreshCookie).toBe(true);
    expect(beforeDebug.body.cookieNames).not.toContain('refresh_token');

    const beforeRefresh = await page.evaluate(async () => {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return {
        status: response.status,
        ok: response.ok,
      };
    });
    expect(beforeRefresh).toEqual({ status: 201, ok: true });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });

    const afterDebug = await page.evaluate(async () => {
      const response = await fetch('/api/auth/debug-cookie-presence', { credentials: 'include' });
      return {
        status: response.status,
        body: (await response.json()) as CookieDebugResponse,
      };
    });
    expect(afterDebug.status).toBe(200);
    expect(afterDebug.body.hasRefreshCookie).toBe(true);
    expect(afterDebug.body.cookieNames).not.toContain('refresh_token');

    const afterRefresh = await page.evaluate(async () => {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return {
        status: response.status,
        ok: response.ok,
      };
    });
    expect(afterRefresh).toEqual({ status: 201, ok: true });
    await expect(page).not.toHaveURL(/\/login/);
  });
});
