import { BadRequestException, Injectable } from '@nestjs/common';
import type { CommercialConversationState, CommercialPaymentPreference } from './commercial.types';

@Injectable()
export class CommercialPolicyService {
  validatePayment(fulfillment: CommercialConversationState['fulfillment'], payment: CommercialPaymentPreference) {
    if (payment === 'UNKNOWN' || fulfillment === null) return;
    const valid = fulfillment === 'TAKEAWAY'
      ? ['ONLINE', 'PAY_AT_PICKUP'].includes(payment)
      : ['ONLINE', 'CASH_ON_DELIVERY'].includes(payment);
    if (!valid) throw new BadRequestException({ code: 'SOFIA_PAYMENT_FULFILLMENT_INVALID' });
  }

  missing(state: CommercialConversationState) {
    const missing: string[] = [];
    if (!state.items.length) missing.push('product');
    if (!state.fulfillment) missing.push('fulfillment');
    if (state.paymentPreference === 'UNKNOWN') missing.push('paymentPreference');
    if (state.fulfillment === 'DELIVERY' && !state.address) missing.push('deliveryAddress');
    return missing;
  }

  questionPurpose(missing: string[]) {
    if (missing.includes('product')) return 'PRODUCT' as const;
    if (missing.includes('fulfillment')) return 'FULFILLMENT' as const;
    if (missing.includes('paymentPreference')) return 'PAYMENT' as const;
    if (missing.includes('deliveryAddress')) return 'DELIVERY_ADDRESS' as const;
    return 'CONFIRM_ORDER' as const;
  }
}
