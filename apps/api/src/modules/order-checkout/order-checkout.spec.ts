import { ForbiddenException } from '@nestjs/common';
import { OrderTicketType, PaymentIntentStatus, SofiaPaymentPreference } from '@prisma/client';
import { CheckoutPolicyService } from './checkout-policy.service';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';
import { assertPaymentTransition } from './payment-lifecycle';

describe('Phase 5 checkout policy', () => {
  const policy = new CheckoutPolicyService();

  it.each([
    [OrderTicketType.DELIVERY, SofiaPaymentPreference.ONLINE],
    [OrderTicketType.DELIVERY, SofiaPaymentPreference.CASH_ON_DELIVERY],
    [OrderTicketType.TAKEAWAY, SofiaPaymentPreference.ONLINE],
    [OrderTicketType.TAKEAWAY, SofiaPaymentPreference.PAY_AT_PICKUP],
  ])('accepts %s with %s', (fulfillment, preference) => {
    expect(() => policy.assertPaymentCombination(fulfillment, preference)).not.toThrow();
  });

  it.each([
    [OrderTicketType.DELIVERY, SofiaPaymentPreference.PAY_AT_PICKUP],
    [OrderTicketType.TAKEAWAY, SofiaPaymentPreference.CASH_ON_DELIVERY],
    [OrderTicketType.DINE_IN, SofiaPaymentPreference.ONLINE],
    [OrderTicketType.COUNTER, SofiaPaymentPreference.ONLINE],
    [OrderTicketType.DELIVERY, SofiaPaymentPreference.UNKNOWN],
  ])('rejects %s with %s', (fulfillment, preference) => {
    expect(() => policy.assertPaymentCombination(fulfillment, preference)).toThrow();
  });

  it('requires one verified online success but allows explicit cash obligations', () => {
    expect(policy.kitchenEligible({ fulfillment: OrderTicketType.DELIVERY, preference: SofiaPaymentPreference.ONLINE, successfulOnlinePayments: 1, latestPaymentStatus: PaymentIntentStatus.SUCCEEDED })).toBe(true);
    expect(policy.kitchenEligible({ fulfillment: OrderTicketType.DELIVERY, preference: SofiaPaymentPreference.ONLINE, successfulOnlinePayments: 0, latestPaymentStatus: PaymentIntentStatus.PENDING })).toBe(false);
    expect(policy.kitchenEligible({ fulfillment: OrderTicketType.DELIVERY, preference: SofiaPaymentPreference.CASH_ON_DELIVERY, successfulOnlinePayments: 0, latestPaymentStatus: null })).toBe(true);
    expect(policy.kitchenEligible({ fulfillment: OrderTicketType.TAKEAWAY, preference: SofiaPaymentPreference.PAY_AT_PICKUP, successfulOnlinePayments: 0, latestPaymentStatus: null })).toBe(true);
  });
});

describe('Phase 5 payment lifecycle', () => {
  it('allows signed terminal provider truth to resolve an unknown result', () => {
    expect(() => assertPaymentTransition(PaymentIntentStatus.CREATED, PaymentIntentStatus.LINK_READY)).not.toThrow();
    expect(() => assertPaymentTransition(PaymentIntentStatus.LINK_READY, PaymentIntentStatus.PENDING)).not.toThrow();
    expect(() => assertPaymentTransition(PaymentIntentStatus.PENDING, PaymentIntentStatus.SUCCEEDED)).not.toThrow();
    expect(() => assertPaymentTransition(PaymentIntentStatus.PENDING, PaymentIntentStatus.UNKNOWN_RESULT)).not.toThrow();
    expect(() => assertPaymentTransition(PaymentIntentStatus.UNKNOWN_RESULT, PaymentIntentStatus.SUCCEEDED)).not.toThrow();
    expect(() => assertPaymentTransition(PaymentIntentStatus.UNKNOWN_RESULT, PaymentIntentStatus.FAILED)).not.toThrow();
    expect(() => assertPaymentTransition(PaymentIntentStatus.UNKNOWN_RESULT, PaymentIntentStatus.PENDING)).toThrow();
    expect(() => assertPaymentTransition(PaymentIntentStatus.SUCCEEDED, PaymentIntentStatus.PENDING)).toThrow();
  });
});

describe('Phase 5 runtime gate', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it('fails closed in production even when every flag is true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    const gate = new Phase5RuntimeGate({ findRuntimeSafetySettings: jest.fn().mockResolvedValue([]) } as never);
    await expect(gate.assertEnabled('ORDER_CREATION')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires explicit test authorization and honors governance pause', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    const gate = new Phase5RuntimeGate({ findRuntimeSafetySettings: jest.fn().mockResolvedValue([{ key: 'SOFIA_GLOBAL_PAUSED', value: { paused: true } }]) } as never);
    await expect(gate.assertEnabled('KITCHEN')).rejects.toMatchObject({ response: expect.objectContaining({ blockers: expect.arrayContaining(['GOVERNANCE_PAUSED']) }) });
  });
});
