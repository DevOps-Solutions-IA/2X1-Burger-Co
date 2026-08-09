import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';
import { SofiaDevPaymentsController } from './sofia-payment-webhooks.controller';
import { SofiaPublicPaymentsController } from './sofia-public-payments.controller';

function expectCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error('Expected action to throw.');
  } catch (error) {
    expect((error as { getResponse?: () => unknown }).getResponse?.()).toEqual(
      expect.objectContaining({ code }),
    );
  }
}

describe('Sofia legacy payment retirement', () => {
  const service = new SofiaPaymentLinkService();

  beforeEach(() => jest.clearAllMocks());

  it('rejects every legacy payment mutation before persistence or provider work', () => {
    const mutations = [
      () => service.getPaymentSettings(),
      () => service.updatePaymentSettings({ onlinePaymentsEnabled: true }, 'actor'),
      () => service.generateOperationalLink('ticket-1', 'actor'),
      () => service.getPublicPayment('legacy-token'),
      () => service.selectPublicPaymentMethod('legacy-token', 'ONLINE'),
      () => service.updateManualPaymentStatus('ticket-1', { status: 'FAILED' }, 'actor'),
      () => service.processPaymentWebhook('bold', { status: 'APPROVED' }, {}),
      () => service.simulateMockWebhook({ status: 'PAID' }),
    ];

    for (const mutation of mutations) {
      expectCode(mutation, 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED');
    }
  });

  it('does not expose legacy payment state as an operational read authority', () => {
    expectCode(() => service.getOperationalLink('ticket-1'), 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED');
  });

  it('hard-disables both retained legacy controllers without invoking a service', () => {
    const publicController = new SofiaPublicPaymentsController();
    const devController = new SofiaDevPaymentsController();

    expectCode(() => publicController.getPayment('legacy-token'), 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED');
    expectCode(() => publicController.selectPaymentMethod('legacy-token'), 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED');
    expectCode(() => devController.simulateMockWebhook(), 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED');
  });

  it('keeps the web payment page on the canonical Phase 5 API only', () => {
    const page = readFileSync(
      resolve(__dirname, '../../../../web/src/app/pagos/[token]/page.tsx'),
      'utf8',
    );

    expect(page).toContain('/public/payments/${token}');
    expect(page).toContain('/public/payments/${token}/start-online');
    expect(page).not.toContain('/public/sofia/payments');
    expect(page).not.toContain("type PaymentBackend = 'canonical' | 'legacy'");
    expect(page).not.toContain("paymentStatus === 'PAID'");
    expect(page).not.toContain('Pago recibido');
  });
});
