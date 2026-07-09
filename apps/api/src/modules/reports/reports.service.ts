import PDFDocument from 'pdfkit';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CashSessionStatus,
  DiningTableStatus,
  InventoryMovementType,
  OrderTicketStatus,
  Prisma,
  SaleChannel,
  SaleStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getDayRange, getRange } from '../../common/utils/date-range.util';
import { toNumber } from '../../common/utils/decimal.util';
import { CashReconciliationService } from '../cash-register/cash-reconciliation.service';

const DAILY_CLOSURE_TYPE = 'DAILY_CLOSURE';

type ClosurePayload = Awaited<ReturnType<ReportsService['buildSummary']>>;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly cashReconciliationService: CashReconciliationService,
  ) {}

  async getDaily(date?: string) {
    const { start, end } = getDayRange(date);
    const snapshot = await this.findDailyClosureSnapshot(start, end);

    const openSession = await this.prisma.cashSession.findFirst({
      where: {
        status: CashSessionStatus.OPEN,
        openedAt: { lt: end },
      },
    });

    if (snapshot && !openSession) {
      return {
        ...(snapshot.payload as ClosurePayload),
        metadata: {
          source: 'snapshot',
          generatedAt: snapshot.createdAt.toISOString(),
          snapshotId: snapshot.id,
        },
      };
    }

    const payload = await this.buildSummary(start, end);
    return {
      ...payload,
      metadata: {
        source: 'live',
        generatedAt: new Date().toISOString(),
        snapshotId: snapshot?.id ?? null,
      },
    };
  }

  async getRange(from?: string, to?: string) {
    const { start, end } = getRange(from, to);
    const payload = await this.buildSummary(start, end);
    return {
      ...payload,
      metadata: {
        source: 'live',
        generatedAt: new Date().toISOString(),
        snapshotId: null,
      },
    };
  }

  async getOperational() {
    const [currentSession, supply, occupiedTables, activeOrders, latestClosure] = await Promise.all([
      this.prisma.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN },
        orderBy: { openedAt: 'desc' },
      }),
      this.getSupplyAlerts(),
      this.prisma.diningTable.count({
        where: {
          isActive: true,
          status: {
            in: [DiningTableStatus.OCCUPIED, DiningTableStatus.PAYMENT_PENDING],
          },
        },
      }),
      this.prisma.orderTicket.findMany({
        where: {
          status: {
            in: [
              OrderTicketStatus.OPEN,
              OrderTicketStatus.IN_PREPARATION,
              OrderTicketStatus.SERVED,
              OrderTicketStatus.PAYMENT_PENDING,
            ],
          },
        },
        include: {
          table: true,
          items: {
            include: {
              product: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      }),
      this.prisma.reportSnapshot.findFirst({
        where: { type: DAILY_CLOSURE_TYPE },
        orderBy: { periodStart: 'desc' },
      }),
    ]);

    if (!currentSession) {
      return {
        business: {
          name: '2x1 Burger Co',
          phone: '',
          address: '',
          currency: 'COP',
          logoUrl: null,
        },
        period: {
          start: new Date().toISOString().slice(0, 10),
          end: new Date().toISOString().slice(0, 10),
        },
        journey: {
          status: 'PENDIENTE_APERTURA',
          openedAt: null,
          closedAt: null,
          currentSessionId: null,
          responsibleUser: null,
          lastClosureId: latestClosure?.id ?? null,
          lastClosedPeriod: latestClosure?.periodStart.toISOString().slice(0, 10) ?? null,
        },
        cash: {
          openingAmount: 0,
          incomesTotal: 0,
          outcomesTotal: 0,
          expectedAmount: 0,
          actualAmount: null,
          difference: null,
          physical: {
            openingCash: 0,
            cashRevenue: 0,
            cashExpenses: 0,
            cashPurchases: 0,
            expectedPhysicalCash: 0,
            countedPhysicalCash: null,
            cashDifference: null,
          },
          digital: {
            revenue: 0,
            expenses: 0,
            purchases: 0,
          },
          totalRevenue: 0,
          totalExpenses: 0,
          operationalResult: 0,
          reconciliation: await this.cashReconciliationService.buildCurrent(null),
        },
        sales: {
          total: 0,
          count: 0,
          itemsSold: 0,
          canceledCount: 0,
          pendingCount: 0,
          byPaymentMethod: [],
          byChannel: [],
          byTable: [],
          byDelivery: [],
          byProduct: [],
          bestSellers: [],
          leastSellers: [],
          nonMovingProducts: [],
          commandasClosed: [],
          chargedOrders: [],
          details: [],
        },
        purchases: {
          total: 0,
          count: 0,
          details: [],
        },
        expenses: {
          total: 0,
          count: 0,
          details: [],
        },
        metrics: {
          costOfSales: 0,
          grossProfit: 0,
          netProfit: 0,
        },
        observations: '',
        replenishment: {
          lowStock: supply.alerts.filter((item) => item.severity === 'BAJO'),
          criticalStock: supply.alerts.filter((item) => item.severity === 'CRITICO'),
          outOfStock: supply.alerts.filter((item) => item.severity === 'AGOTADO'),
          productLowStock: supply.lowStockProducts
            .filter((product) => {
              const currentStock = toNumber(product.currentStock);
              const stockMin = toNumber(product.stockMin);
              return currentStock > 0 && currentStock > stockMin / 2;
            })
            .map((product) => this.mapProductStockAlert(product, 'BAJO')),
          productCriticalStock: supply.lowStockProducts
            .filter((product) => {
              const currentStock = toNumber(product.currentStock);
              const stockMin = toNumber(product.stockMin);
              return currentStock > 0 && currentStock <= stockMin / 2;
            })
            .map((product) => this.mapProductStockAlert(product, 'CRITICO')),
          productOutOfStock: supply.lowStockProducts
            .filter((product) => toNumber(product.currentStock) <= 0)
            .map((product) => this.mapProductStockAlert(product, 'AGOTADO')),
          groupedBySupplier: supply.groupedBySupplier,
        },
        operations: {
          activeOrdersCount: 0,
          occupiedTablesCount: 0,
          activeOrders: [],
        },
        settings: {
          printSignature: true,
          timezone: 'America/Bogota',
        },
        metadata: {
          source: 'operational',
          generatedAt: new Date().toISOString(),
          snapshotId: null,
        },
      };
    }

    const payload = await this.buildSummary(currentSession.openedAt, new Date(), {
      forcedSessionId: currentSession.id,
      forceJourneyStatus: 'ABIERTA',
    });

    return {
      ...payload,
      operations: {
        activeOrdersCount: activeOrders.filter((order) => order.cashSessionId === currentSession.id).length,
        occupiedTablesCount: occupiedTables,
        activeOrders: activeOrders
          .filter((order) => order.cashSessionId === currentSession.id)
          .map((order) => ({
            id: order.id,
            number: order.number,
            status: order.status,
            type: order.type,
            tableLabel: order.table?.label ?? null,
            customerName: order.customerName,
            subtotal: toNumber(order.subtotal),
            itemsCount: order.items.reduce((acc, item) => acc + toNumber(item.quantity), 0),
            updatedAt: order.updatedAt.toISOString(),
          })),
      },
      metadata: {
        source: 'operational',
        generatedAt: new Date().toISOString(),
        snapshotId: null,
      },
    };
  }

  async getBestSellers(from?: string, to?: string) {
    const { start, end } = getRange(from, to);
    return this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          soldAt: {
            gte: start,
            lt: end,
          },
          status: 'PAID',
        },
      },
      _sum: {
        quantity: true,
        totalPrice: true,
      },
      orderBy: {
        _sum: {
          totalPrice: 'desc',
        },
      },
      take: 10,
    });
  }

  async getInventorySummary() {
    const supply = await this.getSupplyAlerts();
    return {
      lowStockProducts: supply.lowStockProducts,
      lowStockIngredients: supply.lowStockIngredients,
      supplyAlerts: supply.alerts,
      groupedBySupplier: supply.groupedBySupplier,
    };
  }

  async getSalesByHour(from?: string, to?: string) {
    const { start, end } = getRange(from, to);
    const sales = await this.prisma.sale.findMany({
      where: {
        soldAt: { gte: start, lt: end },
        status: 'PAID',
      },
      select: {
        soldAt: true,
        total: true,
        channel: true,
      },
    });

    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      total: 0,
      count: 0,
    }));

    for (const sale of sales) {
      const hour = this.getHourInTimezone(new Date(sale.soldAt), 'America/Bogota');
      const bucket = buckets[hour];
      if (!bucket) continue;
      bucket.total += toNumber(sale.total);
      bucket.count += 1;
    }

    return buckets;
  }

  async getProductMargins(from?: string, to?: string) {
    const { start, end } = getRange(from, to);
    const items = await this.prisma.saleItem.findMany({
      where: {
        sale: {
          soldAt: { gte: start, lt: end },
          status: 'PAID',
        },
      },
      include: {
        product: true,
      },
    });

    return Object.values(
      items.reduce<
        Record<string, { productId: string; name: string; quantity: number; revenue: number; cost: number; margin: number }>
      >((acc, item) => {
        const current =
          acc[item.productId] ??
          (acc[item.productId] = {
            productId: item.productId,
            name: item.product.name,
            quantity: 0,
            revenue: 0,
            cost: 0,
            margin: 0,
          });

        current.quantity += toNumber(item.quantity);
        current.revenue += toNumber(item.totalPrice);
        current.cost += toNumber(item.estimatedCost);
        current.margin = current.revenue - current.cost;
        return acc;
      }, {}),
    ).sort((left, right) => right.margin - left.margin);
  }

  async getIngredientRotation(from?: string, to?: string) {
    const { start, end } = getRange(from, to);
    const [ingredients, movements] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { isActive: true },
        include: { unit: true },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          ingredientId: { not: null },
          occurredAt: { gte: start, lt: end },
        },
      }),
    ]);

    const movementMap = new Map<string, { outbound: number; inbound: number }>();
    for (const movement of movements) {
      if (!movement.ingredientId) continue;

      const current = movementMap.get(movement.ingredientId) ?? { outbound: 0, inbound: 0 };

      if (
        movement.type === InventoryMovementType.SALE ||
        movement.type === InventoryMovementType.WASTE ||
        movement.type === InventoryMovementType.DAMAGE ||
        movement.type === InventoryMovementType.INTERNAL_USE
      ) {
        current.outbound += Math.abs(toNumber(movement.quantity));
      }

      if (
        movement.type === InventoryMovementType.PURCHASE ||
        movement.type === InventoryMovementType.RETURN ||
        movement.type === InventoryMovementType.INITIAL
      ) {
        current.inbound += Math.abs(toNumber(movement.quantity));
      }

      movementMap.set(movement.ingredientId, current);
    }

    const days = Math.max((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24), 1);

    return ingredients
      .map((ingredient) => {
        const totals = movementMap.get(ingredient.id) ?? { outbound: 0, inbound: 0 };
        const avgDailyOutbound = totals.outbound / days;
        const currentStock = toNumber(ingredient.currentStock);

        return {
          ingredientId: ingredient.id,
          name: ingredient.name,
          code: ingredient.code,
          unit: ingredient.unit.abbreviation,
          outbound: totals.outbound,
          inbound: totals.inbound,
          avgDailyOutbound,
          currentStock,
          daysOfCoverage: avgDailyOutbound > 0 ? currentStock / avgDailyOutbound : null,
        };
      })
      .sort((left, right) => right.outbound - left.outbound);
  }

  async getComparisons(anchorDate?: string) {
    const baseDay = anchorDate ? new Date(`${anchorDate}T00:00:00.000Z`) : new Date();
    baseDay.setUTCHours(0, 0, 0, 0);

    const currentDay = await this.buildComparisonRange(baseDay, this.shiftDays(baseDay, 1));
    const previousDay = await this.buildComparisonRange(this.shiftDays(baseDay, -1), baseDay);

    const currentWeekStart = this.startOfWeek(baseDay);
    const previousWeekStart = this.shiftDays(currentWeekStart, -7);
    const currentWeek = await this.buildComparisonRange(currentWeekStart, this.shiftDays(currentWeekStart, 7));
    const previousWeek = await this.buildComparisonRange(previousWeekStart, currentWeekStart);

    const currentMonthStart = new Date(Date.UTC(baseDay.getUTCFullYear(), baseDay.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(baseDay.getUTCFullYear(), baseDay.getUTCMonth() + 1, 1));
    const previousMonthStart = new Date(Date.UTC(baseDay.getUTCFullYear(), baseDay.getUTCMonth() - 1, 1));
    const currentMonth = await this.buildComparisonRange(currentMonthStart, nextMonthStart);
    const previousMonth = await this.buildComparisonRange(previousMonthStart, currentMonthStart);

    return {
      day: this.toComparisonBlock('Hoy', currentDay, 'Ayer', previousDay),
      week: this.toComparisonBlock('Semana actual', currentWeek, 'Semana anterior', previousWeek),
      month: this.toComparisonBlock('Mes actual', currentMonth, 'Mes anterior', previousMonth),
    };
  }

  async getSupplyAlerts() {
    const [products, ingredients, purchaseItems] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          isActive: true,
          trackStock: true,
        },
        include: {
          category: true,
          unit: true,
        },
        orderBy: { currentStock: 'asc' },
      }),
      this.prisma.ingredient.findMany({
        where: { isActive: true },
        include: { unit: true },
        orderBy: { currentStock: 'asc' },
      }),
      this.prisma.purchaseItem.findMany({
        where: {
          ingredientId: { not: null },
        },
        include: {
          ingredient: true,
          purchase: {
            include: {
              supplier: true,
            },
          },
        },
        orderBy: {
          purchase: {
            purchasedAt: 'desc',
          },
        },
      }),
    ]);

    const latestSupplierByIngredient = new Map<
      string,
      { id: string; name: string; phone: string | null; contactName: string | null }
    >();

    for (const item of purchaseItems) {
      if (!item.ingredientId || latestSupplierByIngredient.has(item.ingredientId)) {
        continue;
      }

      latestSupplierByIngredient.set(item.ingredientId, {
        id: item.purchase.supplier.id,
        name: item.purchase.supplier.name,
        phone: item.purchase.supplier.phone,
        contactName: item.purchase.supplier.contactName,
      });
    }

    const lowStockProducts = products.filter(
      (product) => product.stockMin && product.currentStock.lessThanOrEqualTo(product.stockMin),
    );

    const lowStockIngredients = ingredients.filter(
      (ingredient) => ingredient.stockMin && ingredient.currentStock.lessThanOrEqualTo(ingredient.stockMin),
    );

    const alerts = lowStockIngredients.map((ingredient) => {
      const currentStock = toNumber(ingredient.currentStock);
      const stockMin = toNumber(ingredient.stockMin);
      const stockMax = toNumber(ingredient.stockMax);
      const supplier = latestSupplierByIngredient.get(ingredient.id) ?? null;

      const severity =
        currentStock <= 0 ? 'AGOTADO' : currentStock <= stockMin / 2 ? 'CRITICO' : 'BAJO';

      const suggestedQuantity = Math.max(
        Math.ceil(
          stockMax > 0
            ? stockMax - currentStock
            : stockMin > 0
              ? stockMin * 2 - currentStock
              : 0,
        ),
        1,
      );

      return {
        ingredientId: ingredient.id,
        ingredientCode: ingredient.code,
        ingredientName: ingredient.name,
        unit: ingredient.unit.abbreviation,
        currentStock,
        stockMin,
        stockMax,
        severity,
        suggestedQuantity,
        suggestedReorderLabel: `${suggestedQuantity.toLocaleString('es-CO')} ${ingredient.unit.abbreviation}`,
        supplier,
      };
    });

    const groupedBySupplier = Object.values(
      alerts.reduce<
        Record<
          string,
          {
            supplierId: string | null;
            supplierName: string;
            supplierPhone: string | null;
            items: typeof alerts;
            whatsappMessage: string;
            whatsappLink: string | null;
          }
        >
      >((acc, alert) => {
        const key = alert.supplier?.id ?? `unassigned-${alert.ingredientId}`;
        const current = acc[key] ?? {
          supplierId: alert.supplier?.id ?? null,
          supplierName: alert.supplier?.name ?? 'Proveedor pendiente',
          supplierPhone: alert.supplier?.phone ?? null,
          items: [],
          whatsappMessage: '',
          whatsappLink: null,
        };

        current.items.push(alert);
        acc[key] = current;
        return acc;
      }, {}),
    ).map((group) => {
      const whatsappMessage = this.buildSupplierMessage(group.supplierName, group.items);
      return {
        ...group,
        whatsappMessage,
        whatsappLink: this.buildWhatsappLink(group.supplierPhone, whatsappMessage),
      };
    });

    return {
      lowStockProducts,
      lowStockIngredients,
      alerts,
      groupedBySupplier,
    };
  }

  private async buildComparisonRange(start: Date, end: Date) {
    const [sales, expenses] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          soldAt: { gte: start, lt: end },
          status: 'PAID',
        },
        _sum: { total: true },
        _count: { id: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          spentAt: { gte: start, lt: end },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    return {
      salesTotal: toNumber(sales._sum.total),
      salesCount: sales._count.id,
      expensesTotal: toNumber(expenses._sum.amount),
      expensesCount: expenses._count.id,
    };
  }

  private toComparisonBlock(
    currentLabel: string,
    current: { salesTotal: number; salesCount: number; expensesTotal: number; expensesCount: number },
    previousLabel: string,
    previous: { salesTotal: number; salesCount: number; expensesTotal: number; expensesCount: number },
  ) {
    return {
      currentLabel,
      previousLabel,
      current,
      previous,
      deltas: {
        salesTotal: current.salesTotal - previous.salesTotal,
        salesCount: current.salesCount - previous.salesCount,
        expensesTotal: current.expensesTotal - previous.expensesTotal,
      },
    };
  }

  private shiftDays(date: Date, amount: number) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
  }

  private startOfWeek(date: Date) {
    const result = new Date(date);
    const day = result.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    result.setUTCDate(result.getUTCDate() + diff);
    result.setUTCHours(0, 0, 0, 0);
    return result;
  }

  async getDailyClosures(from?: string, to?: string) {
    const { start, end } = getRange(from, to);
    const snapshots = await this.prisma.reportSnapshot.findMany({
      where: {
        type: DAILY_CLOSURE_TYPE,
        periodStart: {
          gte: start,
        },
        periodEnd: {
          lte: end,
        },
      },
      include: {
        generatedBy: true,
      },
      orderBy: {
        periodStart: 'desc',
      },
    });

    return snapshots.map((snapshot) => {
      const payload = snapshot.payload as ClosurePayload;
      return {
        id: snapshot.id,
        name: snapshot.name,
        periodStart: snapshot.periodStart.toISOString(),
        periodEnd: snapshot.periodEnd.toISOString(),
        createdAt: snapshot.createdAt.toISOString(),
        generatedBy: snapshot.generatedBy
          ? {
              id: snapshot.generatedBy.id,
              fullName: snapshot.generatedBy.fullName,
              email: snapshot.generatedBy.email,
            }
          : null,
        journey: payload.journey,
        cash: payload.cash,
        metrics: payload.metrics,
        sales: {
          total: payload.sales.total,
          count: payload.sales.count,
        },
        expenses: {
          total: payload.expenses.total,
          count: payload.expenses.count,
        },
      };
    });
  }

  async getDailyClosure(id: string) {
    const snapshot = await this.prisma.reportSnapshot.findFirst({
      where: {
        id,
        type: DAILY_CLOSURE_TYPE,
      },
      include: {
        generatedBy: true,
      },
    });

    if (!snapshot) {
      throw new NotFoundException('No se encontró el cierre diario.');
    }

    return {
      ...(snapshot.payload as ClosurePayload),
      metadata: {
        source: 'snapshot',
        generatedAt: snapshot.createdAt.toISOString(),
        snapshotId: snapshot.id,
        generatedBy: snapshot.generatedBy
          ? {
              id: snapshot.generatedBy.id,
              fullName: snapshot.generatedBy.fullName,
              email: snapshot.generatedBy.email,
            }
          : null,
      },
    };
  }

  async listSupplierNotifications() {
    return this.prisma.supplierNotification.findMany({
      include: {
        supplier: true,
        createdBy: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  }

  async createSupplierNotification(
    input: {
      supplierId: string;
      ingredientIds?: string[];
      notes?: string;
    },
    actorId: string,
  ) {
    const grouped = await this.getSupplyAlerts();
    const supplierGroup = grouped.groupedBySupplier.find((group) => group.supplierId === input.supplierId);

    if (!supplierGroup) {
      throw new NotFoundException('No se encontró la sugerencia de reabastecimiento del proveedor.');
    }

    const items = input.ingredientIds?.length
      ? supplierGroup.items.filter((item) => input.ingredientIds?.includes(item.ingredientId))
      : supplierGroup.items;

    if (!items.length) {
      throw new BadRequestException('No hay alertas de abastecimiento para el proveedor seleccionado.');
    }

    const message = this.buildSupplierMessage(supplierGroup.supplierName, items, input.notes);
    const whatsappLink = this.buildWhatsappLink(supplierGroup.supplierPhone, message);

    const notification = await this.prisma.supplierNotification.create({
      data: {
        supplierId: input.supplierId,
        channel: 'WHATSAPP',
        status: whatsappLink ? 'GENERATED' : 'PENDING_CONTACT',
        message,
        whatsappLink,
        payload: {
          items,
          notes: input.notes ?? null,
        } as Prisma.InputJsonValue,
        createdById: actorId,
        sentAt: whatsappLink ? new Date() : null,
      },
      include: {
        supplier: true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'GENERATE',
      module: 'suppliers',
      entity: 'supplier_notification',
      entityId: notification.id,
      newValues: {
        supplierId: input.supplierId,
        ingredientIds: items.map((item) => item.ingredientId),
      },
    });

    return notification;
  }

  async captureDailyClosure(sessionId: string, actorId: string, observations?: string) {
    const session = await this.prisma.cashSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('No se encontró la sesión de caja.');
    }

    if (session.status !== CashSessionStatus.CLOSED) {
      throw new BadRequestException('La sesión de caja debe estar cerrada antes de generar el cierre diario.');
    }

    const { start, end } = getDayRange(session.openedAt.toISOString().slice(0, 10));
    const payload = await this.buildSummary(start, end, {
      forcedObservations: observations ?? session.notes ?? undefined,
      forcedSessionId: session.id,
      forceJourneyStatus: 'CERRADA',
    });

    const dateLabel = start.toISOString().slice(0, 10);

    const existing = await this.findDailyClosureSnapshot(start, end);
    const snapshot = existing
      ? await this.prisma.reportSnapshot.update({
          where: { id: existing.id },
          data: {
            name: `Cierre diario ${dateLabel}`,
            payload: payload as Prisma.InputJsonValue,
            generatedById: actorId,
          },
        })
      : await this.prisma.reportSnapshot.create({
          data: {
            name: `Cierre diario ${dateLabel}`,
            type: DAILY_CLOSURE_TYPE,
            periodStart: start,
            periodEnd: end,
            payload: payload as Prisma.InputJsonValue,
            generatedById: actorId,
          },
        });

    await this.auditService.log({
      userId: actorId,
      action: 'GENERATE',
      module: 'reports',
      entity: 'daily_closure',
      entityId: snapshot.id,
      newValues: {
        sessionId,
        period: payload.period,
      },
    });

    return {
      id: snapshot.id,
      ...payload,
    };
  }

  async generateDailyPdf(date?: string) {
    const data = await this.getDaily(date);
    return this.renderDailyPdf(data);
  }

  async generateOperationalPdf() {
    const data = await this.getOperational();
    return this.renderDailyPdf(data);
  }

  async generateDailyClosurePdf(id: string) {
    const data = await this.getDailyClosure(id);
    return this.renderDailyPdf(data);
  }

  private async buildSummary(
    start: Date,
    end: Date,
    options?: {
      forcedSessionId?: string;
      forcedObservations?: string;
      forceJourneyStatus?: 'ABIERTA' | 'CERRADA' | 'PENDIENTE_APERTURA';
    },
  ) {
    const [sales, purchases, expenses, paymentMethods, sessions, settings, supply, activeProducts] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          soldAt: {
            gte: start,
            lt: end,
          },
          status: 'PAID',
        },
        include: {
          createdBy: true,
          items: {
            include: {
              product: true,
            },
          },
          payments: {
            include: {
              paymentMethod: true,
            },
          },
          orderTicket: {
            include: {
              table: true,
            },
          },
        },
        orderBy: {
          soldAt: 'asc',
        },
      }),
      this.prisma.purchase.findMany({
        where: {
          purchasedAt: {
            gte: start,
            lt: end,
          },
        },
        include: {
          supplier: true,
          items: {
            include: {
              ingredient: true,
              product: true,
            },
          },
          createdBy: true,
          paymentMethod: true,
          cashSession: true,
        },
        orderBy: {
          purchasedAt: 'asc',
        },
      }),
      this.prisma.expense.findMany({
        where: {
          spentAt: {
            gte: start,
            lt: end,
          },
        },
        include: {
          paymentMethod: true,
          createdBy: true,
        },
        orderBy: {
          spentAt: 'asc',
        },
      }),
      this.prisma.paymentMethod.findMany({ where: { isActive: true } }),
      this.prisma.cashSession.findMany({
        where: {
          openedAt: {
            lt: end,
          },
          OR: [{ closedAt: null }, { closedAt: { gte: start } }],
        },
        include: {
          openedBy: true,
          closedBy: true,
          movements: {
            include: { paymentMethod: true },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
        orderBy: {
          openedAt: 'asc',
        },
      }),
      this.prisma.setting.findMany({
        where: {
          key: {
            in: ['business.profile', 'reports.daily-close'],
          },
        },
      }),
      this.getSupplyAlerts(),
      this.prisma.product.findMany({
        where: { isActive: true },
        include: {
          category: true,
        },
      }),
    ]);

    const businessProfile = (settings.find((item) => item.key === 'business.profile')?.value ?? {}) as {
      name?: string;
      phone?: string;
      address?: string;
      currency?: string;
      logoUrl?: string;
    };

    const reportsConfig = (settings.find((item) => item.key === 'reports.daily-close')?.value ?? {}) as {
      printSignature?: boolean;
      timezone?: string;
    };

    const selectedSession =
      (options?.forcedSessionId
        ? sessions.find((session) => session.id === options.forcedSessionId)
        : undefined) ??
      sessions[sessions.length - 1] ??
      null;
    const reconciliation = selectedSession
      ? await this.cashReconciliationService.buildForSession(selectedSession.id)
      : await this.cashReconciliationService.buildForPeriod(start, end);

    const salesTotal = sales.reduce((acc, sale) => acc + toNumber(sale.total), 0);
    const purchasesTotal = purchases.reduce((acc, purchase) => acc + toNumber(purchase.total), 0);
    const expensesTotal = expenses.reduce((acc, expense) => acc + toNumber(expense.amount), 0);

    const salesByPaymentMethod = paymentMethods.map((paymentMethod) => ({
      paymentMethod: paymentMethod.name,
      total: sales.reduce(
        (acc, sale) =>
          acc +
          sale.payments
            .filter((payment) => payment.paymentMethodId === paymentMethod.id)
            .reduce((innerAcc, payment) => innerAcc + toNumber(payment.amount), 0),
        0,
      ),
    }));

    const salesByProduct = Object.values(
      sales.flatMap((sale) => sale.items).reduce<
        Record<string, { productId: string; productName: string; quantity: number; total: number; cost: number }>
      >((acc, item) => {
        const current = acc[item.productId] ?? {
          productId: item.productId,
          productName: item.product.name,
          quantity: 0,
          total: 0,
          cost: 0,
        };

        current.quantity += toNumber(item.quantity);
        current.total += toNumber(item.totalPrice);
        current.cost += toNumber(item.estimatedCost);
        acc[item.productId] = current;
        return acc;
      }, {}),
    ).sort((a, b) => b.quantity - a.quantity);

    const productSalesMap = new Map(
      salesByProduct.map((item) => [
        item.productId,
        {
          quantity: item.quantity,
          total: item.total,
          cost: item.cost,
        },
      ]),
    );

    const rankedProductPerformance = activeProducts
      .map((product) => {
        const salesData = productSalesMap.get(product.id);
        return {
          productId: product.id,
          productName: product.name,
          categoryName: product.category.name,
          quantity: salesData?.quantity ?? 0,
          total: salesData?.total ?? 0,
          cost: salesData?.cost ?? 0,
          trackStock: product.trackStock,
          currentStock: toNumber(product.currentStock),
          stockMin: toNumber(product.stockMin),
        };
      })
      .sort((left, right) => {
        if (left.quantity !== right.quantity) {
          return left.quantity - right.quantity;
        }

        if (left.total !== right.total) {
          return left.total - right.total;
        }

        return left.productName.localeCompare(right.productName, 'es');
      });

    const itemsSold = salesByProduct.reduce((acc, item) => acc + item.quantity, 0);
    const [canceledCount, pendingCount] = await Promise.all([
      this.prisma.sale.count({
        where: {
          soldAt: { gte: start, lt: end },
          status: SaleStatus.CANCELLED,
          ...(options?.forcedSessionId ? { cashSessionId: options.forcedSessionId } : {}),
        },
      }),
      this.prisma.sale.count({
        where: {
          soldAt: { gte: start, lt: end },
          status: SaleStatus.PENDING,
          ...(options?.forcedSessionId ? { cashSessionId: options.forcedSessionId } : {}),
        },
      }),
    ]);

    const costOfSales = salesByProduct.reduce((acc, item) => acc + item.cost, 0);
    const grossProfit = salesTotal - costOfSales;
    const netProfit = grossProfit - expensesTotal;

    const salesByChannel = Object.values(
      sales.reduce<
        Record<
          SaleChannel,
          {
            channel: SaleChannel;
            label: string;
            total: number;
            count: number;
          }
        >
      >(
        (acc, sale) => {
          const channel = sale.channel ?? SaleChannel.MOSTRADOR;
          const current = acc[channel] ?? {
            channel,
            label: this.channelLabel(channel),
            total: 0,
            count: 0,
          };
          current.total += toNumber(sale.total);
          current.count += 1;
          acc[channel] = current;
          return acc;
        },
        {
          MOSTRADOR: { channel: SaleChannel.MOSTRADOR, label: this.channelLabel(SaleChannel.MOSTRADOR), total: 0, count: 0 },
          PARA_LLEVAR: { channel: SaleChannel.PARA_LLEVAR, label: this.channelLabel(SaleChannel.PARA_LLEVAR), total: 0, count: 0 },
          MESA: { channel: SaleChannel.MESA, label: this.channelLabel(SaleChannel.MESA), total: 0, count: 0 },
          DOMICILIO: { channel: SaleChannel.DOMICILIO, label: this.channelLabel(SaleChannel.DOMICILIO), total: 0, count: 0 },
        },
      ),
    );

    const salesByTable = Object.values(
      sales
        .filter((sale) => sale.channel === SaleChannel.MESA && sale.tableLabel)
        .reduce<Record<string, { tableLabel: string; count: number; total: number }>>((acc, sale) => {
          const key = sale.tableLabel ?? 'Mesa';
          const current = acc[key] ?? { tableLabel: key, count: 0, total: 0 };
          current.count += 1;
          current.total += toNumber(sale.total);
          acc[key] = current;
          return acc;
        }, {}),
    );

    const salesByDelivery = sales
      .filter((sale) => sale.channel === SaleChannel.DOMICILIO)
      .map((sale) => ({
        saleId: sale.id,
        number: sale.number,
        customerName: sale.customerName ?? 'Cliente sin nombre',
        reference: sale.deliveryReference ?? 'Referencia no registrada',
        total: toNumber(sale.total),
      }));

    const saleDetails = sales.map((sale) => ({
      id: sale.id,
      number: sale.number,
      soldAt: sale.soldAt.toISOString(),
      channel: this.channelLabel(sale.channel ?? SaleChannel.MOSTRADOR),
      tableLabel: sale.tableLabel,
      orderTicketNumber: sale.orderTicket?.number ?? null,
      deliveryReference: sale.deliveryReference,
      customerName: sale.customerName,
      subtotal: toNumber(sale.subtotal),
      discount: toNumber(sale.discount),
      total: toNumber(sale.total),
      createdBy: sale.createdBy.fullName,
      paymentMethods: sale.payments.map((payment) => ({
        name: payment.paymentMethod.name,
        amount: toNumber(payment.amount),
      })),
      items: sale.items.map((item) => ({
        productName: item.product.name,
        quantity: toNumber(item.quantity),
        total: toNumber(item.totalPrice),
      })),
    }));

    const purchaseDetails = purchases.map((purchase) => ({
      id: purchase.id,
      number: purchase.number,
      supplierName: purchase.supplier.name,
      purchasedAt: purchase.purchasedAt.toISOString(),
      total: toNumber(purchase.total),
      createdBy: purchase.createdBy.fullName,
      items: purchase.items.map((item) => ({
        name: item.ingredient?.name ?? item.product?.name ?? 'Ítem',
        quantity: toNumber(item.quantity),
        total: toNumber(item.totalCost),
      })),
    }));

    const expenseDetails = expenses.map((expense) => ({
      id: expense.id,
      concept: expense.concept,
      classification: expense.classification ?? expense.concept,
      description: expense.description,
      spentAt: expense.spentAt.toISOString(),
      paymentMethod: expense.paymentMethod?.name ?? 'Sin método',
      total: toNumber(expense.amount),
      createdBy: expense.createdBy.fullName,
    }));

    const cashIncomes = reconciliation.cashRevenue + reconciliation.manualCash.otherIncome + reconciliation.manualCash.adjustment;
    const cashOutcomes =
      reconciliation.expensesByMethod.cash + reconciliation.purchasesByMethod.cash + reconciliation.manualCash.otherExpense;
    const expectedCash = reconciliation.expectedPhysicalCash;

    const journeyStatus =
      options?.forceJourneyStatus ??
      (selectedSession?.status === CashSessionStatus.OPEN
        ? 'ABIERTA'
        : selectedSession?.status === CashSessionStatus.CLOSED
          ? 'CERRADA'
          : 'PENDIENTE_APERTURA');

    return {
      business: {
        name: businessProfile.name ?? '2x1 Burger Co',
        phone: businessProfile.phone ?? '',
        address: businessProfile.address ?? '',
        currency: businessProfile.currency ?? 'COP',
        logoUrl: businessProfile.logoUrl ?? null,
      },
      period: {
        start: start.toISOString().slice(0, 10),
        end: new Date(end.getTime() - 1).toISOString().slice(0, 10),
      },
      journey: {
        status: journeyStatus,
        openedAt: selectedSession?.openedAt?.toISOString() ?? null,
        closedAt: selectedSession?.closedAt?.toISOString() ?? null,
        currentSessionId: selectedSession?.id ?? null,
        responsibleUser:
          selectedSession?.closedBy?.fullName ?? selectedSession?.openedBy?.fullName ?? null,
      },
      cash: {
        openingAmount: toNumber(selectedSession?.openingAmount),
        incomesTotal: cashIncomes,
        outcomesTotal: cashOutcomes,
        expectedAmount: expectedCash,
        actualAmount: selectedSession?.closingAmount != null ? toNumber(selectedSession.closingAmount) : null,
        difference:
          selectedSession?.difference != null ? toNumber(selectedSession.difference) : reconciliation.cashDifference,
        physical: {
          openingCash: reconciliation.openingCash,
          cashRevenue: reconciliation.cashRevenue,
          cashExpenses: reconciliation.expensesByMethod.cash,
          cashPurchases: reconciliation.purchasesByMethod.cash,
          expectedPhysicalCash: reconciliation.expectedPhysicalCash,
          countedPhysicalCash: reconciliation.countedPhysicalCash,
          cashDifference: reconciliation.cashDifference,
        },
        digital: {
          revenue: reconciliation.digitalRevenue,
          expenses:
            reconciliation.expensesByMethod.nequi +
            reconciliation.expensesByMethod.daviplata +
            reconciliation.expensesByMethod.transfer +
            reconciliation.expensesByMethod.card +
            reconciliation.expensesByMethod.other,
          purchases:
            reconciliation.purchasesByMethod.nequi +
            reconciliation.purchasesByMethod.daviplata +
            reconciliation.purchasesByMethod.transfer +
            reconciliation.purchasesByMethod.card +
            reconciliation.purchasesByMethod.other,
        },
        totalRevenue: reconciliation.totalRevenue,
        totalExpenses: reconciliation.totalExpenses,
        operationalResult: reconciliation.operationalResult,
        reconciliation,
      },
      sales: {
        total: salesTotal,
        count: sales.length,
        itemsSold,
        canceledCount,
        pendingCount,
        byPaymentMethod: salesByPaymentMethod,
        byChannel: salesByChannel,
        byTable: salesByTable,
        byDelivery: salesByDelivery,
        byProduct: salesByProduct,
        bestSellers: salesByProduct.slice(0, 10),
        leastSellers: rankedProductPerformance.filter((item) => item.quantity > 0).slice(0, 10),
        nonMovingProducts: rankedProductPerformance.filter((item) => item.quantity === 0).slice(0, 10),
        adjustments: {
          count: saleDetails.filter((sale) => sale.discount > 0).length,
          total: saleDetails.reduce((acc, sale) => acc + sale.discount, 0),
          details: saleDetails.filter((sale) => sale.discount > 0),
        },
        commandasClosed: saleDetails.filter((sale) => sale.orderTicketNumber),
        chargedOrders: saleDetails,
        details: saleDetails,
      },
      purchases: {
        total: purchasesTotal,
        count: purchases.length,
        details: purchaseDetails,
      },
      expenses: {
        total: expensesTotal,
        count: expenses.length,
        details: expenseDetails,
      },
      metrics: {
        costOfSales,
        grossProfit,
        netProfit,
      },
      observations: options?.forcedObservations ?? selectedSession?.notes ?? '',
      replenishment: {
        lowStock: supply.alerts.filter((item) => item.severity === 'BAJO'),
        criticalStock: supply.alerts.filter((item) => item.severity === 'CRITICO'),
        outOfStock: supply.alerts.filter((item) => item.severity === 'AGOTADO'),
        productLowStock: supply.lowStockProducts
          .filter((product) => {
            const currentStock = toNumber(product.currentStock);
            const stockMin = toNumber(product.stockMin);
            return currentStock > 0 && currentStock > stockMin / 2;
          })
          .map((product) => this.mapProductStockAlert(product, 'BAJO')),
        productCriticalStock: supply.lowStockProducts
          .filter((product) => {
            const currentStock = toNumber(product.currentStock);
            const stockMin = toNumber(product.stockMin);
            return currentStock > 0 && currentStock <= stockMin / 2;
          })
          .map((product) => this.mapProductStockAlert(product, 'CRITICO')),
        productOutOfStock: supply.lowStockProducts
          .filter((product) => toNumber(product.currentStock) <= 0)
          .map((product) => this.mapProductStockAlert(product, 'AGOTADO')),
        groupedBySupplier: supply.groupedBySupplier,
      },
      settings: {
        printSignature: reportsConfig.printSignature ?? true,
        timezone: reportsConfig.timezone ?? 'America/Bogota',
      },
    };
  }

  private async renderDailyPdf(data: any): Promise<Buffer> {
    const document = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
    const buffers: Buffer[] = [];

    document.on('data', (chunk) => buffers.push(chunk as Buffer));

    await this.renderPremiumHeader(document, data);

    this.renderSectionTitle(
      document,
      'Resumen ejecutivo',
      'Visión general de la jornada, caja, utilidad y trazabilidad financiera.',
      180,
    );

    this.renderMetricCards(
      document,
      [
        { label: 'Estado de jornada', value: this.journeyStatusLabel(data.journey.status) },
        { label: 'Hora de apertura', value: this.formatDateTimeLabel(data.journey.openedAt, data.settings?.timezone) },
        { label: 'Hora de cierre', value: this.formatDateTimeLabel(data.journey.closedAt, data.settings?.timezone) },
        { label: 'Caja inicial', value: this.formatCurrency(data.cash.physical?.openingCash ?? data.cash.openingAmount) },
        { label: 'Caja física esperada', value: this.formatCurrency(data.cash.physical?.expectedPhysicalCash ?? data.cash.expectedAmount) },
        { label: 'Efectivo contado', value: this.formatCurrency(data.cash.physical?.countedPhysicalCash ?? data.cash.actualAmount) },
        { label: 'Diferencia efectivo', value: this.formatCurrency(data.cash.physical?.cashDifference ?? data.cash.difference) },
        { label: 'Recaudo digital', value: this.formatCurrency(data.cash.digital?.revenue ?? 0) },
        { label: 'Total recaudado', value: this.formatCurrency(data.cash.totalRevenue ?? data.sales.total) },
        { label: 'Total egresos', value: this.formatCurrency(data.cash.totalExpenses ?? 0) },
        { label: 'Resultado operativo', value: this.formatCurrency(data.cash.operationalResult ?? data.metrics.netProfit) },
      ],
      4,
      'compact',
    );

    this.renderMetricCards(
      document,
      [
        { label: 'Ventas registradas', value: `${(data.sales.count ?? 0).toLocaleString('es-CO')}` },
        { label: 'Compras registradas', value: `${(data.purchases.count ?? 0).toLocaleString('es-CO')}` },
        { label: 'Gastos registrados', value: `${(data.expenses.count ?? 0).toLocaleString('es-CO')}` },
        { label: 'Ventas con ajuste', value: `${(data.sales.adjustments?.count ?? 0).toLocaleString('es-CO')}` },
        { label: 'Costo de ventas', value: this.formatCurrency(data.metrics.costOfSales) },
        { label: 'Utilidad bruta', value: this.formatCurrency(data.metrics.grossProfit) },
        { label: 'Utilidad neta', value: this.formatCurrency(data.metrics.netProfit) },
        { label: 'Ventas totales', value: this.formatCurrency(data.sales.total) },
        { label: 'Ajuste total', value: this.formatCurrency(data.sales.adjustments?.total ?? 0) },
      ],
      4,
      'compact',
    );

    this.renderSectionTitle(
      document,
      'Recaudo, caja física y canales',
      'Separación entre efectivo del cajón, recaudo digital y distribución de la venta.',
      this.estimateTableStartHeight(document, {
        title: 'Recaudo por método de pago',
        headers: ['Método de pago', 'Total'],
        widths: [355, 120],
        rows: (data.sales.byPaymentMethod ?? []).map((item: any) => [
          item.paymentMethod,
          this.formatCurrency(item.total),
        ]),
        numericColumns: [1],
        emptyRow: ['Sin pagos registrados', '—'],
      }),
    );

    const methodLabels = data.cash.reconciliation?.methodLabels ?? {
      cash: 'Efectivo',
      nequi: 'Nequi',
      daviplata: 'Daviplata',
      transfer: 'Transferencia',
      card: 'Tarjeta',
      other: 'Otros',
    };

    this.renderStyledTable(document, {
      title: 'Caja física',
      headers: ['Concepto', 'Valor'],
      widths: [300, 175],
      rows: [
        ['Dinero inicial', this.formatCurrency(data.cash.physical?.openingCash ?? data.cash.openingAmount)],
        ['Ventas en efectivo', this.formatCurrency(data.cash.physical?.cashRevenue ?? 0)],
        ['Gastos en efectivo', this.formatCurrency(data.cash.physical?.cashExpenses ?? 0)],
        ['Compras en efectivo', this.formatCurrency(data.cash.physical?.cashPurchases ?? 0)],
        ['Caja física esperada', this.formatCurrency(data.cash.physical?.expectedPhysicalCash ?? data.cash.expectedAmount)],
        ['Efectivo contado', this.formatCurrency(data.cash.physical?.countedPhysicalCash ?? data.cash.actualAmount)],
        ['Diferencia de efectivo', this.formatCurrency(data.cash.physical?.cashDifference ?? data.cash.difference)],
      ],
      numericColumns: [1],
      emptyRow: ['Sin caja física', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Recaudo por método de pago',
      headers: ['Método de pago', 'Total'],
      widths: [355, 120],
      rows: (data.sales.byPaymentMethod ?? []).map((item: any) => [
        item.paymentMethod,
        this.formatCurrency(item.total),
      ]),
      numericColumns: [1],
      emptyRow: ['Sin pagos registrados', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Egresos por método de pago',
      headers: ['Método', 'Gastos', 'Compras'],
      widths: [195, 140, 140],
      rows: ['cash', 'nequi', 'daviplata', 'transfer', 'card', 'other'].map((method) => [
        methodLabels[method] ?? method,
        this.formatCurrency(data.cash.reconciliation?.expensesByMethod?.[method] ?? 0),
        this.formatCurrency(data.cash.reconciliation?.purchasesByMethod?.[method] ?? 0),
      ]),
      numericColumns: [1, 2],
      emptyRow: ['Sin egresos', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Resultado operativo',
      headers: ['Concepto', 'Valor'],
      widths: [300, 175],
      rows: [
        ['Total ventas', this.formatCurrency(data.cash.totalRevenue ?? data.sales.total)],
        ['Total egresos', this.formatCurrency(data.cash.totalExpenses ?? 0)],
        ['Resultado operativo', this.formatCurrency(data.cash.operationalResult ?? data.metrics.netProfit)],
        ['Domicilios cobrados', this.formatCurrency(data.cash.reconciliation?.delivery?.totalFee ?? 0)],
      ],
      numericColumns: [1],
      emptyRow: ['Sin resultado operativo', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Ventas por canal',
      headers: ['Canal', 'Pedidos', 'Total'],
      widths: [220, 90, 165],
      rows: (data.sales.byChannel ?? []).map((item: any) => [
        item.label,
        item.count.toLocaleString('es-CO'),
        this.formatCurrency(item.total),
      ]),
      numericColumns: [1, 2],
      emptyRow: ['Sin ventas por canal', '—', '—'],
    });

    this.renderSectionTitle(
      document,
      'Detalle operativo de venta',
      'Seguimiento de mesas, domicilios y comandas cerradas del período.',
      this.estimateTableStartHeight(document, {
        title: 'Ventas por mesa',
        headers: ['Mesa', 'Pedidos', 'Total'],
        widths: [220, 90, 165],
        rows: (data.sales.byTable ?? []).map((item: any) => [
          item.tableLabel,
          item.count.toLocaleString('es-CO'),
          this.formatCurrency(item.total),
        ]),
        numericColumns: [1, 2],
        emptyRow: ['Sin ventas por mesa', '—', '—'],
      }),
    );

    this.renderStyledTable(document, {
      title: 'Ventas por mesa',
      headers: ['Mesa', 'Pedidos', 'Total'],
      widths: [220, 90, 165],
      rows: (data.sales.byTable ?? []).map((item: any) => [
        item.tableLabel,
        item.count.toLocaleString('es-CO'),
        this.formatCurrency(item.total),
      ]),
      numericColumns: [1, 2],
      emptyRow: ['Sin ventas por mesa', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Pedidos a domicilio',
      headers: ['Pedido', 'Cliente / referencia', 'Total'],
      widths: [90, 275, 110],
      rows: (data.sales.byDelivery ?? []).map((item: any) => [
        item.number,
        `${item.customerName} - ${item.reference}`,
        this.formatCurrency(item.total),
      ]),
      numericColumns: [2],
      emptyRow: ['Sin domicilios', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Comandas cerradas',
      headers: ['Comanda', 'Canal', 'Detalle', 'Total'],
      widths: [85, 95, 210, 85],
      rows: (data.sales.commandasClosed ?? []).slice(0, 24).map((sale: any) => [
        sale.orderTicketNumber ?? sale.number,
        sale.channel,
        sale.tableLabel ?? sale.deliveryReference ?? sale.customerName ?? 'Operación general',
        this.formatCurrency(sale.total),
      ]),
      numericColumns: [3],
      emptyRow: ['Sin comandas', '—', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Ventas con ajuste manual',
      headers: ['Venta', 'Canal', 'Subtotal base', 'Ajuste', 'Total'],
      widths: [85, 90, 105, 95, 100],
      rows: (data.sales.adjustments?.details ?? []).map((sale: any) => [
        sale.number,
        sale.channel,
        this.formatCurrency(sale.subtotal),
        this.formatCurrency(sale.discount),
        this.formatCurrency(sale.total),
      ]),
      numericColumns: [2, 3, 4],
      emptyRow: ['Sin ajustes manuales', '—', '—', '—', '—'],
    });

    this.renderSectionTitle(
      document,
      'Ranking comercial',
      'Lectura de rotación para decisiones de venta, compra y producción.',
      this.estimateTableStartHeight(document, {
        title: 'Top vendidos',
        headers: ['Producto', 'Cantidad', 'Venta'],
        widths: [250, 85, 140],
        rows: (data.sales.bestSellers ?? []).map((item: any) => [
          item.productName,
          item.quantity.toLocaleString('es-CO'),
          this.formatCurrency(item.total),
        ]),
        numericColumns: [1, 2],
        emptyRow: ['Sin ventas en el período', '—', '—'],
      }),
    );

    this.renderStyledTable(document, {
      title: 'Top vendidos',
      headers: ['Producto', 'Cantidad', 'Venta'],
      widths: [250, 85, 140],
      rows: (data.sales.bestSellers ?? []).map((item: any) => [
        item.productName,
        item.quantity.toLocaleString('es-CO'),
        this.formatCurrency(item.total),
      ]),
      numericColumns: [1, 2],
      emptyRow: ['Sin ventas en el período', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Menor salida',
      headers: ['Producto', 'Cantidad', 'Venta'],
      widths: [250, 85, 140],
      rows: (data.sales.leastSellers ?? []).map((item: any) => [
        item.productName,
        item.quantity.toLocaleString('es-CO'),
        this.formatCurrency(item.total),
      ]),
      numericColumns: [1, 2],
      emptyRow: ['Sin datos de menor salida', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Productos sin rotación',
      headers: ['Producto', 'Categoría', 'Stock'],
      widths: [220, 155, 100],
      rows: (data.sales.nonMovingProducts ?? []).map((item: any) => [
        item.productName,
        item.categoryName,
        item.trackStock ? item.currentStock.toLocaleString('es-CO') : 'Por receta',
      ]),
      numericColumns: [2],
      emptyRow: ['Sin productos inmóviles', '—', '—'],
    });

    this.renderSectionTitle(
      document,
      'Compras y gastos del período',
      'Consolidado administrativo del impacto de operación y abastecimiento.',
      this.estimateTableStartHeight(document, {
        title: 'Compras registradas',
        headers: ['Compra', 'Proveedor', 'Responsable', 'Valor'],
        widths: [95, 165, 125, 90],
        rows: (data.purchases.details ?? []).map((purchase: any) => [
          purchase.number,
          purchase.supplierName,
          purchase.createdBy,
          this.formatCurrency(purchase.total),
        ]),
        numericColumns: [3],
        emptyRow: ['Sin compras', '—', '—', '—'],
      }),
    );

    this.renderStyledTable(document, {
      title: 'Compras registradas',
      headers: ['Compra', 'Proveedor', 'Responsable', 'Valor'],
      widths: [95, 165, 125, 90],
      rows: (data.purchases.details ?? []).map((purchase: any) => [
        purchase.number,
        purchase.supplierName,
        purchase.createdBy,
        this.formatCurrency(purchase.total),
      ]),
      numericColumns: [3],
      emptyRow: ['Sin compras', '—', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Gastos registrados',
      headers: ['Concepto', 'Método', 'Responsable', 'Valor'],
      widths: [170, 100, 115, 90],
      rows: (data.expenses.details ?? []).map((expense: any) => [
        expense.concept,
        expense.paymentMethod,
        expense.createdBy,
        this.formatCurrency(expense.total),
      ]),
      numericColumns: [3],
      emptyRow: ['Sin gastos', '—', '—', '—'],
    });

    this.renderSectionTitle(
      document,
      'Observaciones y abastecimiento recomendado',
      'Hallazgos del cierre y prioridades para la siguiente operación.',
      190,
    );

    this.renderParagraphBlock(
      document,
      'Observaciones del día',
      data.observations || 'Sin observaciones registradas para la jornada.',
    );

    this.renderMetricCards(
      document,
      [
        { label: 'Insumos agotados', value: String((data.replenishment.outOfStock ?? []).length) },
        { label: 'Insumos críticos', value: String((data.replenishment.criticalStock ?? []).length) },
        { label: 'Insumos bajos', value: String((data.replenishment.lowStock ?? []).length) },
        { label: 'Productos agotados', value: String((data.replenishment.productOutOfStock ?? []).length) },
        { label: 'Productos críticos', value: String((data.replenishment.productCriticalStock ?? []).length) },
        { label: 'Productos bajos', value: String((data.replenishment.productLowStock ?? []).length) },
        { label: 'Menor salida', value: String((data.sales.leastSellers ?? []).length) },
        { label: 'Sin rotación', value: String((data.sales.nonMovingProducts ?? []).length) },
      ],
      4,
      'compact',
    );

    this.renderStyledTable(document, {
      title: 'Alertas de insumos',
      headers: ['Insumo', 'Estado', 'Stock', 'Pedido sugerido', 'Proveedor'],
      widths: [145, 70, 65, 95, 100],
      rows: [
        ...(data.replenishment.outOfStock ?? []).map((item: any) => [
          item.ingredientName,
          'Agotado',
          item.currentStock.toLocaleString('es-CO'),
          item.suggestedReorderLabel,
          item.supplier?.name ?? 'Proveedor pendiente',
        ]),
        ...(data.replenishment.criticalStock ?? []).map((item: any) => [
          item.ingredientName,
          'Crítico',
          item.currentStock.toLocaleString('es-CO'),
          item.suggestedReorderLabel,
          item.supplier?.name ?? 'Proveedor pendiente',
        ]),
        ...(data.replenishment.lowStock ?? []).map((item: any) => [
          item.ingredientName,
          'Bajo',
          item.currentStock.toLocaleString('es-CO'),
          item.suggestedReorderLabel,
          item.supplier?.name ?? 'Proveedor pendiente',
        ]),
      ],
      emptyRow: ['Sin alertas de insumos', '—', '—', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Alertas de productos directos',
      headers: ['Producto directo', 'Estado', 'Stock actual', 'Mínimo'],
      widths: [220, 95, 80, 80],
      rows: [
        ...(data.replenishment.productOutOfStock ?? []).map((item: any) => [
          item.productName,
          'Agotado',
          item.currentStock.toLocaleString('es-CO'),
          item.stockMin.toLocaleString('es-CO'),
        ]),
        ...(data.replenishment.productCriticalStock ?? []).map((item: any) => [
          item.productName,
          'Crítico',
          item.currentStock.toLocaleString('es-CO'),
          item.stockMin.toLocaleString('es-CO'),
        ]),
        ...(data.replenishment.productLowStock ?? []).map((item: any) => [
          item.productName,
          'Bajo',
          item.currentStock.toLocaleString('es-CO'),
          item.stockMin.toLocaleString('es-CO'),
        ]),
      ],
      numericColumns: [2, 3],
      emptyRow: ['Sin productos directos en alerta', '—', '—', '—'],
    });

    this.renderStyledTable(document, {
      title: 'Proveedores sugeridos',
      headers: ['Proveedor', 'Alertas', 'WhatsApp'],
      widths: [210, 80, 185],
      rows: (data.replenishment.groupedBySupplier ?? []).map((group: any) => [
        group.supplierName,
        group.items.length.toLocaleString('es-CO'),
        group.supplierPhone ?? 'Sin teléfono',
      ]),
      numericColumns: [1],
      emptyRow: ['Sin proveedores sugeridos', '—', '—'],
    });

    if (data.settings?.printSignature) {
      this.renderSignatureBlock(document);
    }

    this.renderFooter(document, data);
    document.end();

    return new Promise<Buffer>((resolve) => {
      document.on('end', () => resolve(Buffer.concat(buffers)));
    });
  }

  private async renderPremiumHeader(document: any, data: any) {
    const x = 42;
    const y = 34;
    const width = 511;
    const height = 216;
    const leftWidth = 302;
    const rightWidth = 177;
    const gap = 12;

    document.roundedRect(x, y, width, height, 22).fillAndStroke('#FAF6EE', '#EAD8BC');
    document.roundedRect(x + 16, y + 16, leftWidth, 102, 18).fillAndStroke('#FFFFFF', '#E7E5E4');
    document.roundedRect(x + 16 + leftWidth + gap, y + 16, rightWidth, 102, 18).fillAndStroke('#FFF8ED', '#EAD8BC');
    document.roundedRect(x + 16, y + 130, width - 32, 56, 18).fillAndStroke('#FFFFFF', '#E7E5E4');

    let logoShiftX = 0;
    if (data.business.logoUrl) {
      try {
        const response = await fetch(data.business.logoUrl);
        if (response.ok) {
          const imageBuffer = Buffer.from(await response.arrayBuffer());
          document.image(imageBuffer, x + 28, y + 28, {
            fit: [54, 54],
            align: 'center',
            valign: 'center',
          });
          logoShiftX = 66;
        }
      } catch {
        // Ignorar error del logo.
      }
    }

    const businessNameX = x + 28 + logoShiftX;
    const businessTextWidth = leftWidth - 24 - logoShiftX;

    document.font('Helvetica-Bold').fontSize(22).fillColor('#1A1A1A').text(
      this.safeValue(data.business.name, 'Negocio'),
      businessNameX,
      y + 28,
      {
        width: businessTextWidth,
        lineGap: 1,
      },
    );

    document.font('Helvetica').fontSize(9.4).fillColor('#525252').text(
      this.safeValue(data.business.address, 'Dirección no configurada'),
      businessNameX,
      y + 58,
      {
        width: businessTextWidth,
        lineGap: 2,
      },
    );

    document.font('Helvetica-Bold').fontSize(8).fillColor('#8A5A16').text('Teléfono', businessNameX, y + 94, {
      width: 56,
      lineBreak: false,
    });
    document.font('Helvetica').fontSize(9.2).fillColor('#525252').text(
      this.safeValue(data.business.phone, 'No configurado'),
      businessNameX + 58,
      y + 93.2,
      {
        width: Math.max(0, businessTextWidth - 58),
        lineBreak: false,
      },
    );

    const rightX = x + 16 + leftWidth + gap + 14;
    const rightContentWidth = rightWidth - 28;
    document.font('Helvetica-Bold').fontSize(15).fillColor('#8A5A16').text('Cierre diario', rightX, y + 28, {
      width: rightContentWidth,
      align: 'left',
      lineBreak: false,
    });
    this.renderStatusChip(
      document,
      rightX,
      y + 52,
      104,
      this.journeyStatusLabel(data.journey.status).toUpperCase(),
    );
    this.renderMetaPair(document, 'Período', `${data.period.start} al ${data.period.end}`, rightX, y + 82, rightContentWidth);

    const statGap = 10;
    const statWidth = ((width - 32) - statGap * 3) / 4;
    const statY = y + 142;
    const statX = x + 28;

    this.renderHeroStatCard(document, statX, statY, statWidth, 32, 'Ventas totales', this.formatCurrency(data.sales.total));
    this.renderHeroStatCard(document, statX + statWidth + statGap, statY, statWidth, 32, 'Utilidad neta', this.formatCurrency(data.metrics.netProfit));
    this.renderHeroStatCard(document, statX + (statWidth + statGap) * 2, statY, statWidth, 32, 'Caja esperada', this.formatCurrency(data.cash.expectedAmount));
    this.renderHeroStatCard(document, statX + (statWidth + statGap) * 3, statY, statWidth, 32, 'Diferencia', this.formatCurrency(data.cash.difference));

    document.font('Helvetica-Bold').fontSize(8).fillColor('#8A5A16').text('Responsable', x + 20, y + 196, {
      width: 82,
      lineBreak: false,
    });
    document.font('Helvetica').fontSize(9).fillColor('#525252').text(
      this.safeValue(data.journey.responsibleUser, 'Sin responsable'),
      x + 102,
      y + 195.2,
      { width: 200, lineBreak: false },
    );

    document.font('Helvetica-Bold').fontSize(8).fillColor('#8A5A16').text('Generado', x + 318, y + 196, {
      width: 60,
      lineBreak: false,
    });
    document.font('Helvetica').fontSize(9).fillColor('#525252').text(
      this.formatDateTimeLabel(data.metadata?.generatedAt ?? new Date().toISOString(), data.settings?.timezone),
      x + 380,
      y + 195.2,
      { width: 115, align: 'right', lineBreak: false },
    );

    document.y = y + height + 8;
  }

  private renderStatusChip(document: any, x: number, y: number, width: number, label: string) {
    document.roundedRect(x, y, width, 22, 10).fillAndStroke('#FFFFFF', '#EAD8BC');
    document.font('Helvetica-Bold').fontSize(8.2).fillColor('#8A5A16').text(label, x, y + 7, {
      width,
      align: 'center',
    });
  }

  private renderMetaPair(document: any, label: string, value: string, x: number, y: number, width: number) {
    document.font('Helvetica-Bold').fontSize(8).fillColor('#8A5A16').text(label, x, y, {
      width,
      align: 'left',
      lineBreak: false,
    });
    document.font('Helvetica').fontSize(9.2).fillColor('#525252').text(this.safeValue(value, '—'), x, y + 11, {
      width,
      align: 'left',
    });
  }

  private renderHeroStatCard(
    document: any,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    value: string,
  ) {
    document.roundedRect(x, y, width, height, 12).fillAndStroke('#FAF6EE', '#EAD8BC');

    document.font('Helvetica-Bold').fontSize(7.5).fillColor('#8A5A16').text(label.toUpperCase(), x + 8, y + 7, {
      width: width - 16,
      lineBreak: false,
    });

    document.font('Helvetica-Bold').fontSize(10.8).fillColor('#1A1A1A').text(this.safeValue(value, '—'), x + 8, y + 18, {
      width: width - 16,
      lineBreak: false,
    });
  }

  private renderSectionTitle(document: any, title: string, subtitle?: string, nextBlockMinHeight = 0) {
    const selfHeight = subtitle ? 56 : 34;
    this.ensureSectionStart(document, selfHeight + nextBlockMinHeight);

    document.y += 6;
    const startY = document.y;

    document.roundedRect(42, startY + 2, 8, subtitle ? 38 : 24, 4).fill('#E09F3E');

    document.font('Helvetica-Bold').fontSize(14).fillColor('#1A1A1A').text(title, 60, startY, {
      width: 430,
      lineBreak: false,
    });

    if (subtitle) {
      document.font('Helvetica').fontSize(9.2).fillColor('#6B7280').text(subtitle, 60, startY + 18, {
        width: 450,
        lineGap: 2,
      });
      document.strokeColor('#E7E5E4').lineWidth(1).moveTo(42, startY + 46).lineTo(553, startY + 46).stroke();
      document.y = startY + 50;
    } else {
      document.strokeColor('#E7E5E4').lineWidth(1).moveTo(42, startY + 30).lineTo(553, startY + 30).stroke();
      document.y = startY + 34;
    }
  }

  private renderMetricCards(
    document: any,
    items: Array<{ label: string; value: string }>,
    columns = 4,
    variant: 'default' | 'compact' = 'default',
  ) {
    const contentWidth = 511;
    const gap = 10;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = variant === 'compact' ? 56 : 64;

    for (let index = 0; index < items.length; index += columns) {
      this.ensurePageSpace(document, cardHeight + 14);

      const rowY = document.y + 6;
      const rowItems = items.slice(index, index + columns);

      rowItems.forEach((item, column) => {
        const x = 42 + column * (cardWidth + gap);

        document.roundedRect(x, rowY, cardWidth, cardHeight, 13).fillAndStroke('#FAFAF9', '#E7E5E4');

        document.font('Helvetica-Bold').fontSize(7.7).fillColor('#6B7280').text(item.label.toUpperCase(), x + 10, rowY + 9, {
          width: cardWidth - 20,
          lineGap: 1,
        });

        document.font('Helvetica-Bold').fontSize(variant === 'compact' ? 10.2 : 11.2).fillColor('#1A1A1A').text(
          this.safeValue(item.value, '—'),
          x + 10,
          rowY + 28,
          { width: cardWidth - 20, lineGap: 1 },
        );
      });

      document.y = rowY + cardHeight + gap;
    }
  }

  private renderParagraphBlock(document: any, title: string, text: string) {
    const x = 42;
    const boxWidth = 511;
    const textWidth = 483;

    document.font('Helvetica').fontSize(9.5);
    const textHeight = document.heightOfString(text, {
      width: textWidth,
      lineGap: 2,
    });

    const boxHeight = Math.max(76, 36 + textHeight);
    this.ensurePageSpace(document, boxHeight + 10);

    const y = document.y + 6;

    document.roundedRect(x, y, boxWidth, boxHeight, 16).fillAndStroke('#FAFAF9', '#E7E5E4');

    document.roundedRect(x + 14, y + 12, 148, 18, 9).fillAndStroke('#FAF6EE', '#EAD8BC');
    document.font('Helvetica-Bold').fontSize(8.1).fillColor('#8A5A16').text(title.toUpperCase(), x + 14, y + 18, {
      width: 132,
      align: 'center',
    });

    document.font('Helvetica').fontSize(9.5).fillColor('#404040').text(text, x + 14, y + 38, {
      width: textWidth,
      lineGap: 2,
    });

    document.y = y + boxHeight + 6;
  }

  private renderStyledTable(
    document: any,
    options: {
      title?: string;
      headers: string[];
      widths: number[];
      rows: string[][];
      numericColumns?: number[];
      emptyRow: string[];
    },
  ) {
    const rows = options.rows.length ? options.rows : [options.emptyRow];
    const startX = 42;
    const tableWidth = options.widths.reduce((sum, width) => sum + width, 0);
    const headerHeight = 28;
    const minRowsAtStart = Math.min(2, rows.length);

    const drawTableHeading = () => {
      if (options.title) {
        document.roundedRect(startX, document.y + 2, tableWidth, 18, 9).fillAndStroke('#FAF6EE', '#EAD8BC');
        document.font('Helvetica-Bold').fontSize(8.8).fillColor('#8A5A16').text(options.title, startX + 10, document.y + 8, {
          width: tableWidth - 20,
          lineBreak: false,
        });
        document.y += 24;
      }

      const headerY = document.y + 4;
      document.roundedRect(startX, headerY, tableWidth, headerHeight, 10).fillAndStroke('#F5F5F4', '#E7E5E4');

      let x = startX;
      options.headers.forEach((header, index) => {
        const width = options.widths[index] ?? 0;
        document.font('Helvetica-Bold').fontSize(8.45).fillColor('#44403C').text(header, x + 8, headerY + 8, {
          width: width - 16,
          align: options.numericColumns?.includes(index) ? 'right' : 'left',
        });
        x += width;
      });

      document.y = headerY + headerHeight + 4;
    };

    const initialBlockHeight = this.estimateTableStartHeight(document, options, minRowsAtStart);
    const fullTableHeight = this.estimateFullTableHeight(document, options);
    this.ensureTableStart(document, initialBlockHeight, fullTableHeight, rows.length);
    drawTableHeading();

    rows.forEach((row, rowIndex) => {
      const safeRow = row.map((cell, index) =>
        this.pdfCell(cell, this.approxCellLimit(options.widths[index] ?? 80)),
      );

      const heights = safeRow.map((cell, index) => {
        const width = options.widths[index] ?? 0;
        return document.heightOfString(cell, {
          width: width - 16,
          align: options.numericColumns?.includes(index) ? 'right' : 'left',
          lineGap: 1,
        });
      });

      const rowHeight = Math.max(30, ...heights) + 10;
      const remainingRows = rows.length - rowIndex - 1;

      const nextRowsHeight =
        remainingRows > 0
          ? this.estimateRowsHeight(
              document,
              rows.slice(rowIndex + 1, rowIndex + 3),
              options.widths,
              options.numericColumns,
            )
          : 0;

      if (document.y + rowHeight + (remainingRows > 0 ? nextRowsHeight : 0) > this.pageBottom(document)) {
        document.addPage();
        drawTableHeading();
      }

      const y = document.y;

      document.roundedRect(startX, y, tableWidth, rowHeight, 9).fillAndStroke(
        rowIndex % 2 === 0 ? '#FFFFFF' : '#FBFBFA',
        '#ECE7E1',
      );

      let x = startX;
      safeRow.forEach((cell, index) => {
        const width = options.widths[index] ?? 0;
        document.font('Helvetica').fontSize(8.8).fillColor('#262626').text(cell, x + 8, y + 6, {
          width: width - 16,
          align: options.numericColumns?.includes(index) ? 'right' : 'left',
          lineGap: 1,
        });
        x += width;
      });

      document.y = y + rowHeight + 4;
    });

    document.y += 2;
  }

  private renderSignatureBlock(document: any) {
    const x = 42;
    const width = 511;
    const height = 76;

    this.ensurePageSpace(document, height + 16);
    document.moveDown(0.5);

    const y = document.y + 4;

    document.roundedRect(x, y, width, height, 16).fillAndStroke('#FAFAF9', '#E7E5E4');
    document.font('Helvetica-Bold').fontSize(10.2).fillColor('#1A1A1A').text('Validación del cierre', x + 14, y + 12);
    document.font('Helvetica').fontSize(9.1).fillColor('#525252').text(
      'Espacio para firma y validación final del cierre por el responsable de la jornada.',
      x + 14,
      y + 28,
      { width: width - 28, lineGap: 1 },
    );

    document.strokeColor('#CFC7BC').lineWidth(1).moveTo(x + 14, y + 58).lineTo(x + 220, y + 58).stroke();
    document.font('Helvetica').fontSize(9.2).fillColor('#525252').text('Firma responsable', x + 14, y + 62);

    document.y = y + height + 8;
  }

  private renderFooter(document: any, data: any) {
    const range = document.bufferedPageRange();

    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      document.switchToPage(pageIndex);

      const page = document.page;
      const footerLineY = page.height - page.margins.bottom - 20;
      const footerTextY = footerLineY + 8;
      const contentWidth = page.width - page.margins.left - page.margins.right;

      document
        .moveTo(page.margins.left, footerLineY)
        .lineTo(page.width - page.margins.right, footerLineY)
        .strokeColor('#E7E5E4')
        .lineWidth(1)
        .stroke();

      document.font('Helvetica').fontSize(8).fillColor('#78716C').text(
        `${this.safeValue(data.business?.name, 'Negocio')} - Cierre diario`,
        page.margins.left,
        footerTextY,
        {
          width: contentWidth / 2,
          align: 'left',
          lineBreak: false,
        },
      );

      document.font('Helvetica').fontSize(8).fillColor('#78716C').text(
        `Página ${pageIndex - range.start + 1} de ${range.count}`,
        page.margins.left,
        footerTextY,
        {
          width: contentWidth,
          align: 'right',
          lineBreak: false,
        },
      );
    }
  }

  private ensurePageSpace(document: any, height: number) {
    if (document.y + height > this.pageBottom(document)) {
      document.addPage();
    }
  }

  private ensureSectionStart(document: any, height: number) {
    if (document.y > 505 || document.y + height > this.pageBottom(document)) {
      document.addPage();
    }
  }

  private estimateTableStartHeight(
    document: any,
    options: {
      title?: string;
      headers: string[];
      widths: number[];
      rows: string[][];
      numericColumns?: number[];
      emptyRow: string[];
    },
    sampleRowCount = 2,
  ) {
    const rows = options.rows.length ? options.rows : [options.emptyRow];
    const titleHeight = options.title ? 28 : 0;
    const headerHeight = 34;
    const sampleRows = rows.slice(0, Math.min(rows.length, sampleRowCount));
    const rowsHeight = this.estimateRowsHeight(document, sampleRows, options.widths, options.numericColumns);

    return titleHeight + headerHeight + rowsHeight + 14;
  }

  private estimateFullTableHeight(
    document: any,
    options: {
      title?: string;
      headers: string[];
      widths: number[];
      rows: string[][];
      numericColumns?: number[];
      emptyRow: string[];
    },
  ) {
    const rows = options.rows.length ? options.rows : [options.emptyRow];
    const titleHeight = options.title ? 28 : 0;
    const headerHeight = 34;
    const rowsHeight = this.estimateRowsHeight(document, rows, options.widths, options.numericColumns);
    return titleHeight + headerHeight + rowsHeight + 18;
  }

  private estimateRowsHeight(
    document: any,
    rows: string[][],
    widths: number[],
    numericColumns?: number[],
  ) {
    if (!rows.length) {
      return 40;
    }

    return rows.reduce((acc: number, row: string[]) => {
      const safeRow = row.map((cell, index) =>
        this.pdfCell(cell, this.approxCellLimit(widths[index] ?? 80)),
      );

      const heights = safeRow.map((cell, index) => {
        const width = widths[index] ?? 0;
        return document.heightOfString(cell, {
          width: width - 16,
          align: numericColumns?.includes(index) ? 'right' : 'left',
          lineGap: 1,
        });
      });

      return acc + Math.max(30, ...heights) + 14;
    }, 0);
  }

  private ensureTableStart(document: any, initialHeight: number, fullHeight: number, rowCount: number) {
    const pageCapacity = this.pageBottom(document) - document.page.margins.top;

    if (rowCount <= 5 && fullHeight <= pageCapacity && document.y + fullHeight > this.pageBottom(document)) {
      document.addPage();
      return;
    }

    if (document.y + initialHeight > this.pageBottom(document)) {
      document.addPage();
    }
  }

  private pageBottom(document: any) {
    return document.page.height - document.page.margins.bottom - 18;
  }

  private approxCellLimit(width: number) {
    return Math.max(16, Math.floor((width - 16) / 5.25));
  }

  private safeValue(value: unknown, fallback = '—') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  private mapProductStockAlert(
    product: {
      id: string;
      code: string;
      name: string;
      category?: { name: string } | null;
      unit?: { abbreviation: string } | null;
      currentStock: Prisma.Decimal;
      stockMin: Prisma.Decimal | null;
    },
    severity: 'BAJO' | 'CRITICO' | 'AGOTADO',
  ) {
    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      categoryName: product.category?.name ?? null,
      unit: product.unit?.abbreviation ?? 'unit',
      currentStock: toNumber(product.currentStock),
      stockMin: toNumber(product.stockMin),
      missingQty: Math.max(toNumber(product.stockMin) - toNumber(product.currentStock), 0),
      suggestedQuantity: Math.max(Math.ceil(toNumber(product.stockMin) * 2 - toNumber(product.currentStock)), 1),
      severity,
    };
  }

  private pdfCell(value: unknown, max = 48) {
    const text = String(value ?? '—').replace(/\s+/g, ' ').trim();
    if (text.length <= max) {
      return text || '—';
    }
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }

  private journeyStatusLabel(status: string | null | undefined) {
    switch (status) {
      case 'ABIERTA':
        return 'Abierta';
      case 'CERRADA':
        return 'Cerrada';
      case 'PENDIENTE_APERTURA':
        return 'Pendiente apertura';
      default:
        return 'Sin estado';
    }
  }

  private async findDailyClosureSnapshot(start: Date, end: Date) {
    return this.prisma.reportSnapshot.findFirst({
      where: {
        type: DAILY_CLOSURE_TYPE,
        periodStart: start,
        periodEnd: end,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  private buildSupplierMessage(
    supplierName: string,
    items: Array<{
      ingredientName: string;
      currentStock: number;
      suggestedQuantity: number;
      unit: string;
      severity: string;
    }>,
    notes?: string,
  ) {
    const lines = items.map(
      (item) =>
        `- ${item.ingredientName}: solicitar ${item.suggestedQuantity.toLocaleString('es-CO')} ${item.unit} (stock actual ${item.currentStock.toLocaleString('es-CO')}, nivel ${item.severity.toLowerCase()})`,
    );

    return [
      `Hola ${supplierName},`,
      'Te compartimos una solicitud de abastecimiento de 2x1 Burger Co.',
      `Fecha: ${new Date().toLocaleDateString('es-CO')}`,
      '',
      'Insumos sugeridos:',
      ...lines,
      '',
      notes ? `Observación: ${notes}` : 'Quedamos atentos a disponibilidad y tiempos de entrega.',
      'Gracias.',
    ].join('\n');
  }

  private buildWhatsappLink(phone: string | null, message: string) {
    if (!phone) {
      return null;
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone) {
      return null;
    }

    return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
  }

  private channelLabel(channel: SaleChannel) {
    switch (channel) {
      case SaleChannel.MESA:
        return 'Mesa';
      case SaleChannel.DOMICILIO:
        return 'Domicilio';
      case SaleChannel.PARA_LLEVAR:
        return 'Para llevar';
      case SaleChannel.MOSTRADOR:
      default:
        return 'Mostrador';
    }
  }

  private formatCurrency(value: number | null | undefined) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value ?? 0);
  }

  private formatDateTimeLabel(value: string | null, timeZone = 'America/Bogota') {
    if (!value) {
      return 'Sin registro';
    }

    return new Intl.DateTimeFormat('es-CO', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  }

  private getHourInTimezone(date: Date, timeZone = 'America/Bogota') {
    return Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        hour12: false,
      }).format(date),
    );
  }
}
