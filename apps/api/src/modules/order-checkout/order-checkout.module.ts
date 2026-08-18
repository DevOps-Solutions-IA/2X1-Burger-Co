import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { BoldPaymentProvider } from '../sofia/payments/bold-payment.provider';
import { CanonicalPaymentWebhookService } from './canonical-payment-webhook.service';
import { CanonicalPublicPaymentsController } from './canonical-public-payments.controller';
import { CanonicalPaymentWebhooksController } from './canonical-payment-webhooks.controller';
import { CheckoutPolicyService } from './checkout-policy.service';
import { KitchenEligibilityService } from './kitchen-eligibility.service';
import { OrderCheckoutService } from './order-checkout.service';
import { PaymentOrchestrationService } from './payment-orchestration.service';
import { PaymentPublicReferenceService } from './payment-public-reference.service';
import { PaymentWebhookRecoveryWorker } from './payment-webhook-recovery.worker';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';
import { AdminPaymentReadController } from './admin-payment-read.controller';
import { AdminPaymentReadService } from './admin-payment-read.service';
import { SofiaCreateOrderCommandHandler } from './sofia-create-order-command.handler';

@Module({
  imports: [OrdersModule],
  controllers: [CanonicalPublicPaymentsController, CanonicalPaymentWebhooksController, AdminPaymentReadController],
  providers: [
    AdminPaymentReadService,
    PrismaOrderCheckoutRepository,
    CheckoutPolicyService,
    Phase5RuntimeGate,
    BoldPaymentProvider,
    OrderCheckoutService,
    PaymentPublicReferenceService,
    PaymentOrchestrationService,
    CanonicalPaymentWebhookService,
    PaymentWebhookRecoveryWorker,
    KitchenEligibilityService,
    // Provided here (not exported to / imported by secure-command) so CommandHandlerRegistry can
    // resolve it lazily via ModuleRef#get(..., { strict: false }) without a circular module import
    // -- see sofia-create-order-command.handler.ts for the full explanation.
    SofiaCreateOrderCommandHandler,
  ],
  exports: [
    OrderCheckoutService,
    PaymentOrchestrationService,
    CanonicalPaymentWebhookService,
    KitchenEligibilityService,
    Phase5RuntimeGate,
  ],
})
export class OrderCheckoutModule {}
