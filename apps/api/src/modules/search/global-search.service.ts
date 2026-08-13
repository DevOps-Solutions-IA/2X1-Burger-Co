import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import type { GlobalSearchDto } from './dto/global-search.dto';

export type SearchKind = 'CUSTOMER' | 'ORDER' | 'PAYMENT' | 'CONVERSATION' | 'CASE';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  label: string;
  context: string;
  status: string;
  href: string;
}

@Injectable()
export class GlobalSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(dto: GlobalSearchDto, actor: AuthUser) {
    const query = dto.q.trim();
    const permissions = new Set(actor.permissions ?? []);
    const elevated = actor.roles.some((role) => role === 'admin' || role === 'supervisor');
    const canReadOrders = elevated || permissions.has('orders.read');
    const canReadPayments = elevated || permissions.has('reports.read');
    const tasks: Array<Promise<SearchResult[]>> = [];

    if (canReadOrders) {
      tasks.push(this.customers(query, dto.limit));
      tasks.push(this.orders(query, dto.limit));
      tasks.push(this.conversations(query, dto.limit));
      tasks.push(this.cases(query, dto.limit));
    }
    if (canReadPayments) {
      tasks.push(this.payments(query, dto.limit));
    }

    const groups = await Promise.all(tasks);
    return {
      query,
      items: groups.flat().slice(0, dto.limit * 5),
      dataPolicy: {
        piiMasked: true,
        financialHashesExcluded: true,
        rawPayloadExcluded: true,
      },
    };
  }

  private async customers(query: string, take: number): Promise<SearchResult[]> {
    const items = await this.prisma.customer.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { identities: { some: { valueMasked: { contains: query, mode: 'insensitive' } } } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        status: true,
        identities: { select: { valueMasked: true, isPrimary: true }, take: 2 },
      },
      take,
      orderBy: { updatedAt: 'desc' },
    });
    return items.map((item) => ({
      kind: 'CUSTOMER',
      id: item.id,
      label: item.displayName ?? 'Cliente sin nombre',
      context: item.identities.find((identity) => identity.isPrimary)?.valueMasked ?? item.identities[0]?.valueMasked ?? 'Identidad protegida',
      status: item.status,
      href: `/customers/${encodeURIComponent(item.id)}`,
    }));
  }

  private async orders(query: string, take: number): Promise<SearchResult[]> {
    const items = await this.prisma.orderTicket.findMany({
      where: {
        OR: [
          { number: { contains: query, mode: 'insensitive' } },
          { customerName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, number: true, customerName: true, status: true, type: true },
      take,
      orderBy: { updatedAt: 'desc' },
    });
    return items.map((item) => ({
      kind: 'ORDER',
      id: item.id,
      label: item.number,
      context: `${item.customerName || 'Sin cliente'} · ${item.type}`,
      status: item.status,
      href: `/orders/${encodeURIComponent(item.id)}`,
    }));
  }

  private async payments(query: string, take: number): Promise<SearchResult[]> {
    const items = await this.prisma.paymentIntent.findMany({
      where: {
        OR: [
          { id: { contains: query, mode: 'insensitive' } },
          { providerReference: { contains: query, mode: 'insensitive' } },
          { checkout: { sourceReference: { contains: query, mode: 'insensitive' } } },
        ],
      },
      select: { id: true, status: true, provider: true, amount: true, currency: true },
      take,
      orderBy: { updatedAt: 'desc' },
    });
    return items.map((item) => ({
      kind: 'PAYMENT',
      id: item.id,
      label: `Pago ${this.reference(item.id)}`,
      context: `${item.provider} · ${this.money(item.amount, item.currency)}`,
      status: item.status,
      href: `/payments?intent=${encodeURIComponent(item.id)}`,
    }));
  }

  private async conversations(query: string, take: number): Promise<SearchResult[]> {
    const items = await this.prisma.whatsappConversation.findMany({
      where: {
        OR: [
          { id: { contains: query, mode: 'insensitive' } },
          { customerName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        customerName: true,
        status: true,
        customer: {
          select: {
            identities: { select: { valueMasked: true, isPrimary: true }, take: 2 },
          },
        },
      },
      take,
      orderBy: { lastMessageAt: 'desc' },
    });
    return items.map((item) => ({
      kind: 'CONVERSATION',
      id: item.id,
      label: item.customerName ?? 'Conversacion sin nombre',
      context:
        item.customer?.identities.find((identity) => identity.isPrimary)?.valueMasked ??
        item.customer?.identities[0]?.valueMasked ??
        'Identidad protegida',
      status: item.status,
      href: `/conversations?conversation=${encodeURIComponent(item.id)}`,
    }));
  }

  private async cases(query: string, take: number): Promise<SearchResult[]> {
    const items = await this.prisma.customerServiceCase.findMany({
      where: {
        OR: [
          { id: { contains: query, mode: 'insensitive' } },
          { sanitizedSummary: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, category: true, status: true, sanitizedSummary: true },
      take,
      orderBy: { updatedAt: 'desc' },
    });
    return items.map((item) => ({
      kind: 'CASE',
      id: item.id,
      label: item.category.replaceAll('_', ' '),
      context: item.sanitizedSummary,
      status: item.status,
      href: `/customer-service?case=${encodeURIComponent(item.id)}`,
    }));
  }

  private reference(id: string) {
    return id.length > 10 ? id.slice(-8) : id;
  }

  private money(amount: Prisma.Decimal, currency: string) {
    return `${currency} ${Number(amount).toLocaleString('es-CO')}`;
  }
}
