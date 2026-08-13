import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListCustomerServiceCasesDto } from './dto/list-customer-service-cases.dto';

const caseSummarySelect = {
  id: true,
  category: true,
  status: true,
  source: true,
  sanitizedSummary: true,
  customerId: true,
  conversationId: true,
  orderCheckoutId: true,
  orderTicketId: true,
  paymentIntentId: true,
  deliveryIssueId: true,
  assignedActorId: true,
  resolutionActorId: true,
  resolutionCode: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
  customer: { select: { id: true, displayName: true, status: true } },
  assignedActor: { select: { id: true, fullName: true, accessName: true } },
} satisfies Prisma.CustomerServiceCaseSelect;

@Injectable()
export class CustomerServiceCaseReadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCustomerServiceCasesDto) {
    const where: Prisma.CustomerServiceCaseWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.orderTicketId ? { orderTicketId: query.orderTicketId } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.customerServiceCase.count({ where }),
      this.prisma.customerServiceCase.findMany({
        where,
        select: caseSummarySelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async get(id: string) {
    const serviceCase = await this.prisma.customerServiceCase.findUnique({
      where: { id },
      select: {
        ...caseSummarySelect,
        orderCheckout: {
          select: { id: true, status: true, fulfillment: true, paymentPreference: true, total: true, currency: true },
        },
        orderTicket: { select: { id: true, number: true, status: true, type: true } },
        paymentIntent: { select: { id: true, provider: true, status: true, amount: true, currency: true } },
        deliveryIssue: { select: { id: true, issueType: true, status: true, summary: true, createdAt: true, resolvedAt: true } },
        events: {
          select: {
            id: true,
            version: true,
            action: true,
            fromStatus: true,
            toStatus: true,
            actorId: true,
            reasonCode: true,
            sanitizedMetadata: true,
            createdAt: true,
          },
          orderBy: { version: 'asc' },
        },
      },
    });
    if (!serviceCase) throw new NotFoundException({ code: 'CUSTOMER_SERVICE_CASE_NOT_FOUND' });
    return serviceCase;
  }

  async current(id: string) {
    const serviceCase = await this.prisma.customerServiceCase.findUnique({
      where: { id },
      select: { id: true, status: true, version: true },
    });
    if (!serviceCase) throw new NotFoundException({ code: 'CUSTOMER_SERVICE_CASE_NOT_FOUND' });
    return serviceCase;
  }
}
