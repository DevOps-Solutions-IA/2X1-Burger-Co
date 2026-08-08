import { Injectable } from '@nestjs/common';
import { OrderTicketType, PaymentIntentStatus, SofiaPaymentPreference } from '@prisma/client';
import { checkoutConflict } from './order-checkout.errors';

export function assertCheckoutPaymentCombination(
  fulfillment: OrderTicketType,
  preference: SofiaPaymentPreference,
) {
  const valid =
    (fulfillment === OrderTicketType.DELIVERY &&
      (preference === SofiaPaymentPreference.ONLINE ||
        preference === SofiaPaymentPreference.CASH_ON_DELIVERY)) ||
    (fulfillment === OrderTicketType.TAKEAWAY &&
      (preference === SofiaPaymentPreference.ONLINE ||
        preference === SofiaPaymentPreference.PAY_AT_PICKUP));
  if (!valid) checkoutConflict('CHECKOUT_PAYMENT_COMBINATION_INVALID');
}

@Injectable()
export class CheckoutPolicyService {
  assertPaymentCombination(fulfillment: OrderTicketType, preference: SofiaPaymentPreference) {
    assertCheckoutPaymentCombination(fulfillment, preference);
  }

  kitchenEligible(input: {
    fulfillment: OrderTicketType;
    preference: SofiaPaymentPreference;
    successfulOnlinePayments: number;
    latestPaymentStatus: PaymentIntentStatus | null;
  }) {
    this.assertPaymentCombination(input.fulfillment, input.preference);
    if (input.preference === SofiaPaymentPreference.ONLINE) {
      return input.successfulOnlinePayments === 1 && input.latestPaymentStatus === PaymentIntentStatus.SUCCEEDED;
    }
    return (
      input.preference === SofiaPaymentPreference.CASH_ON_DELIVERY ||
      input.preference === SofiaPaymentPreference.PAY_AT_PICKUP
    );
  }
}
