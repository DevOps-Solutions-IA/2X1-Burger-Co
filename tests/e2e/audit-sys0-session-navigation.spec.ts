import { expect, test } from '@playwright/test';

const protectedRoutes = [
  '/dashboard',
  '/pos',
  '/cash',
  '/tables',
  '/settings',
  '/inventory',
  '/products',
  '/purchases',
  '/expenses',
  '/reports',
  '/users',
  '/deliveries',
];

const allowedConsoleNoise = [
  '401 (Unauthorized)',
  '409 (Conflict)',
  'favicon',
];

function isCriticalRequest(url: string) {
  return /\/api\/|\/dashboard|\/pos|\/cash|\/tables|\/settings|\/inventory|\/products|\/purchases|\/expenses|\/reports|\/users|\/deliveries/.test(url);
}

test.describe('AUDIT-SYS-0: session navigation stability', () => {
  test.setTimeout(120000);

  test('session survives protected navigation, reloads, and secondary requests', async ({ page, context }) => {
    const failedRequests: string[] = [];
    const serverFailures: string[] = [];
    const consoleErrors: string[] = [];
    const routeResults: Array<{ route: string; stage: string; url: string }> = [];

    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      if (isCriticalRequest(request.url()) && failure !== 'net::ERR_ABORTED') {
        failedRequests.push(`${request.method()} ${request.url()} -> ${failure}`);
      }
    });

    page.on('response', (response) => {
      if (isCriticalRequest(response.url()) && response.status() >= 500) {
        serverFailures.push(`${response.status()} ${response.url()}`);
      }
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        if (!allowedConsoleNoise.some((noise) => text.includes(noise))) {
          consoleErrors.push(text);
        }
      }
    });

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    const cookies = await context.cookies('http://localhost/api/auth/refresh');
    const refreshCookie = cookies.find((cookie) => cookie.name === 'refresh_token');
    expect(refreshCookie, 'refresh_token cookie must exist in browser context').toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.path).toBe('/api/auth');

    for (const route of protectedRoutes) {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await expect(page, `${route} redirected to login on initial load`).not.toHaveURL(/\/login/);
      await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
      routeResults.push({ route, stage: 'load', url: page.url() });

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await expect(page, `${route} redirected to login after reload`).not.toHaveURL(/\/login/);
      await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
      routeResults.push({ route, stage: 'reload', url: page.url() });
    }

    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto('/cash', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0);

    console.log('SYS0 route results:', JSON.stringify(routeResults));
    expect(failedRequests, `Failed critical requests:\n${failedRequests.join('\n')}`).toEqual([]);
    expect(serverFailures, `Server failures:\n${serverFailures.join('\n')}`).toEqual([]);
    expect(consoleErrors, `Console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
