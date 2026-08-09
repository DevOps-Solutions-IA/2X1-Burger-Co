import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { CheckoutCustomerSnapshot, CheckoutItemSnapshot, CheckoutView, CreateSofiaCheckoutCommand } from './order-checkout.types';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';
import { withBoundedTransactionRetry } from './transaction-retry';

@Injectable()
export class OrderCheckoutService {
  constructor(
    private readonly repository: PrismaOrderCheckoutRepository,
    private readonly audit: AuditService,
  ) {}

  async createFromConfirmedSofiaDraft(input: CreateSofiaCheckoutCommand): Promise<CheckoutView> {
    const checkout = await withBoundedTransactionRetry(() => this.repository.createFromSofiaDraft(input));
    await this.audit.log({
      userId: input.actorId,
      action: 'ORDER_CHECKOUT_CREATED',
      module: 'order-checkout',
      entity: 'order_checkout',
      entityId: checkout.id,
      result: 'SUCCESS',
      reasonCode: 'CONFIRMED_SOFIA_DRAFT_BOUND',
      idempotencyKey: input.idempotencyKey,
      newValues: {
        source: checkout.source,
        fulfillment: checkout.fulfillment,
        paymentPreference: checkout.paymentPreference,
        draftVersion: checkout.sofiaDraftVersion,
        total: checkout.total.toString(),
      },
    });
    return this.view(checkout);
  }

  async get(id: string): Promise<CheckoutView> {
    return this.view(await this.repository.requiredCheckout(id));
  }

  private view(checkout: {
    id: string;
    source: CheckoutView['source'];
    sourceReference: string;
    status: CheckoutView['status'];
    version: number;
    fulfillment: CheckoutView['fulfillment'];
    paymentPreference: CheckoutView['paymentPreference'];
    subtotal: Prisma.Decimal;
    deliveryFee: Prisma.Decimal;
    total: Prisma.Decimal;
    currency: string;
    orderTicketId: string | null;
    expiresAt: Date | null;
    itemsSnapshot: Prisma.JsonValue;
    customerSnapshot: Prisma.JsonValue | null;
  }): CheckoutView {
    return {
      id: checkout.id,
      source: checkout.source,
      sourceReference: checkout.sourceReference,
      status: checkout.status,
      version: checkout.version,
      fulfillment: checkout.fulfillment,
      paymentPreference: checkout.paymentPreference,
      subtotal: Number(checkout.subtotal),
      deliveryFee: Number(checkout.deliveryFee),
      total: Number(checkout.total),
      currency: checkout.currency,
      orderTicketId: checkout.orderTicketId,
      expiresAt: checkout.expiresAt,
      items: this.items(checkout.itemsSnapshot),
      customer: this.customer(checkout.customerSnapshot),
    };
  }

  private items(value: Prisma.JsonValue): CheckoutItemSnapshot[] {
    return Array.isArray(value) ? (value as unknown as CheckoutItemSnapshot[]) : [];
  }

  private customer(value: Prisma.JsonValue | null): CheckoutCustomerSnapshot | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as unknown as CheckoutCustomerSnapshot)
      : null;
  }
}
