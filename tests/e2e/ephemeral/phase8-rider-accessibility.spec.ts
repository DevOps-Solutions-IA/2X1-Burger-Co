import { expect, test } from '@playwright/test';
import { expectAccessiblePage } from './accessibility';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('rider receive workflow is accessible at phone, tablet and desktop widths without operational mutation', async ({ page }) => {
  const workflowMutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/api\/orders\/[^/]+\/delivery-workflow(?:\?|$)/.test(request.url())) {
      workflowMutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/delivery/login');
  const name = page.getByTestId('delivery-login-name');
  const code = page.getByTestId('delivery-login-code');
  const submit = page.getByTestId('delivery-login-submit');

  await name.fill(process.env.EPHEMERAL_DELIVERY_ACCESS_NAME ?? 'E2E Rider');
  await code.fill(process.env.EPHEMERAL_DELIVERY_ACCESS_CODE ?? 'D230001');
  await name.focus();
  await name.press('Tab');
  await expect(code).toBeFocused();
  await expect(submit).toBeEnabled();
  await code.press('Tab');
  await expect(submit).toBeFocused();
  await submit.press('Enter');

  await expect(page).toHaveURL(/\/delivery\/?$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Domicilios — Tus entregas' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessiblePage(page);

  const menuTrigger = page.getByRole('button', { name: 'Abrir menú de domiciliarios' });
  await menuTrigger.focus();
  await menuTrigger.press('Enter');
  const menu = page.getByRole('dialog', { name: 'Sesión de domiciliario' });
  const logout = menu.getByRole('button', { name: 'Cerrar sesión' });
  await expect(menu).toBeVisible();
  await expect(logout).toBeFocused();
  await logout.press('Tab');
  await expect(logout).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuTrigger).toBeFocused();

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByText('E2E-DELIVERY-0001')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessiblePage(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('heading', { name: 'Domicilios — Tus entregas' })).toBeVisible();
  await expect(page.getByText('E2E-DELIVERY-0001')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessiblePage(page);

  await menuTrigger.focus();
  await menuTrigger.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  expect(workflowMutations).toEqual([]);
});
