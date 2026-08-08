import { ConflictException, Injectable } from '@nestjs/common';
import { OrderTicketType, Prisma, SofiaOrderDraftStatus, SofiaPaymentPreference } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { commercialDraftHash } from '../commercial-draft-hash';
import type { CommercialRepository } from '../commercial.repository';
import type { CommercialConversationState } from '../commercial.types';

@Injectable()
export class PrismaCommercialRepository implements CommercialRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadState(conversationId: string) {
    const memory = await this.prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
    const value = memory?.currentOrderIntentJson;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as unknown as CommercialConversationState : null;
  }

  async saveState(state: CommercialConversationState) {
    await this.prisma.sofiaConversationMemory.upsert({
      where: { conversationId: state.conversationId },
      create: { conversationId: state.conversationId, currentIntent: state.intent, currentOrderIntentJson: state as unknown as Prisma.InputJsonValue, missingFieldsJson: state.missingFields, expiresAt: state.expiresAt ? new Date(state.expiresAt) : null },
      update: { currentIntent: state.intent, currentOrderIntentJson: state as unknown as Prisma.InputJsonValue, missingFieldsJson: state.missingFields, expiresAt: state.expiresAt ? new Date(state.expiresAt) : null },
    });
  }

  async saveDraft(input: Record<string, unknown> & { conversationId: string; version?: number; draftId?: string }) {
    const version = input.version ?? 1;
    const draftHash = commercialDraftHash({ ...input, draftId: undefined, version });
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const data = {
      customerId: input.customerId as string | null,
      fulfillment: input.fulfillment as OrderTicketType,
      paymentPreference: input.paymentPreference as SofiaPaymentPreference,
      version,
      draftHash,
      expiresAt,
      deliveryAddress: input.address as string | null,
      addressConfirmedAt: input.address ? new Date() : null,
      itemsSnapshot: input.items as Prisma.InputJsonValue,
      subtotal: input.subtotal as number,
      deliveryFee: input.deliveryFee as number,
      total: input.total as number,
      deliveryQuoteAuditId: input.deliveryQuoteAuditId as string | null,
      deliveryQuoteVersion: input.deliveryQuoteVersion as number | null,
      deliveryQuoteExpiresAt: input.deliveryQuoteExpiresAt as Date | null,
      availabilitySnapshot: input.availabilitySnapshot as Prisma.InputJsonValue,
      availabilityCheckedAt: new Date(),
      missingFields: Prisma.JsonNull,
      status: SofiaOrderDraftStatus.READY_TO_CONFIRM,
    };
    if (!input.draftId) {
      const created = await this.prisma.sofiaOrderDraft.create({ data: { conversationId: input.conversationId, ...data } });
      return { id: created.id, version: created.version, draftHash: created.draftHash!, expiresAt: created.expiresAt! };
    }
    const updated = await this.prisma.sofiaOrderDraft.updateMany({ where: { id: input.draftId, version: version - 1, status: { in: [SofiaOrderDraftStatus.DRAFT, SofiaOrderDraftStatus.NEEDS_INFO, SofiaOrderDraftStatus.READY_TO_CONFIRM] } }, data });
    if (updated.count !== 1) throw new ConflictException({ code: 'STALE_DRAFT_VERSION' });
    return { id: input.draftId, version, draftHash, expiresAt };
  }

  async confirmDraft(input: { draftId: string; expectedVersion: number; expectedHash: string; confirmationHash: string }) {
    const updated = await this.prisma.sofiaOrderDraft.updateMany({
      where: { id: input.draftId, version: input.expectedVersion, draftHash: input.expectedHash, status: SofiaOrderDraftStatus.READY_TO_CONFIRM, expiresAt: { gt: new Date() } },
      data: { status: SofiaOrderDraftStatus.CONFIRMED, confirmedAt: new Date(), confirmationHash: input.confirmationHash },
    });
    if (updated.count !== 1) throw new ConflictException({ code: 'SOFIA_STALE_CONFIRMATION' });
    return { id: input.draftId, version: input.expectedVersion, status: 'CONFIRMED' };
  }
}
