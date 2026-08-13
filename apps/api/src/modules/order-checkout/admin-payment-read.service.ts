import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ListAdminPaymentIntentsDto,
  ListAdminPaymentLinksDto,
  ListAdminPaymentTransitionsDto,
  ListAdminPaymentWebhooksDto,
} from './dto/list-admin-payments.dto';

const intentSummarySelect = {
  id: true,
  checkoutId: true,
  attemptNumber: true,
  provider: true,
  amount: true,
  currency: true,
  status: true,
  providerPaymentId: true,
  providerReference: true,
  providerAccountHash: true,
  failureCode: true,
  expiresAt: true,
  completedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  checkout: {
    select: {
      source: true,
      sourceReference: true,
      status: true,
      fulfillment: true,
      paymentPreference: true,
      orderTicketId: true,
      total: true,
      currency: true,
    },
  },
  links: {
    select: {
      id: true,
      status: true,
      expiresAt: true,
      openedAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.PaymentIntentSelect;

const webhookSummarySelect = {
  id: true,
  paymentIntentId: true,
  provider: true,
  eventId: true,
  providerPaymentId: true,
  providerReference: true,
  eventType: true,
  status: true,
  amount: true,
  currency: true,
  signatureValid: true,
  payloadHash: true,
  providerAccountHash: true,
  processedStatus: true,
  processingAttempts: true,
  resultCode: true,
  lastErrorCode: true,
  retryable: true,
  receivedAt: true,
  processedAt: true,
  paymentTransition: {
    select: { id: true, fromStatus: true, toStatus: true, reasonCode: true, createdAt: true },
  },
} satisfies Prisma.PaymentWebhookEventSelect;

@Injectable()
export class AdminPaymentReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listIntents(query: ListAdminPaymentIntentsDto) {
    const where: Prisma.PaymentIntentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.checkoutId ? { checkoutId: query.checkoutId } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentIntent.count({ where }),
      this.prisma.paymentIntent.findMany({
        where,
        select: intentSummarySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: items.map((item) => this.intentView(item)), page: query.page, limit: query.limit, total };
  }

  async getIntent(id: string) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id },
      select: {
        ...intentSummarySelect,
        transitions: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            reasonCode: true,
            actorId: true,
            webhookEventId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        webhookEvents: { select: webhookSummarySelect, orderBy: { receivedAt: 'desc' } },
        salePayment: {
          select: { id: true, saleId: true, amount: true, receivedAmount: true, changeAmount: true, createdAt: true },
        },
      },
    });
    if (!intent) throw new NotFoundException({ code: 'PAYMENT_INTENT_NOT_FOUND' });
    return this.intentView(intent);
  }

  async listWebhooks(query: ListAdminPaymentWebhooksDto) {
    const where: Prisma.PaymentWebhookEventWhereInput = {
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.processedStatus ? { processedStatus: query.processedStatus } : {}),
      ...(query.paymentIntentId ? { paymentIntentId: query.paymentIntentId } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentWebhookEvent.count({ where }),
      this.prisma.paymentWebhookEvent.findMany({
        where,
        select: webhookSummarySelect,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: items.map((item) => this.webhookView(item)), page: query.page, limit: query.limit, total };
  }

  async listLinks(query: ListAdminPaymentLinksDto) {
    const where: Prisma.PaymentLinkWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentIntentId ? { paymentIntentId: query.paymentIntentId } : {}),
    };
    const select = {
      id: true,
      paymentIntentId: true,
      status: true,
      expiresAt: true,
      openedAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
      paymentIntent: { select: { status: true, amount: true, currency: true, checkoutId: true } },
    } satisfies Prisma.PaymentLinkSelect;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentLink.count({ where }),
      this.prisma.paymentLink.findMany({
        where,
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: this.decimals(items), page: query.page, limit: query.limit, total };
  }

  async getLink(id: string) {
    const link = await this.prisma.paymentLink.findUnique({
      where: { id },
      select: {
        id: true,
        paymentIntentId: true,
        status: true,
        expiresAt: true,
        openedAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
        paymentIntent: {
          select: {
            id: true,
            checkoutId: true,
            status: true,
            provider: true,
            amount: true,
            currency: true,
            expiresAt: true,
          },
        },
      },
    });
    if (!link) throw new NotFoundException({ code: 'PAYMENT_LINK_NOT_FOUND' });
    return this.decimals(link);
  }

  async listTransitions(query: ListAdminPaymentTransitionsDto) {
    const where: Prisma.PaymentTransitionWhereInput = {
      ...(query.toStatus ? { toStatus: query.toStatus } : {}),
      ...(query.paymentIntentId ? { paymentIntentId: query.paymentIntentId } : {}),
    };
    const select = {
      id: true,
      paymentIntentId: true,
      fromStatus: true,
      toStatus: true,
      reasonCode: true,
      actorId: true,
      webhookEventId: true,
      sanitizedMetadata: true,
      createdAt: true,
    } satisfies Prisma.PaymentTransitionSelect;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentTransition.count({ where }),
      this.prisma.paymentTransition.findMany({
        where,
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async getTransition(id: string) {
    const transition = await this.prisma.paymentTransition.findUnique({
      where: { id },
      select: {
        id: true,
        paymentIntentId: true,
        fromStatus: true,
        toStatus: true,
        reasonCode: true,
        actorId: true,
        webhookEventId: true,
        sanitizedMetadata: true,
        createdAt: true,
        paymentIntent: {
          select: { id: true, checkoutId: true, status: true, provider: true, amount: true, currency: true },
        },
      },
    });
    if (!transition) throw new NotFoundException({ code: 'PAYMENT_TRANSITION_NOT_FOUND' });
    return this.decimals(transition);
  }

  async getWebhook(id: string) {
    const event = await this.prisma.paymentWebhookEvent.findUnique({
      where: { id },
      select: webhookSummarySelect,
    });
    if (!event) throw new NotFoundException({ code: 'PAYMENT_WEBHOOK_NOT_FOUND' });
    return this.webhookView(event);
  }

  private intentView<T extends Record<string, unknown>>(intent: T) {
    const { providerAccountHash, webhookEvents, ...safe } = intent;
    return this.decimals({
      ...safe,
      providerAccountBound: typeof providerAccountHash === 'string' && providerAccountHash.length > 0,
      ...(Array.isArray(webhookEvents)
        ? { webhookEvents: webhookEvents.map((event) => this.webhookView(event as Record<string, unknown>)) }
        : {}),
    });
  }

  private webhookView<T extends Record<string, unknown>>(event: T) {
    const { payloadHash, providerAccountHash, ...safe } = event;
    return this.decimals({
      ...safe,
      payloadEvidencePresent: typeof payloadHash === 'string' && payloadHash.length > 0,
      providerAccountBound: typeof providerAccountHash === 'string' && providerAccountHash.length > 0,
    });
  }

  private decimals<T>(value: T): T {
    if (value instanceof Prisma.Decimal) return Number(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.decimals(item)) as T;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, this.decimals(item)]),
      ) as T;
    }
    return value;
  }
}
