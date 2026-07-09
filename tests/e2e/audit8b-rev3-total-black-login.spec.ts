import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login',
);

const criticalRequestPattern = /\/api\/|\/login|\/brand\/sidebar-logo\.png/;

async function loginAdminFromUi(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('admin@2x1burger.co');
    await page.getByTestId('login-password').fill('DevAdmin12345*');
    await page.getByTestId('login-submit').click();

    try {
      await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'Panel de operación' })).toBeVisible({ timeout: 15000 });
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await page.waitForTimeout(1500);
    }
  }
}

test.beforeAll(() => {
  for (const directory of ['before', 'after', 'desktop', 'tablet', 'mobile', 'error-state']) {
    mkdirSync(path.join(screenshotRoot, directory), { recursive: true });
  }
});

test.describe('AUDIT-8B-REV3 total black login brand restructure', () => {
  test('login is total black, branded, decorated, and preserves admin auth', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    page.on('requestfailed', (request) => {
      if (criticalRequestPattern.test(request.url())) {
        failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');

    await expect(page.getByTestId('login-total-black-shell')).toBeVisible();
    const shellBackground = await page.getByTestId('login-total-black-shell').evaluate((element) => {
      return window.getComputedStyle(element).backgroundColor;
    });
    expect(shellBackground).toMatch(/rgb\(5,\s*4,\s*3\)|rgb\(0,\s*0,\s*0\)/);

    await expect(page.getByTestId('login-brand-panel')).toBeVisible();
    await expect(page.getByTestId('login-brand-logo')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'El control detrás del mejor ritmo de 2X1 Burger Co.' })).toBeVisible();
    await expect(page.getByText('Ventas, caja e inventario alineados para que cada turno fluya con precisión.')).toBeVisible();
    await expect(page.getByText('Turno bajo control')).toBeVisible();
    await expect(page.getByTestId('login-burger-accent').first()).toBeVisible();

    await expect(page.getByText('Control real para una operación que no se detiene.')).toHaveCount(0);
    await expect(page.getByText('Operación rápida')).toHaveCount(0);
    await expect(page.getByText('solución integral')).toHaveCount(0);
    await expect(page.getByText('Seguridad operativa')).toHaveCount(0);
    await expect(page.getByText('Caja viva')).toHaveCount(0);
    await expect(page.getByText('Lectura inmediata')).toHaveCount(0);

    await expect(page.getByText('Acceso seguro')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.getByText('Entra al panel que mueve cada venta, cada caja y cada turno de 2X1 Burger Co.')).toBeVisible();
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acceso para meseros' })).toHaveAttribute('href', '/waiter/login');
    await expect(page.getByRole('link', { name: 'Acceso para domiciliarios' })).toHaveAttribute('href', '/delivery/login');

    await page.screenshot({
      path: path.join(screenshotRoot, 'desktop', 'login-total-black-desktop-1440x900.png'),
      fullPage: true,
    });
    await page.screenshot({
      path: path.join(screenshotRoot, 'after', 'login-total-black-after.png'),
      fullPage: true,
    });
    await page.screenshot({
      path: path.join(screenshotRoot, 'after', 'black-background-logo-decoration-proof.png'),
      fullPage: true,
    });

    await page.getByTestId('login-email').fill('correo-invalido');
    await page.getByTestId('login-password').fill('123');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Escribe un correo válido.')).toBeVisible();
    await expect(page.getByText('La contraseña debe tener al menos 8 caracteres.')).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotRoot, 'error-state', 'login-total-black-error-state.png'),
      fullPage: true,
    });

    await loginAdminFromUi(page);

    expect(
      consoleErrors.filter((entry) => !entry.includes('favicon') && !entry.includes('401 (Unauthorized)')),
    ).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test('total black login remains usable on tablet and mobile without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/login');
    await expect(page.getByTestId('login-total-black-shell')).toBeVisible();
    await expect(page.getByTestId('login-brand-logo')).toBeVisible();
    await expect(page.getByTestId('login-email')).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotRoot, 'tablet', 'login-total-black-tablet-1024x768.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await expect(page.getByTestId('login-brand-logo')).toBeVisible();
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acceso para meseros' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acceso para domiciliarios' })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: path.join(screenshotRoot, 'mobile', 'login-total-black-mobile-390x844.png'),
      fullPage: true,
    });
  });
});
