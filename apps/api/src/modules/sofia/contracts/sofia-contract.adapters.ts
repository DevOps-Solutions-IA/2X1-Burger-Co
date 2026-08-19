import { ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type {
  CustomerResolutionService,
  OrderCreationResultDto,
  OrderCreationService,
  OrderDraftCommand,
  OrderDraftDto,
  OrderDraftService,
  PaymentReadService,
  SofiaActorContext,
} from '../../../application/contracts/sofia-domain-contracts';
import { AuditService } from '../../audit/audit.service';
import { SecureCommandError } from '../../secure-command/secure-command.errors';
import { SecureCommandService } from '../../secure-command/secure-command.service';
import { SofiaCrmService } from '../crm/sofia-crm.service';
import { TrustedCrmCustomerResolutionCapability } from '../crm/crm-customer-resolution.capability';
import { SofiaPaymentLinkService } from '../sofia-payment-link.service';
import { SofiaService } from '../sofia.service';

type DraftRecord = {
  id: string;
  status: string;
  updatedAt: Date;
  version: number;
  draftHash: string | null;
  confirmationHash: string | null;
  fulfillment: string | null;
  expiresAt: Date | null;
  itemsSnapshot: unknown;
  missingFields: unknown;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryNeighborhood: string | null;
  subtotal: unknown;
  deliveryFee: unknown;
  total: unknown;
};

function draftDto(draft: DraftRecord): OrderDraftDto {
  return {
    id: draft.id,
    status: draft.status,
    version: new Date(draft.updatedAt).toISOString(),
    itemsSnapshot: Array.isArray(draft.itemsSnapshot) ? draft.itemsSnapshot : [],
    missingFields: Array.isArray(draft.missingFields) ? draft.missingFields.map(String) : null,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    deliveryAddress: draft.deliveryAddress,
    deliveryNeighborhood: draft.deliveryNeighborhood,
    subtotal: Number(draft.subtotal),
    deliveryFee: Number(draft.deliveryFee),
    total: Number(draft.total),
  };
}

@Injectable()
export class SofiaOrderDraftAdapter implements OrderDraftService {
  constructor(private readonly sofia: SofiaService) {}
  async create(input: OrderDraftCommand, actor: SofiaActorContext) { return draftDto(await this.sofia.createDraft(input, actor.actorId)); }
  async update(draftId: string, expectedVersion: string, input: OrderDraftCommand, actor: SofiaActorContext) {
    await this.assertVersion(draftId, expectedVersion);
    return draftDto(await this.sofia.updateDraft(draftId, input, actor.actorId));
  }
  async confirm(draftId: string, expectedVersion: string, actor: SofiaActorContext) {
    await this.assertVersion(draftId, expectedVersion);
    return draftDto(await this.sofia.confirmDraft(draftId, actor.actorId));
  }

  private async assertVersion(draftId: string, expectedVersion: string) {
    const current = await this.sofia.findDraft(draftId);
    if (current.updatedAt.toISOString() !== expectedVersion) {
      throw new ConflictException({ code: 'SOFIA_DRAFT_VERSION_CONFLICT' });
    }
  }
}

/**
 * Governed bridge: SofiaOrderDraft (CONFIRMED) -> SecureCommand(SOFIA_CREATE_ORDER) ->
 * canonical OrderCheckout -> canonical OrderTicket.
 *
 * Reuses only existing canonical authority (SecureCommandService, OrderCheckoutService and the
 * canonical Orders authority, both via the SOFIA_CREATE_ORDER handler) -- never a parallel order
 * model. This file itself never references the Orders module directly (Phase 1 architecture
 * boundary, see domain-contracts.architecture.spec.ts): it only ever talks to SecureCommandService.
 * SecureCommandService is resolved lazily via ModuleRef (never constructor-injected) because
 * SecureCommandModule already imports SofiaModule; SofiaModule declaring `imports:
 * [SecureCommandModule]` back would create a circular NestJS module graph. ModuleRef#get(token,
 * { strict: false }) performs a global, import-graph-independent lookup instead.
 *
 * Fails closed at every step: an unconfirmable draft, an unavailable SecureCommandService, or a
 * SecureCommand policy/governance rejection (which is the case in every environment today -- see
 * ORDER_CREATION_POLICY in command-handler.registry.ts, `enabled: false` pending owner activation)
 * all throw, and the caller (sofia-agent.service.ts / CommercialCheckoutService) never has grounds
 * to claim an order was created.
 *
 * One outcome downstream of the handler is NOT a failure and never throws: when the canonical
 * Kitchen-eligibility authority (KitchenEligibilityService, via CheckoutPolicyService.kitchenEligible)
 * rejects with `KITCHEN_NOT_ELIGIBLE` -- the frozen ONLINE state machine's expected shape while a
 * payment has not yet been authoritatively verified (or needs financial reconciliation) -- this
 * adapter resolves to `{ type: 'AWAITING_PAYMENT' }` instead of throwing. Every other failure still
 * throws exactly as before.
 */
@Injectable()
export class SofiaOrderCreationAdapter implements OrderCreationService {
  /** Downstream error codes that represent a legitimate, non-error AWAITING_PAYMENT outcome. */
  private static readonly AWAITING_PAYMENT_CODES = new Set(['KITCHEN_NOT_ELIGIBLE']);

  constructor(
    private readonly sofia: SofiaService,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async createFromSofiaDraft(input: Parameters<OrderCreationService['createFromSofiaDraft']>[0]): Promise<OrderCreationResultDto> {
    if (!/^sofia-draft:[a-zA-Z0-9_-]{8,128}$/.test(input.idempotencyKey)) {
      throw new ConflictException({ code: 'SOFIA_ORDER_IDEMPOTENCY_CONFLICT' });
    }
    const draft = (await this.sofia.findDraft(input.draftId)) as DraftRecord;
    if (input.expectedDraftVersion && draft.updatedAt.toISOString() !== input.expectedDraftVersion) {
      throw new ConflictException({ code: 'SOFIA_DRAFT_VERSION_CONFLICT' });
    }
    const confirmable =
      draft.status === 'CONFIRMED' &&
      Boolean(draft.draftHash) &&
      Boolean(draft.confirmationHash) &&
      Boolean(draft.fulfillment) &&
      Boolean(draft.expiresAt) &&
      (draft.expiresAt as Date).getTime() > Date.now();
    if (!confirmable) {
      await this.blockedAudit(input, 'SOFIA_DRAFT_NOT_CONFIRMABLE');
      throw new ForbiddenException({ code: 'SOFIA_DRAFT_NOT_CONFIRMABLE' });
    }

    const commands = this.resolveSecureCommandService();
    if (!commands) {
      await this.blockedAudit(input, 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE');
      throw new ServiceUnavailableException({ code: 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE' });
    }

    const commandActor = { actorId: input.actor.actorId, actorType: 'SYSTEM' as const, roles: ['system'] };
    const received = await commands.receive({
      commandType: 'SOFIA_CREATE_ORDER',
      idempotencyKey: input.idempotencyKey,
      target: { type: 'SofiaOrderDraft', id: draft.id, expectedVersion: String(draft.version) },
      payload: {},
      expiresAt: new Date(Date.now() + 5 * 60_000),
      actor: commandActor,
      source: 'sofia_order_draft_confirmation',
      scope: 'sofia_order_creation',
    });

    try {
      const executed = await commands.execute({
        commandId: received.command.id,
        actor: commandActor,
        claimOwner: `sofia-order-creation:${draft.id}`,
      });
      const payload = executed.result?.sanitizedPayload as
        | { checkoutId: string; orderTicketId: string; orderNumber: string; replayed: boolean }
        | undefined;
      if (!payload?.checkoutId || !payload.orderTicketId) {
        throw new SecureCommandError('SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE');
      }
      return {
        type: 'ORDER_CREATED',
        checkoutId: payload.checkoutId,
        orderTicketId: payload.orderTicketId,
        orderNumber: payload.orderNumber,
        replayed: executed.replayed || Boolean(payload.replayed),
      };
    } catch (error) {
      const awaitingPaymentCode = this.awaitingPaymentReasonCode(error);
      if (awaitingPaymentCode) {
        // Legitimate ONLINE-flow outcome per the frozen state machine: the checkout exists but
        // Kitchen correctly refuses eligibility until payment is authoritatively verified (or a
        // prior attempt needs financial reconciliation). Never a failure -- never thrown.
        await this.awaitingPaymentAudit(input, awaitingPaymentCode);
        return { type: 'AWAITING_PAYMENT', checkoutId: null, reasonCode: awaitingPaymentCode };
      }
      const code = error instanceof SecureCommandError ? error.code : 'SOFIA_COMMAND_POLICY_BLOCKED';
      await this.blockedAudit(input, code);
      throw new ForbiddenException({ code: 'SOFIA_ORDER_CREATION_BLOCKED' });
    }
  }

  /**
   * Recognizes the specific downstream Kitchen-eligibility conflict that represents a legitimate
   * AWAITING_PAYMENT outcome rather than a real failure. Deliberately narrow: only the exact,
   * known `KITCHEN_NOT_ELIGIBLE` HttpException code is treated this way -- everything else
   * (including a bare SecureCommandError, an unavailable dependency, or any other conflict code)
   * keeps failing closed via the existing SOFIA_ORDER_CREATION_BLOCKED path below.
   */
  private awaitingPaymentReasonCode(error: unknown): string | null {
    if (!(error instanceof HttpException)) return null;
    const response = error.getResponse();
    const code =
      typeof response === 'object' && response !== null && 'code' in response
        ? String((response as { code?: unknown }).code)
        : null;
    return code && SofiaOrderCreationAdapter.AWAITING_PAYMENT_CODES.has(code) ? code : null;
  }

  private resolveSecureCommandService(): SecureCommandService | undefined {
    try {
      return this.moduleRef.get(SecureCommandService, { strict: false });
    } catch {
      return undefined;
    }
  }

  private async blockedAudit(input: Parameters<OrderCreationService['createFromSofiaDraft']>[0], reasonCode: string) {
    await this.audit.log({
      userId: input.actor.actorId,
      action: 'SOFIA_ORDER_CREATION_BLOCKED',
      module: 'sofia',
      entity: 'sofia_order_draft',
      entityId: input.draftId,
      result: 'BLOCKED',
      reasonCode,
      idempotencyKey: input.idempotencyKey,
      source: input.actor.source,
    });
  }

  /**
   * Distinct from `blockedAudit`: AWAITING_PAYMENT is never a block/failure, so it is never
   * audited with `result: 'BLOCKED'` under the `SOFIA_ORDER_CREATION_BLOCKED` action -- that would
   * be a false claim for audit/reconciliation consumers. `NO_OP` reflects reality precisely: no
   * OrderTicket was created by this attempt, and none should have been yet.
   */
  private async awaitingPaymentAudit(input: Parameters<OrderCreationService['createFromSofiaDraft']>[0], reasonCode: string) {
    await this.audit.log({
      userId: input.actor.actorId,
      action: 'SOFIA_ORDER_AWAITING_PAYMENT',
      module: 'sofia',
      entity: 'sofia_order_draft',
      entityId: input.draftId,
      result: 'NO_OP',
      reasonCode,
      idempotencyKey: input.idempotencyKey,
      source: input.actor.source,
    });
  }
}

@Injectable()
export class SofiaCustomerResolutionAdapter implements CustomerResolutionService {
  constructor(private readonly crm: SofiaCrmService) {}
  async resolve(input: Parameters<CustomerResolutionService['resolve']>[0]) {
    const result = await this.crm.resolveOrCreateByPhone(
      { phone: input.phone, displayName: input.displayName },
      TrustedCrmCustomerResolutionCapability.issue(input.actor.actorId, 'SOFIA_DOMAIN_ADAPTER'),
    );
    return {
      customerId: result.id,
      displayName: result.displayName,
      phoneMasked: result.identities.find((identity) => identity.type === 'PHONE')?.valueMasked ?? '***',
      created: result.createdAt.getTime() === result.updatedAt.getTime(),
    };
  }
}

@Injectable()
export class SofiaPaymentReadAdapter implements PaymentReadService {
  constructor(private readonly payments: SofiaPaymentLinkService) {}
  async readOrderPayment(orderTicketId: string, actor: SofiaActorContext) {
    if (!actor.roles.some((role) => ['admin', 'cashier', 'supervisor'].includes(role))) throw new ForbiddenException({ code: 'SOFIA_PAYMENT_READ_FORBIDDEN' });
    return this.payments.getOperationalLink(orderTicketId);
  }
}
