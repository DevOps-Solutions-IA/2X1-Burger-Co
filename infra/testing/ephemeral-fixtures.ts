import { CashSessionStatus, OrderTicketStatus, OrderTicketType, PrismaClient, SaleChannel, SaleStatus } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();
const FIXED_TIME = new Date('2026-01-15T15:00:00.000Z');

async function upsertUser(email: string, fullName: string, password: string, roleName?: string) {
  const role = roleName ? await prisma.role.findUniqueOrThrow({ where: { name: roleName } }) : null;
  return prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      passwordHash: await hash(password, 12),
      isActive: true,
      roles: {
        deleteMany: {},
        create: role ? [{ roleId: role.id }] : [],
      },
    },
    create: {
      email,
      fullName,
      passwordHash: await hash(password, 12),
      isActive: true,
      roles: { create: role ? [{ roleId: role.id }] : [] },
    },
  });
}

async function main() {
  const database = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const databaseName = database[0]?.current_database ?? '';
  const runId = process.env.EPHEMERAL_TEST_RUN_ID ?? '';
  const marker = runId.replace(/-/g, '_').slice(-24);
  if (process.env.EPHEMERAL_TEST_MODE !== 'true' || !databaseName.endsWith('_test') || !databaseName.includes(marker)) {
    throw new Error('Ephemeral fixture seed refused a non-scoped database.');
  }

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: process.env.ADMIN_EMAIL } });
  await upsertUser('supervisor.e2e@invalid.local', 'E2E Supervisor', 'Supervisor-E2E-2300!', 'supervisor');
  await upsertUser('no-access.e2e@invalid.local', 'E2E No Access', 'NoAccess-E2E-2300!');

  const [product, paymentMethod] = await Promise.all([
    prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } }),
    prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } }),
  ]);
  const productPrice = Number(product.salePrice);

  const closedCash = await prisma.cashSession.upsert({
    where: { id: 'e2e-cash-closed' },
    update: {},
    create: {
      id: 'e2e-cash-closed',
      status: CashSessionStatus.CLOSED,
      openedById: admin.id,
      closedById: admin.id,
      openingAmount: 10000,
      closingAmount: 10000,
      expectedAmount: 10000,
      difference: 0,
      notes: 'Deterministic closed fixture',
      openedAt: FIXED_TIME,
      closedAt: new Date(FIXED_TIME.getTime() + 60_000),
    },
  });
  const openCash = await prisma.cashSession.upsert({
    where: { id: 'e2e-cash-open' },
    update: {},
    create: {
      id: 'e2e-cash-open',
      status: CashSessionStatus.OPEN,
      openedById: admin.id,
      openingAmount: 0,
      notes: 'Deterministic open fixture',
      openedAt: new Date(FIXED_TIME.getTime() + 120_000),
    },
  });

  await prisma.sale.upsert({
    where: { id: 'e2e-sale-fixture' },
    update: {},
    create: {
      id: 'e2e-sale-fixture',
      number: 'E2E-SALE-0001',
      status: SaleStatus.PAID,
      channel: SaleChannel.MOSTRADOR,
      subtotal: productPrice,
      total: productPrice,
      createdById: admin.id,
      cashSessionId: closedCash.id,
      soldAt: FIXED_TIME,
      items: {
        create: [{ productId: product.id, quantity: 1, unitPrice: productPrice, totalPrice: productPrice }],
      },
      payments: {
        create: [{ paymentMethodId: paymentMethod.id, amount: productPrice }],
      },
    },
  });

  await prisma.orderTicket.upsert({
    where: { id: 'e2e-order-fixture' },
    update: {},
    create: {
      id: 'e2e-order-fixture',
      number: 'E2E-ORDER-0001',
      status: OrderTicketStatus.OPEN,
      type: OrderTicketType.COUNTER,
      revision: 1,
      cashSessionId: closedCash.id,
      createdById: admin.id,
      subtotal: productPrice,
      openedAt: FIXED_TIME,
      items: {
        create: [{ productId: product.id, quantity: 1, unitPrice: productPrice, totalPrice: productPrice }],
      },
    },
  });

  const customer = await prisma.deliveryCustomer.upsert({
    where: { phone: '573000002399' },
    update: {},
    create: {
      id: 'e2e-delivery-customer',
      phone: '573000002399',
      phoneNormalized: '573000002399',
      fullName: 'E2E Delivery Customer',
      defaultAddress: 'Synthetic address 2300',
    },
  });
  await prisma.orderTicket.upsert({
    where: { id: 'e2e-delivery-fixture' },
    update: {},
    create: {
      id: 'e2e-delivery-fixture',
      number: 'E2E-DELIVERY-0001',
      status: OrderTicketStatus.OPEN,
      type: OrderTicketType.DELIVERY,
      revision: 1,
      deliveryCustomerId: customer.id,
      customerName: customer.fullName,
      customerPhone: customer.phone,
      deliveryReference: customer.defaultAddress,
      deliveryFee: 9000,
      deliveryFeeSuggested: 9000,
      deliveryPricingStatus: 'FINAL',
      deliveryCalculationVersion: 'e2e-v1',
      deliveryWorkflowStatus: 'PENDING_ASSIGNMENT',
      cashSessionId: closedCash.id,
      createdById: admin.id,
      subtotal: productPrice + 9000,
      openedAt: FIXED_TIME,
      items: {
        create: [{ productId: product.id, quantity: 1, unitPrice: productPrice, totalPrice: productPrice }],
      },
    },
  });

  process.stdout.write(`${JSON.stringify({ status: 'PASS', aliases: ['admin', 'supervisor', 'cashier', 'waiter', 'delivery', 'no-access', 'open-cash', 'closed-cash', 'sale', 'order', 'delivery'] })}\n`);
}

void main().finally(() => prisma.$disconnect());
