import { OrderTicketType, PaymentIntentStatus, SofiaPaymentPreference } from '@prisma/client';
import { KitchenEligibilityService } from './kitchen-eligibility.service';

describe('KitchenEligibilityService payment continuation', () => {
  function harness() {
    const checkout = {
      id: 'checkout-1',
      fulfillment: OrderTicketType.DELIVERY,
      paymentPreference: SofiaPaymentPreference.ONLINE,
      paymentIntents: [{ status: PaymentIntentStatus.SUCCEEDED }],
    };
    const repository = {
      requiredCheckout: jest.fn().mockResolvedValue(checkout),
      successfulPaymentCount: jest.fn().mockResolvedValue(1),
      markKitchenEligible: jest.fn().mockResolvedValue({ ...checkout, status: 'KITCHEN_ELIGIBLE' }),
    };
    const policy = { kitchenEligible: jest.fn().mockReturnValue(true) };
    const gate = {
      decision: jest.fn()
        .mockResolvedValueOnce({ enabled: false, capability: 'KITCHEN', blockers: ['CAPABILITY_DISABLED'] })
        .mockResolvedValue({ enabled: true, capability: 'KITCHEN', blockers: [] }),
      assertEnabled: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new KitchenEligibilityService(
      repository as never,
      policy as never,
      gate as never,
      {} as never,
      audit as never,
    );
    return { service, repository, policy, gate, audit };
  }

  it('defers without mutation while the independent kitchen gate is disabled', async () => {
    const { service, repository, audit } = harness();

    await expect(service.continueAfterVerifiedPayment('checkout-1', null)).resolves.toEqual({
      state: 'DEFERRED_DISABLED',
      reasonCode: 'KITCHEN_GATE_DISABLED',
      blockers: ['CAPABILITY_DISABLED'],
    });
    expect(repository.requiredCheckout).not.toHaveBeenCalled();
    expect(repository.markKitchenEligible).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('resumes the same checkout idempotently once kitchen is enabled', async () => {
    const { service, repository, audit } = harness();

    await service.continueAfterVerifiedPayment('checkout-1', null);
    await expect(service.continueAfterVerifiedPayment('checkout-1', null)).resolves.toMatchObject({
      state: 'APPLIED',
      checkout: { id: 'checkout-1', status: 'KITCHEN_ELIGIBLE' },
    });

    expect(repository.requiredCheckout).toHaveBeenCalledWith('checkout-1');
    expect(repository.successfulPaymentCount).toHaveBeenCalledWith('checkout-1');
    expect(repository.markKitchenEligible).toHaveBeenCalledWith('checkout-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CHECKOUT_KITCHEN_ELIGIBLE',
      entityId: 'checkout-1',
    }));
  });
});
