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
    const systemActor = { sub: 'sofia-order-creation-system', email: 'sofia-order-creation-system@system.invalid', fullName: 'SOFIA Order Creation' };
    const repository = {
      requiredCheckout: jest.fn().mockResolvedValue(checkout),
      successfulPaymentCount: jest.fn().mockResolvedValue(1),
      markKitchenEligible: jest.fn().mockResolvedValue({ ...checkout, status: 'KITCHEN_ELIGIBLE' }),
      sofiaOrderCreationSystemActor: jest.fn().mockResolvedValue(systemActor),
    };
    const policy = { kitchenEligible: jest.fn().mockReturnValue(true) };
    const gate = {
      decision: jest.fn()
        .mockResolvedValueOnce({ enabled: false, capability: 'KITCHEN', blockers: ['CAPABILITY_DISABLED'] })
        .mockResolvedValue({ enabled: true, capability: 'KITCHEN', blockers: [] }),
      assertEnabled: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const orders = {
      createFromCanonicalCheckout: jest.fn().mockResolvedValue({ order: { id: 'order-1', number: 'T-1' }, replayed: false }),
    };
    const service = new KitchenEligibilityService(
      repository as never,
      policy as never,
      gate as never,
      orders as never,
      audit as never,
    );
    return { service, repository, policy, gate, audit, orders, systemActor };
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

  it('closes the loop into the canonical OrderTicket authority using the resolved SOFIA system actor, never a parallel creator', async () => {
    const { service, repository, orders, systemActor } = harness();
    await service.continueAfterVerifiedPayment('checkout-1', null); // consumes the DEFERRED_DISABLED mock call

    const result = await service.continueAfterVerifiedPayment('checkout-1', null);

    expect(repository.sofiaOrderCreationSystemActor).toHaveBeenCalledTimes(1);
    expect(orders.createFromCanonicalCheckout).toHaveBeenCalledTimes(1);
    expect(orders.createFromCanonicalCheckout).toHaveBeenCalledWith('checkout-1', expect.objectContaining({
      sub: systemActor.sub,
      email: systemActor.email,
      roles: ['system'],
    }));
    // Order creation must never happen before the checkout is actually marked eligible.
    const markCallOrder = repository.markKitchenEligible.mock.invocationCallOrder[0]!;
    const createCallOrder = orders.createFromCanonicalCheckout.mock.invocationCallOrder[0]!;
    expect(markCallOrder).toBeLessThan(createCallOrder);
    expect(result).toMatchObject({ state: 'APPLIED', order: { id: 'order-1', number: 'T-1' }, replayed: false });
  });

  it('never invokes order creation while the kitchen gate is independently disabled', async () => {
    const { service, orders, repository } = harness();

    await service.continueAfterVerifiedPayment('checkout-1', null);

    expect(orders.createFromCanonicalCheckout).not.toHaveBeenCalled();
    expect(repository.sofiaOrderCreationSystemActor).not.toHaveBeenCalled();
  });
});
