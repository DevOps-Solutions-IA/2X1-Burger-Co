import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCustomerAutomation, operationalReportSchema } from './contracts';

const completeReport = {
  period: { start: '2026-08-13', end: '2026-08-13' },
  journey: { status: 'OPEN' },
  cash: { expectedAmount: 0 },
  sales: { total: 0, count: 0, itemsSold: 0, byPaymentMethod: [], byChannel: [], bestSellers: [] },
  purchases: { total: 0, count: 0 },
  expenses: { total: 0, count: 0 },
  metrics: { costOfSales: 0, grossProfit: 0, netProfit: 0 },
  replenishment: {
    lowStock: [], criticalStock: [], outOfStock: [],
    productLowStock: [], productCriticalStock: [], productOutOfStock: [],
  },
  metadata: { source: 'domain', generatedAt: '2026-08-13T00:00:00.000Z', snapshotId: null },
};

test('overview accepts explicit authoritative empty arrays', () => {
  assert.equal(operationalReportSchema.safeParse(completeReport).success, true);
});

test('overview rejects missing fields instead of rendering false empty states', () => {
  const missingBestSellers = structuredClone(completeReport) as Record<string, unknown>;
  delete (missingBestSellers.sales as Record<string, unknown>).bestSellers;
  assert.equal(operationalReportSchema.safeParse(missingBestSellers).success, false);

  const missingCriticalStock = structuredClone(completeReport) as Record<string, unknown>;
  delete (missingCriticalStock.replenishment as Record<string, unknown>).criticalStock;
  assert.equal(operationalReportSchema.safeParse(missingCriticalStock).success, false);
});

test('effective automation status includes productionEnabled', () => {
  assert.equal(describeCustomerAutomation({
    productionEnabled: false,
    realSendingEnabled: false,
    autoReplyEnabled: false,
    autoSafeEnabled: false,
  }).state, 'blocked');

  const enabled = describeCustomerAutomation({
    productionEnabled: true,
    realSendingEnabled: false,
    autoReplyEnabled: false,
    autoSafeEnabled: false,
  });
  assert.equal(enabled.state, 'degraded');
  assert.match(enabled.details, /Producción habilitada/);
});
