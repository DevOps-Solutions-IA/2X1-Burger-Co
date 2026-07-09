import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function login(page: Page) {
  await loginAs(page, 'admin@2x1burger.co', 'DevAdmin12345*');
}

async function loginAs(
  page: Page,
  email: string,
  password: string,
  expectedPath = '/dashboard',
  expectedHeading = 'Panel de operación',
) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByTestId('login-submit').click();

    try {
      await expect(page).toHaveURL(new RegExp(`${expectedPath.replace('/', '\\/')}\\/?$`), {
        timeout: 8000,
      });
      await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible();
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }

      await page.waitForTimeout(1500);
    }
  }
}

async function loginAsWaiter(
  page: Page,
  name: string,
  accessCode: string,
  expectedPath = '/waiter',
  expectedHeading = 'Toma de pedidos',
) {
  await page.goto('/waiter/login');
  await page.getByTestId('waiter-login-name').fill(name);
  await page.getByTestId('waiter-login-code').fill(accessCode);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByTestId('waiter-login-submit').click();

    try {
      await expect(page).toHaveURL(new RegExp(`${expectedPath.replace('/', '\\/')}\\/?$`), {
        timeout: 8000,
      });
      await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible();
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }

      await page.waitForTimeout(1500);
    }
  }
}

async function loginAsDelivery(
  page: Page,
  name: string,
  accessCode: string,
  expectedPath = '/delivery',
  expectedHeading = 'Panel de domiciliarios',
) {
  await page.goto('/delivery/login');
  await page.getByTestId('delivery-login-name').fill(name);
  await page.getByTestId('delivery-login-code').fill(accessCode);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByTestId('delivery-login-submit').click();

    try {
      await expect(page).toHaveURL(new RegExp(`${expectedPath.replace('/', '\\/')}\\/?$`), {
        timeout: 8000,
      });
      await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible();
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }

      await page.waitForTimeout(1500);
    }
  }
}

async function resetSession(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

async function ensureCashOpen(page: Page) {
  await page.goto('/cash');
  await expect(page.getByRole('heading', { name: /Abrir caja|Sesión activa/ })).toBeVisible();

  if (await page.getByTestId('cash-open-amount').isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.getByTestId('cash-open-amount').fill('80000');
    await page.getByTestId('cash-open-submit').click();
    await expect(page.getByRole('heading', { name: 'Sesión activa' })).toBeVisible({
      timeout: 10000,
    });
    return;
  }

  await expect(page.getByRole('heading', { name: 'Sesión activa' })).toBeVisible();
}

async function clearActiveOrders(page: Page) {
  await page.goto('/pos');
  await expect(page.getByRole('heading', { name: 'Comandas activas' })).toBeVisible();
  const activeOrderCards = page.locator('[data-testid^="order-card-"]');
  const emptyState = page.getByText('Sin comandas activas');

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await emptyState.isVisible().catch(() => false)) {
      return;
    }

    const currentCount = await activeOrderCards.count();
    if (currentCount === 0) {
      await page.waitForTimeout(1000);
      await page.reload();
      continue;
    }

    await activeOrderCards.first().click();
    await expect(page.getByRole('button', { name: 'Cancelar comanda' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar comanda' }).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(activeOrderCards).toHaveCount(Math.max(0, currentCount - 1), {
      timeout: 10000,
    });
  }
}

test.describe.serial('Operational flows', () => {
  test('admin can login and access protected dashboard', async ({ page }) => {
    await login(page);
    await expect(page.getByText('Caja', { exact: true }).first()).toBeVisible();
  });

  test('sidebar navigation exposes core modules', async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-products').click();
    await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
    await page.getByTestId('nav-tables').click();
    await expect(page.getByRole('heading', { name: 'Mesas y ocupación' })).toBeVisible();
    await page.getByTestId('nav-reports').click();
    await expect(page.getByRole('heading', { name: 'Cierre, históricos y lectura ejecutiva' })).toBeVisible();
  });

  test('cash can be opened from the frontend', async ({ page }) => {
    await login(page);
    await ensureCashOpen(page);
  });

  test('waiter can create a table order from the dedicated module', async ({ page }) => {
    await login(page);
    await ensureCashOpen(page);
    await resetSession(page);
    await loginAsWaiter(page, 'Mesero Principal', 'M124578');
    await page.goto('/waiter');
    await page.getByTestId('waiter-table-mesa-1').click();
    await page.getByTestId('waiter-product-hamb-2x1').click();
    await page.getByTestId('waiter-save-order').click();
    await expect(page.getByRole('heading', { name: 'Mesas' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('heading', { name: 'Comandas activas' })).toBeVisible();
    await expect(page.getByText('Mesa 1').first()).toBeVisible();

    await resetSession(page);
    await login(page);
    await page.goto('/tables');
    await expect(page.getByTestId('table-card-mesa-1')).toContainText('Activa');
  });

  test('sale can be created from POS', async ({ page }) => {
    await login(page);
    await ensureCashOpen(page);
    await page.goto('/pos');
    await page.getByTestId('pos-product-hamb-2x1').click();
    await page.getByTestId('pos-product-cc-org-400').click();
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    await page.getByLabel('Método de pago').selectOption({ label: 'Efectivo' });
    await page.getByRole('button', { name: 'Usar total exacto' }).click();
    await page.getByTestId('pos-checkout-order').click();
    await expect(page.getByText('Sin productos cargados')).toBeVisible();
  });

  test('counter order can be opened and stay editable in POS', async ({ page }) => {
    await login(page);
    await ensureCashOpen(page);
    await page.goto('/pos');
    await page.getByTestId('pos-product-hamb-2x1').click();
    await page.getByLabel('Tipo de atención').selectOption({ label: 'Venta directa' });
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    await expect(page.getByText('Editar comanda')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Cobrar y cerrar comanda' })).toBeVisible();
  });

  test('expense can be registered', async ({ page }) => {
    await login(page);
    const concept = `Mantenimiento QA ${Date.now()}`;
    await page.goto('/expenses');
    await page.getByTestId('expense-concept').fill(concept);
    await page.getByTestId('expense-classification').fill('Operación');
    await page.getByTestId('expense-amount').fill('3500');
    await page.getByLabel('Método de pago').selectOption({ label: 'Efectivo' });
    await page.getByTestId('expense-submit').click();
    await expect(page.getByText(concept)).toBeVisible();
  });

  test('daily report page is available and PDF opens', async ({ page }) => {
    await login(page);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Cierre, históricos y lectura ejecutiva' })).toBeVisible();
    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('reports-open-pdf').click();
    const popup = await popupPromise;
    expect(popup).toBeTruthy();
  });

  test('purchase can be created from the frontend', async ({ page }) => {
    await login(page);
    await page.goto('/purchases');
    await page.getByTestId('purchase-supplier').selectOption({ index: 1 });
    await page.getByLabel('Factura / referencia').fill(`QA-${Date.now()}`);
    await page.getByLabel('Ítem').selectOption({ index: 1 });
    await page.getByLabel('Cantidad').fill('2');
    await page.getByLabel('Costo unitario').fill('1500');
    await page.getByTestId('purchase-submit').click();
    await expect(page.getByRole('heading', { name: 'Detalle de compra' })).toBeVisible();
    await expect(page.getByText('Total de la compra')).toBeVisible();
  });

  test('dine-in order can be opened from tables and checked out later', async ({ page }) => {
    await login(page);
    await ensureCashOpen(page);
    await clearActiveOrders(page);
    await page.goto('/tables');
    await page.getByRole('link', { name: 'Abrir comanda' }).first().click();
    await expect(page.getByRole('heading', { name: /Punto de venta y comandas/ })).toBeVisible();
    await page.getByTestId('pos-product-hamb-2x1').click();
    await page.getByRole('button', { name: /Abrir comanda|Guardar cambios de la comanda/ }).click();
    await page.locator('[data-testid^="order-card-mesa-"]').first().click();
    await expect(page.getByRole('button', { name: 'Cobrar y cerrar comanda' })).toBeVisible();
    await page.getByLabel('Método de pago').selectOption({ label: 'Efectivo' });
    await page.getByRole('button', { name: 'Usar total exacto' }).click();
    await expect(page.getByTestId('pos-checkout-order')).toBeEnabled();
    await page.getByTestId('pos-checkout-order').click();
    await page.goto('/tables');
    await expect(page.getByText('Sin comanda activa').first()).toBeVisible();
  });

  test('cashier cannot access restricted admin modules', async ({ page }) => {
    await loginAs(page, 'cashier@2x1burgerco.local', 'Cashier12345*');
    await expect(page.getByTestId('nav-users')).toHaveCount(0);
    await page.goto('/users');
    await expect(page.getByText('No tienes permisos para este módulo')).toBeVisible();
  });

  test('POS prevents selling above direct stock', async ({ page }) => {
    await login(page);
    await ensureCashOpen(page);
    await page.goto('/pos');

    const productCard = page.getByTestId('pos-product-cc-org-400');
    const productText = (await productCard.textContent()) ?? '';
    const stockMatch = productText.match(/Stock\s*(\d+)/i);
    const availableStock = Number(stockMatch?.[1] ?? 0);

    expect(availableStock).toBeGreaterThan(0);

    for (let index = 0; index < availableStock + 1; index += 1) {
      await page.getByTestId('pos-product-cc-org-400').click();
    }
    await expect(page.getByTestId('pos-cart-qty-cc-org-400')).toHaveText(String(availableStock));
    await expect(page.getByText('Stock insuficiente para Coca-Cola Original 400 ml').first()).toBeVisible();
  });

  test('admin can assign a delivery order and a rider can operate it end to end', async ({ page, browser }) => {
    await login(page);
    await ensureCashOpen(page);
    await clearActiveOrders(page);
    const deliverySuffix = Date.now();
    const customerName = `Cliente QA Domicilio ${deliverySuffix}`;
    const customerPhone = `300${String(deliverySuffix).slice(-7)}`;

    await page.goto('/pos');
    await page.getByTestId('pos-product-hamb-2x1').click();
    await page.getByLabel('Tipo de atención').selectOption({ label: 'Domicilio' });
    await page.getByLabel('Cliente').fill(customerName);
    await page.getByLabel('Teléfono').fill(customerPhone);
    await page.getByLabel('Referencia o dirección').fill('Alfaguara Jamundí');
    await page.getByRole('button', { name: 'Abrir comanda' }).click();

    await expect(page.getByText('Editar comanda')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(customerName)).toBeVisible();

    await page.goto('/deliveries');
    await expect(page.getByRole('heading', { name: 'Domicilios y reparto' })).toBeVisible();
    const deliveryCard = page.locator('div').filter({ hasText: customerName }).first();
    await expect(deliveryCard).toContainText(customerName);
    await deliveryCard.getByRole('combobox').selectOption({ label: 'Domiciliario Principal' });
    await deliveryCard.getByRole('button', { name: 'Asignar' }).click();
    await expect(deliveryCard).toContainText('Rider: Domiciliario Principal');

    await resetSession(page);
    const riderContext = await browser.newContext();
    const riderPage = await riderContext.newPage();

    try {
      await loginAsDelivery(riderPage, 'Domiciliario Principal', 'D124578');
      const riderCard = riderPage.locator('div').filter({ hasText: customerName }).first();
      await expect(riderCard).toContainText(customerName);
      await riderCard.getByRole('button', { name: 'Marcar en camino' }).click();
      await expect(riderCard).toContainText('En camino');
      await riderCard.getByRole('button', { name: 'Marcar entregado' }).click();
      await expect(riderPage.getByText(customerName)).toHaveCount(0);
    } finally {
      await riderContext.close();
    }
  });

  test('expired session returns user to login', async ({ page }) => {
    await login(page);
    await page.context().clearCookies();
    await page.evaluate(() => {
      window.localStorage.setItem('inventory_fastfood_access_token', 'invalid-token');
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('cash can be closed from the frontend', async ({ page }) => {
    await login(page);
    await ensureCashOpen(page);
    await clearActiveOrders(page);
    await page.goto('/cash');
    await page.getByTestId('cash-use-expected').click();
    await page
      .getByLabel('Confirmo que revisé el arqueo, los bloqueos y el resumen antes de cerrar esta caja.')
      .check();
    await page
      .getByLabel(
        'Confirmo que resolví o revisé explícitamente comandas abiertas, pagos descuadrados y gastos sin clasificar antes del cierre.',
      )
      .check();
    await page.getByLabel('Confirmación final').fill('CERRAR');
    await expect(page.getByTestId('cash-close-submit')).toBeEnabled();
    await page.getByTestId('cash-close-submit').click();
    await expect(page.getByRole('heading', { name: 'Abrir caja' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('dashboard shows pending opening after closing cash', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Pendiente apertura').first()).toBeVisible();
    await expect(page.getByText('Abre caja para vender.')).toBeVisible();
  });

  test('daily closure appears in historical reports after closing cash', async ({ page }) => {
    await login(page);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Histórico de cierres' })).toBeVisible();
    await expect(page.getByText(new Date().toISOString().slice(0, 10)).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reimprimir' }).first()).toBeVisible();
  });
});
