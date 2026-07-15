import { expect, test } from '@playwright/test';

test('mobile login and dashboard do not overflow horizontally', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(process.env.EPHEMERAL_ADMIN_EMAIL!);
  await page.getByTestId('login-password').fill(process.env.EPHEMERAL_ADMIN_PASSWORD!);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
});
