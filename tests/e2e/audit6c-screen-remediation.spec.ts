import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const screenshotRoot = path.join(
  process.cwd(),
  'infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-6c-screen-remediation',
);

const adminCredentials = {
  email: 'admin@2x1burger.co',
  password: 'DevAdmin12345*',
};

const pagesToCapture = [
  { path: '/inventory', name: 'inventory', heading: /Conteo físico, ajustes y abastecimiento/ },
  { path: '/products', name: 'products', heading: /Productos — Carta y stock/ },
  { path: '/users', name: 'users', heading: /Equipo — Quién opera hoy/ },
  { path: '/recipes', name: 'recipes', heading: /Recetas — El secreto de cada plato/ },
  { path: '/reports', name: 'reports', heading: /Reportes — Tu negocio en números/ },
  { path: '/cash', name: 'cash', heading: /Caja — Jornada en vivo|Abrir caja|Sesión activa/ },
  { path: '/pos', name: 'pos', heading: /POS — 2X1 Burger Co/ },
];

test.beforeAll(() => {
  for (const directory of ['desktop', 'tablet', 'mobile', 'issues-fixed']) {
    mkdirSync(path.join(screenshotRoot, directory), { recursive: true });
  }
});

test.describe.configure({ retries: 0 });

async function loginAdmin(page: Page) {
  const response = await page.request.post('http://127.0.0.1:4301/auth/login', {
    data: adminCredentials,
  });
  expect(response.ok()).toBeTruthy();
  const loginPayload = (await response.json()) as { accessToken: string };

  await page.route('**/auth/refresh', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: loginPayload.accessToken }),
    });
  });

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: /Buenos días|Buenas tardes|Buenas noches|Hola/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('nav-products')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function openPage(page: Page, route: (typeof pagesToCapture)[number]) {
  await page.goto(route.path);
  await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible({ timeout: 15000 });
}

test('AUDIT-6C critical screens are responsive and capture after screenshots', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    if (/\/api\/|\/inventory|\/products|\/users|\/recipes|\/reports|\/cash|\/pos/.test(request.url())) {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
    }
  });

  await loginAdmin(page);

  for (const route of pagesToCapture) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPage(page, route);
    await page.screenshot({ path: path.join(screenshotRoot, 'desktop', `${route.name}-1440x900.png`), fullPage: true });

    await page.setViewportSize({ width: 1024, height: 768 });
    await openPage(page, route);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotRoot, 'tablet', `${route.name}-1024x768.png`), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, route);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotRoot, 'mobile', `${route.name}-390x844.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  const menuButton = page.getByRole('button', { name: 'Abrir menú de navegación' });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  await expect(page.getByRole('button', { name: 'Cerrar menú de navegación' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Cerrar menú de navegación' }).click();
  await expect(page.getByRole('button', { name: 'Abrir menú de navegación' })).toHaveAttribute('aria-expanded', 'false');

  await page.goto('/cash');
  await expect(page.getByRole('heading', { name: /Caja — Jornada en vivo|Abrir caja|Sesión activa/ }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('No pudimos cargar toda la operación de caja')).toHaveCount(0);

  const allowedConsoleNoise = ['401 (Unauthorized)', 'favicon'];
  expect(consoleErrors.filter((entry) => !allowedConsoleNoise.some((allowed) => entry.includes(allowed)))).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('AUDIT-6C forms expose client-side validation in products, users and recipes', async ({ page }) => {
  await loginAdmin(page);

  await page.goto('/products');
  await expect(page.getByRole('heading', { name: /Productos — Carta y stock/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByText('El código es obligatorio.')).toBeVisible();
  await expect(page.getByText('El nombre es obligatorio.')).toBeVisible();
  await expect(page.getByText('La categoría es obligatoria.')).toBeVisible();
  await expect(page.getByText('La unidad es obligatoria.')).toBeVisible();
  await expect(page.getByText('El precio debe ser mayor a $0.')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotRoot, 'issues-fixed', 'products-validation.png'), fullPage: true });

  await page.goto('/users');
  await expect(page.getByRole('heading', { name: /Equipo — Quién opera hoy/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Crear usuario' }).click();
  await expect(page.getByText('El nombre completo es obligatorio.')).toBeVisible();
  await expect(page.getByText('El correo electrónico es obligatorio.')).toBeVisible();
  await expect(page.getByText('Debe seleccionar un rol.')).toBeVisible();
  await expect(page.getByText(/Minimo 8 caracteres/)).toBeVisible();
  await expect(page.getByText('Confirma la contraseña.')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotRoot, 'issues-fixed', 'users-validation.png'), fullPage: true });

  await page.goto('/recipes');
  await expect(page.getByRole('heading', { name: /Recetas — El secreto de cada plato/ })).toBeVisible({ timeout: 15000 });
  const productSelect = page.getByLabel('Producto preparado');
  const options = await productSelect.locator('option').evaluateAll((items) =>
    items.map((item) => ({ value: (item as HTMLOptionElement).value, label: item.textContent ?? '' })).filter((item) => item.value),
  );

  if (options.length > 0) {
    const recipeResponse = page.waitForResponse(
      (response) => response.url().includes('/recipes/') && response.request().method() === 'GET',
      { timeout: 10000 },
    ).catch(() => null);
    await productSelect.selectOption(options[0].value);
    await recipeResponse;
    await expect(page.getByLabel('Cantidad').first()).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Cantidad').first().fill('0');
    await expect(page.getByLabel('Cantidad').first()).toHaveValue('0');
    await page.getByRole('button', { name: 'Guardar receta' }).click();
    await expect(page.getByText('La cantidad debe ser mayor a 0.')).toBeVisible();
  } else {
    await expect(page.getByText('Selecciona producto')).toBeVisible();
  }

  await page.screenshot({ path: path.join(screenshotRoot, 'issues-fixed', 'recipes-validation.png'), fullPage: true });
});

test('AUDIT-6C build artifact remains free of localhost API leakage', async () => {
  const nextDir = path.join(process.cwd(), 'apps/web/.next');
  expect(existsSync(nextDir), 'Build artifact must exist before bundle leakage validation').toBe(true);
  const { execSync } = await import('node:child_process');
  const result = execSync('grep -R "localhost:4300" apps/web/.next 2>/dev/null || true', {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  expect(result.trim()).toBe('');
});
