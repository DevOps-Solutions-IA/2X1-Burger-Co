import { Injectable } from '@nestjs/common';
import { PaymentIntentStatus } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../audit/audit.service';
import { CheckoutPolicyService } from './checkout-policy.service';
import { checkoutConflict } from './order-checkout.errors';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';

@Injectable()
export class KitchenEligibilityService {
  constructor(
    private readonly repository: PrismaOrderCheckoutRepository,
    private readonly policy: CheckoutPolicyService,
    private readonly gate: Phase5RuntimeGate,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  async continueAfterVerifiedPayment(checkoutId: string, actorId: string | null) {
    const gate = await this.gate.decision('KITCHEN');
    if (!gate.enabled) {
      return {
        state: 'DEFERRED_DISABLED' as const,
        reasonCode: 'KITCHEN_GATE_DISABLED' as const,
        blockers: gate.blockers,
      };
    }
    const checkout = await this.evaluateAndMarkAuthorized(checkoutId, actorId);
    return { state: 'APPLIED' as const, checkout };
  }

  async evaluateAndMark(checkoutId: string, actorId: string | null) {
    await this.gate.assertEnabled('KITCHEN');
    return this.evaluateAndMarkAuthorized(checkoutId, actorId);
  }

  private async evaluateAndMarkAuthorized(checkoutId: string, actorId: string | null) {
    const checkout = await this.repository.requiredCheckout(checkoutId);
    const latest = checkout.paymentIntents[0] ?? null;
    const successes = await this.repository.successfulPaymentCount(checkout.id);
    const eligible = this.policy.kitchenEligible({
      fulfillment: checkout.fulfillment,
      preference: checkout.paymentPreference,
      successfulOnlinePayments: successes,
      latestPaymentStatus: latest?.status ?? null,
    });
    if (!eligible || latest?.status === PaymentIntentStatus.UNKNOWN_RESULT) checkoutConflict('KITCHEN_NOT_ELIGIBLE');
    const updated = await this.repository.markKitchenEligible(checkout.id);
    await this.audit.log({
      userId: actorId,
      action: 'CHECKOUT_KITCHEN_ELIGIBLE',
      module: 'order-checkout',
      entity: 'order_checkout',
      entityId: checkout.id,
      result: 'SUCCESS',
      reasonCode: checkout.paymentPreference,
      newValues: { fulfillment: checkout.fulfillment, paymentPreference: checkout.paymentPreference },
    });
    return updated;
  }

  async createOrderTicket(checkoutId: string, actor: AuthUser) {
    await this.gate.assertEnabled('ORDER_CREATION');
    await this.evaluateAndMark(checkoutId, actor.sub);
    return this.orders.createFromCanonicalCheckout(checkoutId, actor);
  }
}
