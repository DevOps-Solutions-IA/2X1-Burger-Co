import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type {
  CustomerResolutionService,
  OrderCreationService,
  OrderDraftCommand,
  OrderDraftDto,
  OrderDraftService,
  PaymentReadService,
  SofiaActorContext,
} from '../../../application/contracts/sofia-domain-contracts';
import { AuditService } from '../../audit/audit.service';
import { SofiaCrmService } from '../crm/sofia-crm.service';
import { SofiaPaymentLinkService } from '../sofia-payment-link.service';
import { SofiaService } from '../sofia.service';

type DraftRecord = {
  id: string;
  status: string;
  updatedAt: Date;
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

@Injectable()
export class BlockedSofiaOrderCreationAdapter implements OrderCreationService {
  constructor(private readonly sofia: SofiaService, private readonly audit: AuditService) {}
  async createFromSofiaDraft(input: Parameters<OrderCreationService['createFromSofiaDraft']>[0]): Promise<never> {
    if (!/^sofia-draft:[a-zA-Z0-9_-]{8,128}$/.test(input.idempotencyKey)) {
      throw new ConflictException({ code: 'SOFIA_ORDER_IDEMPOTENCY_CONFLICT' });
    }
    const draft = await this.sofia.findDraft(input.draftId);
    const validVersion = draft.updatedAt.toISOString() === input.expectedDraftVersion;
    const confirmable = draft.status === 'CONFIRMED';
    await this.audit.log({
      userId: input.actor.actorId,
      action: 'SOFIA_ORDER_CREATION_BLOCKED',
      module: 'sofia',
      entity: 'sofia_order_draft',
      entityId: input.draftId,
      result: 'BLOCKED',
      reasonCode: validVersion && confirmable ? 'SOFIA_ORDER_CREATION_BLOCKED' : 'SOFIA_DRAFT_NOT_CONFIRMABLE',
      idempotencyKey: input.idempotencyKey,
      source: input.actor.source,
    });
    throw new ForbiddenException({ code: validVersion && confirmable ? 'SOFIA_ORDER_CREATION_BLOCKED' : 'SOFIA_DRAFT_NOT_CONFIRMABLE' });
  }
}

@Injectable()
export class SofiaCustomerResolutionAdapter implements CustomerResolutionService {
  constructor(private readonly crm: SofiaCrmService) {}
  async resolve(input: Parameters<CustomerResolutionService['resolve']>[0]) {
    const result = await this.crm.resolveOrCreateByPhone({ phone: input.phone, displayName: input.displayName }, input.actor.actorId);
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
    const result = await this.payments.getOperationalLink(orderTicketId);
    return {
      orderTicketId,
      paymentStatus: result.paymentStatus ?? null,
      paymentMethod: result.paymentMethod ?? null,
      provider: result.provider ?? null,
      expiresAt: result.expiresAt?.toISOString() ?? null,
      linkAvailable: Boolean(result.publicPaymentUrl),
    };
  }
}
