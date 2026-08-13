import { expect, test } from '../fixtures/worker-auth';
import { expectAccessiblePage } from './accessibility';

test.describe('Phase 8 application shell accessibility', () => {
  test('mobile drawer traps focus, closes safely and restores its trigger', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/overview');

    const trigger = page.getByRole('button', { name: 'Abrir menú de navegación' });
    const drawer = page.locator('#mobile-navigation-dialog');
    const application = page.locator('#mobile-navigation-dialog + div');
    const triggerSize = await trigger.boundingBox();

    expect(triggerSize?.width).toBeGreaterThanOrEqual(44);
    expect(triggerSize?.height).toBeGreaterThanOrEqual(44);
    await expect(trigger).toHaveAttribute('aria-controls', 'mobile-navigation-dialog');
    await expect(drawer).toHaveAttribute('aria-hidden', 'true');
    await expect(drawer).toHaveJSProperty('inert', true);

    await trigger.focus();
    await trigger.press('Enter');

    await expect(page.getByRole('dialog', { name: 'Navegación principal' })).toBeVisible();
    await expect(application).toHaveAttribute('aria-hidden', 'true');
    await expect(application).toHaveJSProperty('inert', true);

    const close = page.getByRole('button', { name: 'Cerrar menú de navegación' }).last();
    await expect(close).toBeFocused();
    await close.press('Shift+Tab');
    await expect(drawer.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toBeFocused();
  });

  test('skip link and compact global search remain available below desktop', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/overview');

    const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAttribute('href', '#main-content');

    const search = page.getByRole('button', { name: /Buscar clientes, pedidos y conversaciones/ });
    const searchSize = await search.boundingBox();
    expect(searchSize?.width).toBeGreaterThanOrEqual(44);
    expect(searchSize?.height).toBeGreaterThanOrEqual(44);
    await search.click();
    await expect(page.getByRole('dialog', { name: 'Busqueda global' })).toBeVisible();

    await expectAccessiblePage(page);
  });
});
