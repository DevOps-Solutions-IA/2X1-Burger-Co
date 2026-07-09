import { expect, test } from '@playwright/test';

const routes = ['/dashboard', '/pos', '/cash', '/tables', '/settings'];
const allowedConsoleNoise = ['401 (Unauthorized)', '409 (Conflict)', 'favicon'];

test.describe('SYS-1: protected navigation regression', () => {
  test.setTimeout(90000);

  test('protected routes survive navigation and reload without unexpected login redirect', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return;
      }

      const text = message.text();
      if (!allowedConsoleNoise.some((noise) => text.includes(noise))) {
        consoleErrors.push(text);
      }
    });

    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      if (request.url().includes('/api/') && failure !== 'net::ERR_ABORTED') {
        failedRequests.push(`${request.method()} ${request.url()} -> ${failure}`);
      }
    });

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page, `${route} redirected to login`).not.toHaveURL(/\/login/);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page, `${route} redirected to login after reload`).not.toHaveURL(/\/login/);
    }

    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await page.goto('/cash', { waitUntil: 'domcontentloaded' });
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    expect(failedRequests, `failed API requests:\n${failedRequests.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
