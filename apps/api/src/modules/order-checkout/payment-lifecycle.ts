import { PaymentIntentStatus } from '@prisma/client';
import { checkoutConflict } from './order-checkout.errors';

const TRANSITIONS: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  CREATED: [PaymentIntentStatus.LINK_READY, PaymentIntentStatus.PENDING, PaymentIntentStatus.FAILED, PaymentIntentStatus.EXPIRED, PaymentIntentStatus.CANCELLED, PaymentIntentStatus.UNKNOWN_RESULT, PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  LINK_READY: [PaymentIntentStatus.PENDING, PaymentIntentStatus.FAILED, PaymentIntentStatus.EXPIRED, PaymentIntentStatus.CANCELLED, PaymentIntentStatus.UNKNOWN_RESULT, PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  PENDING: [PaymentIntentStatus.SUCCEEDED, PaymentIntentStatus.FAILED, PaymentIntentStatus.EXPIRED, PaymentIntentStatus.CANCELLED, PaymentIntentStatus.UNKNOWN_RESULT, PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  SUCCEEDED: [PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  FAILED: [PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  EXPIRED: [PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  CANCELLED: [PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  UNKNOWN_RESULT: [PaymentIntentStatus.FINANCIAL_REVIEW_REQUIRED],
  FINANCIAL_REVIEW_REQUIRED: [],
};

export function assertPaymentTransition(from: PaymentIntentStatus, to: PaymentIntentStatus) {
  if (!TRANSITIONS[from].includes(to)) checkoutConflict('PAYMENT_INTENT_CONFLICT');
}
