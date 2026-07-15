import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  CashMovementType,
  CashSessionStatus,
  InventoryMovementType,
  OrderTicketStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { toDecimal, toNumber } from '../../common/utils/decimal.util';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';
import { ReportsService } from '../reports/reports.service';
import { CreateManualCashMovementDto } from './dto/create-manual-cash-movement.dto';
import { ReopenCashSessionDto } from './dto/reopen-cash-session.dto';
import { getDayRange } from '../../common/utils/date-range.util';
import { CashReconciliationService } from './cash-reconciliation.service';

const CASH_LIFECYCLE_LOCK_ID = 2_025_001;

@Injectable()
export class CashRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly reportsService: ReportsService,
    private readonly whatsappService: WhatsappService,
    private readonly cashReconciliationService: CashReconciliationService,
  ) {}

  async getCurrent() {
    const session = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      include: {
        openedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        reopenedFromSession: true,
        movements: {
          include: {
            paymentMethod: true,
            createdBy: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    return session ?? null;
  }

  history() {
    return this.prisma.cashSession.findMany({
      include: {
        openedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        closedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        reopenedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        reopenedFromSession: true,
      },
      orderBy: { openedAt: 'desc' },
      take: 60,
    });
  }

  async open(dto: OpenCashSessionDto, actorId: string) {
    const session = await this.prisma.$transaction(async (tx) => {
      await this.acquireCashLifecycleLock(tx);
      const current = await tx.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN },
        select: { id: true },
      });

      if (current) {
        throw new ConflictException('Ya existe una sesión de caja abierta.');
      }

      const created = await tx.cashSession.create({
        data: {
          openedById: actorId,
          openingAmount: toDecimal(dto.openingAmount),
          notes: dto.notes,
          openingBreakdown: dto.openingBreakdown,
          movements: {
            create: {
              type: CashMovementType.OPENING,
              amount: toDecimal(dto.openingAmount),
              description: dto.notes ?? 'Apertura de caja',
              createdById: actorId,
            },
          },
        },
        include: {
          movements: true,
        },
      });
      await this.auditService.log({
        userId: actorId,
        action: 'OPEN',
        module: 'cash-register',
        entity: 'cash_session',
        entityId: created.id,
        before: { status: 'CLOSED' },
        after: { status: created.status, openingAmount: created.openingAmount },
      }, tx);
      return created;
    });

    return session;
  }

  async close(dto: CloseCashSessionDto, actorId: string) {
    const readiness = await this.getCloseReadiness(dto.actualAmount);
    if (!readiness.canClose) {
      throw new BadRequestException(
        readiness.blockers[0] ?? 'No puedes cerrar la caja hasta resolver las validaciones previas.',
      );
    }

    const session = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      include: {
        movements: {
          include: {
            paymentMethod: true,
          },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    if (!session) {
      throw new BadRequestException('No hay una sesión de caja abierta.');
    }

    const reconciliation = await this.cashReconciliationService.buildForSession(session.id, dto.actualAmount);
    const expectedAmount = toDecimal(reconciliation.expectedPhysicalCash);
    const closingAmount = toDecimal(dto.actualAmount);
    const difference = closingAmount.sub(expectedAmount);

    const closedSession = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.cashSession.updateMany({
        where: { id: session.id, status: CashSessionStatus.OPEN },
        data: {
          status: CashSessionStatus.CLOSED,
          closedById: actorId,
          closedAt: new Date(),
          closingAmount,
          expectedAmount,
          difference,
          notes: dto.notes ?? session.notes,
          closingBreakdown: dto.closingBreakdown,
        },
      });
      if (updateResult.count === 0) {
        throw new ConflictException('La caja ya fue cerrada o no está abierta.');
      }
      await tx.cashMovement.create({
        data: {
          cashSessionId: session.id,
          type: CashMovementType.CLOSING,
          amount: closingAmount,
          description: dto.notes ?? 'Cash closing',
          createdById: actorId,
        },
      });
      const closed = await tx.cashSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { movements: true },
      });
      await this.auditService.log({
        userId: actorId,
        action: 'CLOSE',
        module: 'cash-register',
        entity: 'cash_session',
        entityId: session.id,
        before: { status: session.status },
        after: {
          status: closed.status,
          actualAmount: dto.actualAmount,
          expectedAmount: expectedAmount.toString(),
          difference: difference.toString(),
        },
        metadata: { reconciliation },
      }, tx);
      return closed;
    });

    const closureSnapshot = await this.reportsService.captureDailyClosure(closedSession.id, actorId, dto.notes);
    await this.invalidateAllWaiterSessions(actorId, closedSession.id);

    let whatsappDispatch:
      | {
          success: boolean;
          skipped?: boolean;
          reason?: string;
          groupJid?: string;
          groupLabel?: string | null;
          sentAt?: string;
        }
      | null = null;

    try {
      whatsappDispatch = await this.whatsappService.sendClosingSummary(closureSnapshot.id, actorId);
    } catch (error) {
      whatsappDispatch = {
        success: false,
        skipped: false,
        reason: error instanceof Error ? error.message : String(error),
      };

      await this.auditService.log({
        userId: actorId,
        action: 'SEND_FAILED',
        module: 'whatsapp',
        entity: 'daily_closure',
        entityId: closureSnapshot.id,
        newValues: {
          channel: 'whatsapp_internal_group',
          error: whatsappDispatch.reason,
        },
      });
    }

    return {
      ...closedSession,
      dailyClosure: {
        id: closureSnapshot.id,
      },
      notifications: {
        whatsapp: whatsappDispatch,
      },
    };
  }

  async reopen(dto: ReopenCashSessionDto, actorId: string) {
    const reopenedSession = await this.prisma.$transaction(async (tx) => {
      await this.acquireCashLifecycleLock(tx);
      const current = await tx.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN },
        select: { id: true },
      });
      if (current) {
        throw new ConflictException('Ya existe una sesión abierta. Debes cerrarla antes de reabrir otra.');
      }

      const targetSession = dto.sessionId
        ? await tx.cashSession.findUnique({
            where: { id: dto.sessionId },
            include: { movements: true },
          })
        : await tx.cashSession.findFirst({
            where: { status: CashSessionStatus.CLOSED },
            include: { movements: true },
            orderBy: { closedAt: 'desc' },
          });

      if (!targetSession || targetSession.status !== CashSessionStatus.CLOSED) {
        throw new BadRequestException('No hay un cierre válido para reabrir.');
      }

      const openingAmount =
        targetSession.closingAmount ?? targetSession.expectedAmount ?? targetSession.openingAmount;

      await tx.cashSession.update({
        where: { id: targetSession.id },
        data: {
          reopenedAt: new Date(),
          reopenedById: actorId,
          reopenReason: dto.reason,
        },
      });

      const created = await tx.cashSession.create({
        data: {
          openedById: actorId,
          openingAmount,
          notes: `Reapertura controlada · ${dto.reason}`,
          reopenedFromSessionId: targetSession.id,
          openingBreakdown: targetSession.closingBreakdown ?? undefined,
          movements: {
            create: {
              type: CashMovementType.OPENING,
              amount: openingAmount,
              description: `Reapertura controlada desde ${targetSession.id}`,
              classification: 'REAPERTURA_CONTROLADA',
              createdById: actorId,
            },
          },
        },
        include: {
          movements: true,
          reopenedFromSession: true,
        },
      });
      await this.auditService.log({
        userId: actorId,
        action: 'REOPEN',
        module: 'cash-register',
        entity: 'cash_session',
        entityId: created.id,
        before: { sourceSessionId: targetSession.id, status: targetSession.status },
        after: { status: created.status, openingAmount: created.openingAmount },
        reasonCode: 'CASH_SESSION_REOPENED',
        reasonText: dto.reason,
      }, tx);
      return created;
    });

    return reopenedSession;
  }

  private async acquireCashLifecycleLock(tx: Prisma.TransactionClient) {
    const lock = await tx.$queryRaw<Array<{ acquired: number }>>`
      SELECT 1::int AS acquired
      FROM pg_advisory_xact_lock(${CASH_LIFECYCLE_LOCK_ID})
    `;
    if (lock[0]?.acquired !== 1) {
      throw new ConflictException('No fue posible adquirir el bloqueo de ciclo de caja.');
    }
  }

  async createManualMovement(dto: CreateManualCashMovementDto, actorId: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      orderBy: { openedAt: 'desc' },
    });

    if (!session) {
      throw new BadRequestException('No hay una caja abierta para registrar movimientos manuales.');
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cashMovement.create({
        data: {
          cashSessionId: session.id,
          type: dto.type,
          amount: toDecimal(dto.amount),
          description: dto.description ?? dto.classification,
          classification: dto.classification,
          paymentMethodId: dto.paymentMethodId,
          createdById: actorId,
        },
        include: { paymentMethod: true, createdBy: true },
      });
      await this.auditService.log({
        userId: actorId,
        action: 'CREATE_MANUAL_MOVEMENT',
        module: 'cash-register',
        entity: 'cash_movement',
        entityId: created.id,
        after: {
          cashSessionId: session.id,
          type: created.type,
          amount: created.amount,
          classification: created.classification,
        },
      }, tx);
      return created;
    });

    return movement;
  }

  async getDailySummary(actualAmount?: number) {
    return this.cashReconciliationService.buildCurrent(actualAmount ?? null);
  }

  async getCloseReadiness(actualAmount?: number) {
    const session = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      include: {
        openedBy: true,
        movements: {
          include: {
            paymentMethod: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    if (!session) {
      return {
        hasSession: false,
        canClose: false,
        blockers: ['No hay una sesión de caja abierta.'],
        warnings: [],
        session: null,
        actualAmount: actualAmount ?? null,
        expectedAmount: 0,
        difference: actualAmount != null ? actualAmount : null,
        reconciliation: await this.cashReconciliationService.buildCurrent(actualAmount ?? null),
        summary: {
          salesTotal: 0,
          purchasesTotal: 0,
          expensesTotal: 0,
          adjustedSalesCount: 0,
          manualMovementsCount: 0,
        },
        activeOrdersCount: 0,
        paymentMismatchCount: 0,
        uncategorizedExpensesCount: 0,
      };
    }

    const [activeOrdersCount, paidSales, uncategorizedExpenses, expensesAggregate, purchasesAggregate] =
      await Promise.all([
      this.prisma.orderTicket.count({
        where: {
          cashSessionId: session.id,
          status: {
            in: [
              OrderTicketStatus.OPEN,
              OrderTicketStatus.IN_PREPARATION,
              OrderTicketStatus.SERVED,
              OrderTicketStatus.PAYMENT_PENDING,
            ],
          },
        },
      }),
      this.prisma.sale.findMany({
        where: {
          cashSessionId: session.id,
          status: 'PAID',
        },
        include: {
          payments: true,
        },
      }),
      this.prisma.expense.findMany({
        where: {
          cashSessionId: session.id,
          OR: [{ classification: null }, { classification: '' }],
        },
        include: {
          createdBy: true,
          paymentMethod: true,
        },
      }),
      this.prisma.expense.aggregate({
        where: {
          cashSessionId: session.id,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.purchase.aggregate({
        where: {
          purchasedAt: {
            gte: session.openedAt,
            lte: new Date(),
          },
        },
        _sum: {
          total: true,
        },
      }),
    ]);

    const paymentMismatches = paidSales
      .map((sale) => {
        const paymentTotal = sale.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
        const total = toNumber(sale.total);
        const difference = Math.abs(paymentTotal - total);

        return {
          id: sale.id,
          number: sale.number,
          total,
          paymentTotal,
          difference,
        };
      })
      .filter((sale) => sale.difference > 0.01);

    const reconciliation = await this.cashReconciliationService.buildForSession(session.id, actualAmount ?? null);
    const expectedAmount = toDecimal(reconciliation.expectedPhysicalCash);
    const difference = reconciliation.cashDifference;
    const adjustedSalesCount = paidSales.filter((sale) => toNumber(sale.discount) > 0).length;
    const manualMovementsCount = session.movements.filter(
      (movement) =>
        movement.type === CashMovementType.OTHER_EXPENSE || movement.type === CashMovementType.OTHER_INCOME,
    ).length;

    const blockers = [
      activeOrdersCount > 0
        ? `Hay ${activeOrdersCount} comanda${activeOrdersCount === 1 ? '' : 's'} activa${activeOrdersCount === 1 ? '' : 's'} por cobrar o cerrar.`
        : null,
      paymentMismatches.length > 0
        ? `Existen ${paymentMismatches.length} venta${paymentMismatches.length === 1 ? '' : 's'} con pagos descuadrados.`
        : null,
      uncategorizedExpenses.length > 0
        ? `Hay ${uncategorizedExpenses.length} gasto${uncategorizedExpenses.length === 1 ? '' : 's'} sin clasificación.`
        : null,
    ].filter(Boolean) as string[];

    return {
      hasSession: true,
      canClose: blockers.length === 0,
      blockers,
      warnings: [
        adjustedSalesCount > 0
          ? `Se detectaron ${adjustedSalesCount} venta${adjustedSalesCount === 1 ? '' : 's'} con ajuste manual.`
          : null,
        difference != null && Math.abs(difference) > 0.01
          ? 'El arqueo todavía muestra diferencia contra la caja esperada.'
          : null,
      ].filter(Boolean),
      session: {
        id: session.id,
        openedAt: session.openedAt,
        openedBy: session.openedBy
          ? {
              fullName: session.openedBy.fullName,
              email: session.openedBy.email,
            }
          : null,
        openingAmount: toNumber(session.openingAmount),
        expectedAmount: toNumber(expectedAmount),
      },
      actualAmount: actualAmount ?? null,
      expectedAmount: toNumber(expectedAmount),
      difference,
      summary: {
        salesTotal: paidSales.reduce((sum, sale) => sum + toNumber(sale.total), 0),
        purchasesTotal: toNumber(purchasesAggregate._sum.total),
        expensesTotal: toNumber(expensesAggregate._sum.amount),
        adjustedSalesCount,
        manualMovementsCount,
      },
      reconciliation,
      activeOrdersCount,
      paymentMismatchCount: paymentMismatches.length,
      uncategorizedExpensesCount: uncategorizedExpenses.length,
      paymentMismatches: paymentMismatches.slice(0, 10),
      uncategorizedExpenses: uncategorizedExpenses.slice(0, 10).map((expense) => ({
        id: expense.id,
        concept: expense.concept,
        classification: expense.classification,
        amount: toNumber(expense.amount),
        spentAt: expense.spentAt.toISOString(),
        paymentMethod: expense.paymentMethod?.name ?? null,
        createdBy: expense.createdBy?.fullName ?? null,
      })),
    };
  }

  async getOperationalLog(date?: string) {
    const { start, end } = getDayRange(date);
    const [cashSessions, sales, purchases, expenses, closures, inventoryMoves] = await Promise.all([
      this.prisma.cashSession.findMany({
        where: {
          OR: [
            { openedAt: { gte: start, lt: end } },
            { closedAt: { gte: start, lt: end } },
            { reopenedAt: { gte: start, lt: end } },
          ],
        },
        include: {
          openedBy: true,
          closedBy: true,
          reopenedBy: true,
        },
      }),
      this.prisma.sale.findMany({
        where: { soldAt: { gte: start, lt: end } },
        include: { createdBy: true },
      }),
      this.prisma.purchase.findMany({
        where: { purchasedAt: { gte: start, lt: end } },
        include: { createdBy: true, supplier: true },
      }),
      this.prisma.expense.findMany({
        where: { spentAt: { gte: start, lt: end } },
        include: { createdBy: true },
      }),
      this.prisma.reportSnapshot.findMany({
        where: { type: 'DAILY_CLOSURE', createdAt: { gte: start, lt: end } },
        include: { generatedBy: true },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          occurredAt: { gte: start, lt: end },
          type: {
            in: [
              InventoryMovementType.ADJUSTMENT,
              InventoryMovementType.WASTE,
              InventoryMovementType.DAMAGE,
            ],
          },
        },
        include: { performedBy: true, product: true, ingredient: true },
        take: 20,
        orderBy: { occurredAt: 'desc' },
      }),
    ]);

    const items = [
      ...cashSessions.flatMap((session) => {
        const events = [
          {
            id: `${session.id}-open`,
            at: session.openedAt,
            type: 'CAJA_APERTURA',
            title: 'Caja abierta',
            detail: `Apertura por ${session.openedBy.fullName}`,
            amount: toNumber(session.openingAmount),
          },
        ];

        if (session.reopenedAt && session.reopenedBy) {
          events.push({
            id: `${session.id}-reopen`,
            at: session.reopenedAt,
            type: 'CAJA_REAPERTURA',
            title: 'Caja reabierta',
            detail: session.reopenReason ?? `Reapertura por ${session.reopenedBy.fullName}`,
            amount: toNumber(session.closingAmount ?? session.expectedAmount),
          });
        }

        if (session.closedAt && session.closedBy) {
          events.push({
            id: `${session.id}-close`,
            at: session.closedAt,
            type: 'CAJA_CIERRE',
            title: 'Caja cerrada',
            detail: `Cierre por ${session.closedBy.fullName}`,
            amount: toNumber(session.closingAmount),
          });
        }

        return events;
      }),
      ...sales.map((sale) => ({
        id: sale.id,
        at: sale.soldAt,
        type: 'VENTA',
        title: `Venta ${sale.number}`,
        detail: sale.createdBy.fullName,
        amount: toNumber(sale.total),
      })),
      ...purchases.map((purchase) => ({
        id: purchase.id,
        at: purchase.purchasedAt,
        type: 'COMPRA',
        title: `Compra ${purchase.number}`,
        detail: purchase.supplier.name,
        amount: toNumber(purchase.total),
      })),
      ...expenses.map((expense) => ({
        id: expense.id,
        at: expense.spentAt,
        type: 'GASTO',
        title: expense.concept,
        detail: expense.createdBy.fullName,
        amount: toNumber(expense.amount),
      })),
      ...closures.map((closure) => ({
        id: closure.id,
        at: closure.createdAt,
        type: 'CIERRE_DIARIO',
        title: 'Snapshot de cierre diario',
        detail: closure.generatedBy?.fullName ?? 'Sistema',
        amount: 0,
      })),
      ...inventoryMoves.map((movement) => ({
        id: movement.id,
        at: movement.occurredAt,
        type: 'INVENTARIO',
        title: movement.referenceType ?? movement.type,
        detail: movement.product?.name ?? movement.ingredient?.name ?? 'Inventario',
        amount: toNumber(movement.quantity),
      })),
    ]
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
      .slice(0, 80);

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      items,
    };
  }

  private async invalidateAllWaiterSessions(actorId: string, cashSessionId: string) {
    const waiters = await this.prisma.user.findMany({
      where: {
        isActive: true,
        roles: {
          some: {
            role: {
              name: {
                in: ['waiter', 'delivery'],
              },
            },
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!waiters.length) {
      return;
    }

    const revokedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: {
          userId: {
            in: waiters.map((waiter) => waiter.id),
          },
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      });

      await Promise.all(
        waiters.map((waiter) =>
          tx.user.update({
            where: { id: waiter.id },
            data: {
              sessionVersion: {
                increment: 1,
              },
            },
          }),
        ),
      );
    });

    await this.auditService.log({
      userId: actorId,
      action: 'FORCE_LOGOUT',
      module: 'cash-register',
      entity: 'cash_session',
      entityId: cashSessionId,
      newValues: {
        affectedOperationalUsers: waiters.length,
      },
    });
  }
}
