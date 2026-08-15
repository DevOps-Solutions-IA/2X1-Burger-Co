import { expect, test, type Page } from '@playwright/test';
import { captureBrowserErrors, expectAccessiblePage } from './accessibility';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for ephemeral UI tests.`);
  return value;
}

const email = requiredEnv('EPHEMERAL_ADMIN_EMAIL');
const password = requiredEnv('EPHEMERAL_ADMIN_PASSWORD');

async function login(page: Page) {
  if (!/\/login(?:\?|$)/.test(page.url())) {
    await page.goto('/login');
  }
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test('operator console handles authentication, safe navigation and logout', async ({ page }) => {
  const serverFailures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/login');
  await page.getByTestId('login-email').fill('no-access.e2e@invalid.local');
  await page.getByTestId('login-password').fill('incorrect-password');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expectAccessiblePage(page);

  const browserErrors = captureBrowserErrors(page);
  await login(page);

  const routes = [
    ['/dashboard', 'dashboard-page'],
    ['/cash', 'cash-page'],
    ['/pos', 'pos-page'],
    ['/deliveries', 'deliveries-queue-list'],
    ['/inventory', 'inventory-page'],
    ['/users', 'users-page'],
    ['/sofia', 'sofia-clean-slate'],
    ['/sofia/whatsapp-qr', 'sofia-whatsapp-clean-slate'],
    ['/sofia/crm', 'sofia-crm-clean-slate'],
  ] as const;

  for (const [route, testId] of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(route.replaceAll('/', '\\/')));
    if (testId) await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText('Application error');
    await expectAccessiblePage(page);
  }

  await page.goto('/sofia');
  await expect(page.getByTestId('sofia-clean-slate')).toContainText('Nueva interfaz en construcción');
  await page.goto('/sofia/whatsapp-qr');
  await expect(page.getByTestId('sofia-whatsapp-clean-slate')).toContainText('Nueva interfaz en construcción');
  await expectAccessiblePage(page);

  await page.goto('/sofia/customers');
  await expect(page).toHaveURL(/\/sofia\/crm$/);
  await expect(page.getByTestId('sofia-crm-clean-slate')).toContainText('Nueva interfaz en construcción');
  await expectAccessiblePage(page);

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  expect(serverFailures).toEqual([]);
  expect(browserErrors).toEqual([]);
});
