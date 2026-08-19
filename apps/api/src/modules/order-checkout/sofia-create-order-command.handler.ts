import { Injectable } from '@nestjs/common';
import { SofiaPaymentPreference } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { SecureCommandError } from '../secure-command/secure-command.errors';
import type { CommandHandlerResult, CommandRecord } from '../secure-command/secure-command.types';
import { KitchenEligibilityService } from './kitchen-eligibility.service';
import { checkoutConflict } from './order-checkout.errors';
import { OrderCheckoutService } from './order-checkout.service';
import { PaymentOrchestrationService } from './payment-orchestration.service';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';

/**
 * Real execution logic behind the SOFIA_CREATE_ORDER SecureCommand type.
 *
 * Wiring note (module cycle avoidance): OrderCheckoutModule already transitively imports
 * SecureCommandModule (OrderCheckoutModule -> OrdersModule -> NotificationsModule ->
 * SecureCommandModule), so SecureCommandModule cannot statically `imports: [OrderCheckoutModule]`
 * back without creating a circular NestJS module graph. This handler is therefore NOT
 * constructor-injected into CommandHandlerRegistry (unlike WhatsappOutboundCommandHandler, which
 * lives entirely inside SofiaModule with no such cycle). Instead, CommandHandlerRegistry resolves
 * it lazily at execute-time via `ModuleRef#get(SofiaCreateOrderCommandHandler, { strict: false })`,
 * which performs a global, import-graph-independent lookup and requires zero new module `imports`
 * edges anywhere in the app. See command-handler.registry.ts.
 *
 * Composes ONLY existing canonical authorities -- never a parallel order model:
 *  - OrderCheckoutService.createFromConfirmedSofiaDraft (canonical checkout: audited, idempotent,
 *    re-validates the draft's CONFIRMED status/version/hash chain against the database itself).
 *  - KitchenEligibilityService.createOrderTicket (kitchen-eligibility policy dispatch +
 *    OrdersService.createFromCanonicalCheckout: the real, locked, idempotent OrderTicket authority).
 *    Used only for the OFFLINE preferences (CASH_ON_DELIVERY / PAY_AT_PICKUP), unchanged.
 *  - PaymentOrchestrationService.createOnlinePaymentLink (canonical PaymentIntent + PaymentLink
 *    authority: idempotent, transactional, derives PaymentIntent.amount from the canonical
 *    checkout.total itself -- never accepts an amount from this handler). Used only for the
 *    ONLINE preference, per the frozen ONLINE state machine (see OrderCreationResultDto in
 *    sofia-domain-contracts.ts): CONFIRMED_DRAFT -> ORDER_CHECKOUT -> PAYMENT_INTENT ->
 *    PAYMENT_LINK -> BOLD -> AUTHORITATIVE_WEBHOOK_SUCCEEDED -> PAYMENT_VERIFIED ->
 *    KITCHEN_ELIGIBLE -> ORDER_CREATED.
 *
 * ONLINE branch: never calls KitchenEligibilityService.createOrderTicket (never opens the
 * ORDER_CREATION/KITCHEN governance gates -- Payment Orchestration is its own independent,
 * owner-governed capability and must not be coupled to those). After the payment link is created
 * (or idempotently replayed), this handler surfaces the deterministic, non-error AWAITING_PAYMENT
 * outcome by throwing the exact `KITCHEN_NOT_ELIGIBLE` conflict code that
 * SofiaOrderCreationAdapter.awaitingPaymentReasonCode (sofia-contract.adapters.ts) already
 * recognizes and resolves to `{ type: 'AWAITING_PAYMENT' }` -- never thrown as a genuine failure,
 * never audited as SOFIA_ORDER_CREATION_BLOCKED. It is trivially true here: Kitchen can never be
 * eligible for a checkout whose online payment has not yet been authoritatively verified, and no
 * OrderTicket is created by this branch.
 *
 * Never marks a payment PAID, never transitions kitchen state, never assigns delivery, never
 * mutates stock/cash directly -- those remain the exclusive authority of their own domains.
 */
@Injectable()
export class SofiaCreateOrderCommandHandler {
  constructor(
    private readonly checkout: OrderCheckoutService,
    private readonly kitchenEligibility: KitchenEligibilityService,
    private readonly paymentOrchestration: PaymentOrchestrationService,
    private readonly repository: PrismaOrderCheckoutRepository,
  ) {}

  async execute(command: CommandRecord): Promise<CommandHandlerResult> {
    if (command.commandType !== 'SOFIA_CREATE_ORDER') {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    const draftId = command.targetId;
    if (!draftId) {
      throw new SecureCommandError('SOFIA_COMMAND_TARGET_CONFLICT');
    }

    // Never trust the command's target/expectedVersion beyond binding to the right draft id: the
    // authoritative version/hash chain is always re-read fresh from the confirmed draft record.
    const draft = await this.repository.requiredConfirmedSofiaDraftBinding(draftId);
    if (command.expectedVersion !== null && command.expectedVersion !== String(draft.version)) {
      throw new SecureCommandError('SOFIA_COMMAND_TARGET_CONFLICT');
    }

    const checkoutView = await this.checkout.createFromConfirmedSofiaDraft({
      draftId: draft.id,
      expectedDraftVersion: draft.version,
      expectedDraftHash: draft.draftHash,
      confirmationHash: draft.confirmationHash,
      idempotencyKey: command.idempotencyKey,
      actorId: command.actorId,
    });

    if (checkoutView.paymentPreference === SofiaPaymentPreference.ONLINE) {
      // Reuses PaymentOrchestrationService.createOnlinePaymentLink verbatim (idempotent,
      // transactional, PaymentIntent.amount always derived from checkout.total) -- never
      // duplicates PaymentIntent creation logic. Never calls createOrderTicket: no OrderTicket
      // exists yet, and the ORDER_CREATION/KITCHEN gates are never opened by this branch.
      await this.paymentOrchestration.createOnlinePaymentLink({
        checkoutId: checkoutView.id,
        idempotencyKey: command.idempotencyKey,
        actorId: command.actorId,
      });
      // See class doc: the deterministic, non-error AWAITING_PAYMENT outcome of the frozen ONLINE
      // state machine. Reuses the exact conflict code SofiaOrderCreationAdapter already recognizes
      // and resolves without throwing -- never a genuine failure, never a policy/governance block.
      checkoutConflict('KITCHEN_NOT_ELIGIBLE');
    }

    const actor = await this.systemActor();
    const result = await this.kitchenEligibility.createOrderTicket(checkoutView.id, actor);

    return {
      resultCode: result.replayed ? 'SOFIA_ORDER_CREATION_REPLAYED' : 'SOFIA_ORDER_CREATED',
      payload: {
        checkoutId: checkoutView.id,
        orderTicketId: result.order.id,
        orderNumber: result.order.number,
        replayed: Boolean(result.replayed),
      },
      domainReferenceIds: [checkoutView.id, result.order.id],
    };
  }

  private async systemActor(): Promise<AuthUser> {
    const resolved = await this.repository.sofiaOrderCreationSystemActor();
    return {
      sub: resolved.sub,
      email: resolved.email,
      fullName: resolved.fullName,
      sessionVersion: 0,
      roles: ['system'],
      permissions: [],
    };
  }
}
