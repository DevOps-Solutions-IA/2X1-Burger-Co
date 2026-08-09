import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const CHECKOUT_ERROR_CODES = [
  'CHECKOUT_NOT_FOUND',
  'CHECKOUT_IDEMPOTENCY_CONFLICT',
  'SOFIA_DRAFT_BINDING_INVALID',
  'SOFIA_DRAFT_NOT_CONFIRMABLE',
  'CHECKOUT_PAYMENT_COMBINATION_INVALID',
  'CHECKOUT_OPERATION_DISABLED',
  'PAYMENT_INTENT_CONFLICT',
  'PAYMENT_UNKNOWN_RESULT',
  'PAYMENT_FINANCIAL_REVIEW_REQUIRED',
  'KITCHEN_NOT_ELIGIBLE',
] as const;

export type CheckoutErrorCode = (typeof CHECKOUT_ERROR_CODES)[number];

export function checkoutConflict(code: CheckoutErrorCode): never {
  throw new ConflictException({ code });
}

export function checkoutForbidden(code: CheckoutErrorCode): never {
  throw new ForbiddenException({ code });
}

export function checkoutNotFound(): never {
  throw new NotFoundException({ code: 'CHECKOUT_NOT_FOUND' });
}

