import { OperationalAlertPolicy } from './operational-alert-policy';
import type { OperationalBacklogSnapshot } from './operational-backlog.service';

describe('OperationalAlertPolicy', () => {
  const policy = new OperationalAlertPolicy();

  it('alerts on stale leases, failed delivery and unresolved financial truth', () => {
    const alerts = policy.evaluate(snapshot({
      notifications: { ...snapshot().notifications, expiredLeases: 1, failed: 2 },
      paymentWebhooks: { ...snapshot().paymentWebhooks, expiredLeases: 1 },
      secureCommands: { ...snapshot().secureCommands, unknownResult: 1 },
      commerce: { ...snapshot().commerce, paymentUnknownResult: 1 },
    }));

    expect(alerts.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'NOTIFICATION_LEASE_EXPIRED',
      'NOTIFICATION_FAILED',
      'PAYMENT_WEBHOOK_LEASE_EXPIRED',
      'SECURE_COMMAND_UNKNOWN_RESULT',
      'PAYMENT_UNKNOWN_RESULT',
    ]));
    expect(alerts.every((alert) => !JSON.stringify(alert).match(/phone|customerId|orderId|eventId/i))).toBe(true);
  });

  it('does not alert for an empty production-ready-but-disabled backlog', () => {
    expect(policy.evaluate(snapshot())).toEqual([]);
  });

  it('reports collection failure without including an exception payload', () => {
    expect(policy.evaluate(snapshot({ available: false }))).toEqual([
      expect.objectContaining({ code: 'OPERATIONAL_METRICS_UNAVAILABLE', severity: 'HIGH' }),
    ]);
  });
});

function snapshot(overrides: Partial<OperationalBacklogSnapshot> = {}): OperationalBacklogSnapshot {
  return {
    available: true,
    collectedAt: '2026-08-09T12:00:00.000Z',
    notifications: {
      active: 0,
      pending: 0,
      claimed: 0,
      commandPending: 0,
      dispatched: 0,
      failed: 0,
      unknownResult: 0,
      expiredLeases: 0,
      retryReady: 0,
      oldestActiveAgeSeconds: 0,
    },
    paymentWebhooks: {
      active: 0,
      retryReady: 0,
      expiredLeases: 0,
      financialReviewRequired: 0,
      invalidRecent: 0,
      oldestActiveAgeSeconds: 0,
    },
    whatsappInbound: {
      active: 0,
      retryReady: 0,
      expiredLeases: 0,
      attemptsExhausted: 0,
      missingDeterministicResult: 0,
      oldestActiveAgeSeconds: 0,
    },
    secureCommands: {
      active: 0,
      failed: 0,
      retryReady: 0,
      expiredLeases: 0,
      unknownResult: 0,
      oldestActiveAgeSeconds: 0,
    },
    commerce: {
      checkoutPaymentPending: 0,
      checkoutFinancialReviewRequired: 0,
      paymentPending: 0,
      paymentUnknownResult: 0,
      paymentFinancialReviewRequired: 0,
    },
    ...overrides,
  };
}
