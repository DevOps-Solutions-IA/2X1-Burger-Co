import { Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, Prisma, SaleChannel, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toNumber } from '../../common/utils/decimal.util';

type MethodBucket = 'cash' | 'nequi' | 'daviplata' | 'transfer' | 'card' | 'other';

type PaymentMethodLike = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
};

type AmountByMethod = Record<MethodBucket, number>;

const METHOD_BUCKETS: MethodBucket[] = ['cash', 'nequi', 'daviplata', 'transfer', 'card', 'other'];

function emptyByMethod(): AmountByMethod {
  return {
    cash: 0,
    nequi: 0,
    daviplata: 0,
    transfer: 0,
    card: 0,
    other: 0,
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeMethodBucket(paymentMethod?: PaymentMethodLike | null): MethodBucket {
  const code = paymentMethod?.code?.toLowerCase().trim();

  if (!code || code === 'cash' || code === 'efectivo') {
    return 'cash';
  }

  if (code === 'nequi') {
    return 'nequi';
  }

  if (code === 'daviplata' || code === 'daviplata ') {
    return 'daviplata';
  }

  if (['transfer', 'transferencia', 'bank_transfer'].includes(code)) {
    return 'transfer';
  }

  if (['card', 'tarjeta', 'credit_card', 'debit_card'].includes(code)) {
    return 'card';
  }

  return 'other';
}

function addAmount(target: AmountByMethod, paymentMethod: PaymentMethodLike | null | undefined, amount: number) {
  const bucket = normalizeMethodBucket(paymentMethod);
  target[bucket] = roundMoney(target[bucket] + amount);
}

function sumMethods(amounts: AmountByMethod, buckets: MethodBucket[] = METHOD_BUCKETS) {
  return roundMoney(buckets.reduce((sum, bucket) => sum + amounts[bucket], 0));
}

@Injectable()
export class CashReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async buildCurrent(countedPhysicalCash?: number | null) {
    const session = await this.prisma.cashSession.findFirst({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });

    if (!session) {
      return this.emptySummary(countedPhysicalCash ?? null);
    }

    return this.buildForSession(session.id, countedPhysicalCash);
  }

  async buildForSession(sessionId: string, countedPhysicalCash?: number | null) {
    const session = await this.prisma.cashSession.findUnique({
      where: { id: sessionId },
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
        movements: {
          include: {
            paymentMethod: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('No se encontró la sesión de caja.');
    }

    const [sales, expenses, purchases] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          cashSessionId: session.id,
          status: SaleStatus.PAID,
        },
        include: {
          payments: {
            include: {
              paymentMethod: true,
            },
          },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          cashSessionId: session.id,
        },
        include: {
          paymentMethod: true,
        },
      }),
      this.prisma.purchase.findMany({
        where: {
          cashSessionId: session.id,
          status: 'RECEIVED',
        },
        include: {
          paymentMethod: true,
        },
      }),
    ]);

    return this.buildFromRecords({
      session,
      sales,
      expenses,
      purchases,
      countedPhysicalCash: countedPhysicalCash ?? (session.closingAmount != null ? toNumber(session.closingAmount) : null),
    });
  }

  async buildForPeriod(start: Date, end: Date, options?: { sessionId?: string; countedPhysicalCash?: number | null }) {
    if (options?.sessionId) {
      return this.buildForSession(options.sessionId, options.countedPhysicalCash);
    }

    const [sales, expenses, purchases] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          soldAt: { gte: start, lt: end },
          status: SaleStatus.PAID,
        },
        include: {
          payments: {
            include: {
              paymentMethod: true,
            },
          },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          spentAt: { gte: start, lt: end },
        },
        include: {
          paymentMethod: true,
        },
      }),
      this.prisma.purchase.findMany({
        where: {
          purchasedAt: { gte: start, lt: end },
          status: 'RECEIVED',
        },
        include: {
          paymentMethod: true,
        },
      }),
    ]);

    return this.buildFromRecords({
      session: null,
      sales,
      expenses,
      purchases,
      countedPhysicalCash: options?.countedPhysicalCash ?? null,
    });
  }

  private buildFromRecords(input: {
    session: {
      id: string;
      status: string;
      openedAt: Date;
      closedAt: Date | null;
      openingAmount: Prisma.Decimal;
      closingAmount: Prisma.Decimal | null;
      expectedAmount: Prisma.Decimal | null;
      difference: Prisma.Decimal | null;
      openedBy?: { id: string; fullName: string; email: string } | null;
      closedBy?: { id: string; fullName: string; email: string } | null;
      movements: Array<{
        type: CashMovementType;
        amount: Prisma.Decimal;
        referenceType: string | null;
        referenceId: string | null;
        paymentMethod: PaymentMethodLike | null;
      }>;
    } | null;
    sales: Array<{
      id: string;
      channel: SaleChannel;
      deliveryFee: Prisma.Decimal;
      total: Prisma.Decimal;
      payments: Array<{
        amount: Prisma.Decimal;
        paymentMethod: PaymentMethodLike;
      }>;
    }>;
    expenses: Array<{
      id: string;
      amount: Prisma.Decimal;
      paymentMethod: PaymentMethodLike | null;
    }>;
    purchases: Array<{
      id: string;
      total: Prisma.Decimal;
      paymentMethod: PaymentMethodLike | null;
    }>;
    countedPhysicalCash: number | null;
  }) {
    const salesByMethod = emptyByMethod();
    const expensesByMethod = emptyByMethod();
    const purchasesByMethod = emptyByMethod();
    const deliveryFeeByMethod = emptyByMethod();

    for (const sale of input.sales) {
      for (const payment of sale.payments) {
        addAmount(salesByMethod, payment.paymentMethod, toNumber(payment.amount));
      }

      if (sale.channel === SaleChannel.DOMICILIO && toNumber(sale.deliveryFee) > 0) {
        const total = toNumber(sale.total);
        const deliveryFee = toNumber(sale.deliveryFee);

        for (const payment of sale.payments) {
          const paymentAmount = toNumber(payment.amount);
          const allocatedFee = total > 0 ? (deliveryFee * paymentAmount) / total : 0;
          addAmount(deliveryFeeByMethod, payment.paymentMethod, allocatedFee);
        }
      }
    }

    for (const expense of input.expenses) {
      addAmount(expensesByMethod, expense.paymentMethod, toNumber(expense.amount));
    }

    for (const purchase of input.purchases) {
      addAmount(purchasesByMethod, purchase.paymentMethod, toNumber(purchase.total));
    }

    const manualCash = this.calculateManualCash(input.session?.movements ?? []);
    const openingCash = toNumber(input.session?.openingAmount ?? 0);
    const cashRevenue = salesByMethod.cash;
    const digitalRevenue = sumMethods(salesByMethod, ['nequi', 'daviplata', 'transfer', 'card', 'other']);
    const totalSales = sumMethods(salesByMethod);
    const totalRevenue = roundMoney(cashRevenue + digitalRevenue);
    const cashExpenses = expensesByMethod.cash;
    const digitalExpenses = sumMethods(expensesByMethod, ['nequi', 'daviplata', 'transfer', 'card', 'other']);
    const cashPurchases = purchasesByMethod.cash;
    const digitalPurchases = sumMethods(purchasesByMethod, ['nequi', 'daviplata', 'transfer', 'card', 'other']);
    const totalExpenses = roundMoney(cashExpenses + digitalExpenses + cashPurchases + digitalPurchases + manualCash.otherExpense);
    const expectedPhysicalCash = roundMoney(
      openingCash + cashRevenue + manualCash.otherIncome + manualCash.adjustment - cashExpenses - cashPurchases - manualCash.otherExpense,
    );
    const countedPhysicalCash = input.countedPhysicalCash;
    const cashDifference =
      countedPhysicalCash == null ? null : roundMoney(countedPhysicalCash - expectedPhysicalCash);
    const operationalResult = roundMoney(totalRevenue - totalExpenses);

    const deliveryCount = input.sales.filter((sale) => sale.channel === SaleChannel.DOMICILIO).length;
    const deliveryFeeTotal = roundMoney(input.sales.reduce((sum, sale) => sum + toNumber(sale.deliveryFee), 0));

    return {
      session: input.session
        ? {
            id: input.session.id,
            status: input.session.status,
            openedAt: input.session.openedAt.toISOString(),
            closedAt: input.session.closedAt?.toISOString() ?? null,
            openedBy: input.session.openedBy ?? null,
            closedBy: input.session.closedBy ?? null,
          }
        : null,
      openingCash,
      salesByMethod,
      expensesByMethod,
      purchasesByMethod,
      cashRevenue,
      digitalRevenue,
      totalSales,
      totalRevenue,
      totalExpenses,
      expectedPhysicalCash,
      countedPhysicalCash,
      cashDifference,
      operationalResult,
      manualCash,
      delivery: {
        count: deliveryCount,
        totalFee: deliveryFeeTotal,
        feeByMethod: deliveryFeeByMethod,
      },
      methodLabels: {
        cash: 'Efectivo',
        nequi: 'Nequi',
        daviplata: 'Daviplata',
        transfer: 'Transferencia',
        card: 'Tarjeta',
        other: 'Otros',
      },
      formulas: {
        expectedPhysicalCash:
          'openingCash + cashSales + cashOtherIncome + cashAdjustments - cashExpenses - cashPurchases - cashOtherExpense',
        digitalRevenue: 'nequiSales + daviplataSales + transferSales + cardSales + otherSales',
        totalRevenue: 'cashRevenue + digitalRevenue',
        totalExpenses: 'cashExpenses + digitalExpenses + cashPurchases + digitalPurchases + manualCashOtherExpense',
        cashDifference: 'countedPhysicalCash - expectedPhysicalCash',
      },
    };
  }

  private calculateManualCash(
    movements: Array<{
      type: CashMovementType;
      amount: Prisma.Decimal;
      referenceType: string | null;
      referenceId: string | null;
      paymentMethod: PaymentMethodLike | null;
    }>,
  ) {
    return movements.reduce(
      (totals, movement) => {
        const method = normalizeMethodBucket(movement.paymentMethod);
        if (method !== 'cash') {
          return totals;
        }

        const amount = toNumber(movement.amount);
        const isLinkedSale = movement.type === CashMovementType.SALE && movement.referenceType === 'sale';
        const isLinkedExpense = movement.type === CashMovementType.EXPENSE && movement.referenceType === 'expense';
        const isLinkedPurchase = movement.type === CashMovementType.EXPENSE && movement.referenceType === 'purchase';

        if (isLinkedSale || isLinkedExpense || isLinkedPurchase) {
          return totals;
        }

        if (movement.type === CashMovementType.OTHER_INCOME) {
          totals.otherIncome = roundMoney(totals.otherIncome + amount);
        }

        if (movement.type === CashMovementType.OTHER_EXPENSE) {
          totals.otherExpense = roundMoney(totals.otherExpense + amount);
        }

        if (movement.type === CashMovementType.ADJUSTMENT) {
          totals.adjustment = roundMoney(totals.adjustment + amount);
        }

        return totals;
      },
      { otherIncome: 0, otherExpense: 0, adjustment: 0 },
    );
  }

  private emptySummary(countedPhysicalCash: number | null) {
    const zero = emptyByMethod();

    return {
      session: null,
      openingCash: 0,
      salesByMethod: { ...zero },
      expensesByMethod: { ...zero },
      purchasesByMethod: { ...zero },
      cashRevenue: 0,
      digitalRevenue: 0,
      totalSales: 0,
      totalRevenue: 0,
      totalExpenses: 0,
      expectedPhysicalCash: 0,
      countedPhysicalCash,
      cashDifference: countedPhysicalCash == null ? null : countedPhysicalCash,
      operationalResult: 0,
      manualCash: { otherIncome: 0, otherExpense: 0, adjustment: 0 },
      delivery: {
        count: 0,
        totalFee: 0,
        feeByMethod: { ...zero },
      },
      methodLabels: {
        cash: 'Efectivo',
        nequi: 'Nequi',
        daviplata: 'Daviplata',
        transfer: 'Transferencia',
        card: 'Tarjeta',
        other: 'Otros',
      },
      formulas: {
        expectedPhysicalCash:
          'openingCash + cashSales + cashOtherIncome + cashAdjustments - cashExpenses - cashPurchases - cashOtherExpense',
        digitalRevenue: 'nequiSales + daviplataSales + transferSales + cardSales + otherSales',
        totalRevenue: 'cashRevenue + digitalRevenue',
        totalExpenses: 'cashExpenses + digitalExpenses + cashPurchases + digitalPurchases + manualCashOtherExpense',
        cashDifference: 'countedPhysicalCash - expectedPhysicalCash',
      },
    };
  }
}
