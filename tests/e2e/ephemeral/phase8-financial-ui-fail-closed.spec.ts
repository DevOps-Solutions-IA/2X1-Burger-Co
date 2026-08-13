import { expect, test } from '../fixtures/worker-auth';

const zeroReport = {
  journey: {
    status: 'ABIERTA',
    openedAt: '2026-08-13T12:00:00.000Z',
    closedAt: null,
    responsibleUser: 'Operador de prueba',
  },
  cash: { expectedAmount: 0, actualAmount: 0, difference: 0 },
  sales: { total: 0, count: 0, byPaymentMethod: [], byChannel: [] },
  purchases: { total: 0, count: 0 },
  expenses: { total: 0, count: 0 },
  metrics: { costOfSales: 0, grossProfit: 0, netProfit: 0 },
};

test.describe('Phase 8 financial UI fails closed', () => {
  test('cash does not turn failed summaries or sales into zero-value evidence', async ({ page }) => {
    await page.route('**/api/reports/operational', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'financial summary unavailable' }),
    }));
    await page.route('**/api/sales', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'sales unavailable' }),
    }));

    await page.goto('/cash', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('cash-daily-summary-error')).toBeVisible();
    await expect(page.getByTestId('cash-daily-summary-values')).toHaveCount(0);
    await expect(page.getByTestId('cash-use-expected')).toBeDisabled();
    await expect(page.getByTestId('cash-reconciliation-unavailable')).toBeVisible();
    await expect(page.getByTestId('cash-sales-error')).toBeVisible();
    await expect(page.getByText('Sin ventas registradas')).toHaveCount(0);
  });

  test('reports distinguishes an unavailable source from an authoritative zero', async ({ page }) => {
    await page.route('**/api/reports/operational', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'financial report unavailable' }),
    }));

    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('reports-financial-detail-unavailable')).toBeVisible();
    await expect(page.getByTestId('reports-financial-detail')).toHaveCount(0);

    await page.unroute('**/api/reports/operational');
    await page.route('**/api/reports/operational', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(zeroReport),
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('reports-financial-detail')).toBeVisible();
    await expect(page.getByTestId('reports-financial-detail-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('reports-financial-detail')).toContainText('0');
  });
});
