import {
  CashSessionStatus,
  CrmLeadSource,
  CrmLeadStatus,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTaskType,
  CustomerIdentityType,
  CustomerServiceCaseCategory,
  CustomerServiceCaseStatus,
  OrderCheckoutSource,
  OrderCheckoutStatus,
  OrderTicketStatus,
  OrderTicketType,
  PaymentIntentProvider,
  PaymentIntentStatus,
  PrismaClient,
  SaleChannel,
  SaleStatus,
  SofiaOrderSource,
  SofiaPaymentPreference,
  WhatsappConversationStatus,
  WhatsappMessageDirection,
  WhatsappMessageType,
} from '@prisma/client';
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

  const crmCustomer = await prisma.customer.upsert({
    where: { id: 'e2e-crm-customer' },
    update: { displayName: 'E2E Customer 360', displayNameNormalized: 'e2e customer 360' },
    create: {
      id: 'e2e-crm-customer',
      displayName: 'E2E Customer 360',
      displayNameNormalized: 'e2e customer 360',
    },
  });
  await prisma.customerIdentity.upsert({
    where: { id: 'e2e-crm-customer-phone' },
    update: {},
    create: {
      id: 'e2e-crm-customer-phone',
      customerId: crmCustomer.id,
      type: CustomerIdentityType.PHONE,
      valueHash: 'a'.repeat(64),
      valueMasked: '+57 *** *** 2399',
      isPrimary: true,
      verifiedAt: FIXED_TIME,
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
      customerId: crmCustomer.id,
    },
  });
  const deliveryOrder = await prisma.orderTicket.upsert({
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

  const conversation = await prisma.whatsappConversation.upsert({
    where: { id: 'e2e-conversation-fixture' },
    update: {},
    create: {
      id: 'e2e-conversation-fixture',
      customerId: crmCustomer.id,
      phone: '573000002399',
      customerName: 'E2E Customer 360',
      status: WhatsappConversationStatus.ACTIVE,
      source: SofiaOrderSource.SOFIA,
      provider: 'baileys',
      providerConversationId: 'e2e-provider-conversation',
      mode: 'receive_only',
      humanStatus: 'SOFIA_ACTIVE',
      lastMessageAt: FIXED_TIME,
      lastInboundAt: FIXED_TIME,
      lastMessagePreview: 'Necesito ayuda con mi pedido',
      unreadCount: 1,
    },
  });
  await prisma.whatsappMessage.upsert({
    where: { id: 'e2e-conversation-message' },
    update: {},
    create: {
      id: 'e2e-conversation-message',
      conversationId: conversation.id,
      direction: WhatsappMessageDirection.INBOUND,
      type: WhatsappMessageType.TEXT,
      provider: 'baileys',
      providerMessageId: 'e2e-provider-message',
      body: 'Necesito ayuda con mi pedido',
      status: 'RECEIVED',
      idempotencyKey: 'e2e-conversation-message-v1',
      createdAt: FIXED_TIME,
    },
  });

  const checkout = await prisma.orderCheckout.upsert({
    where: { id: 'e2e-checkout-fixture' },
    update: {},
    create: {
      id: 'e2e-checkout-fixture',
      source: OrderCheckoutSource.AUTHORIZED_OPERATOR,
      sourceReference: 'E2E-CHECKOUT-0001',
      idempotencyKey: 'e2e-checkout-fixture-v1',
      customerId: crmCustomer.id,
      customerSnapshot: { displayName: 'E2E Customer 360', identity: '+57 *** *** 2399' },
      itemsSnapshot: [{ productId: product.id, code: product.code, name: product.name, quantity: 1, unitPrice: productPrice, totalPrice: productPrice, modifiers: [] }],
      subtotal: productPrice,
      deliveryFee: 9000,
      total: productPrice + 9000,
      fulfillment: OrderTicketType.DELIVERY,
      paymentPreference: SofiaPaymentPreference.ONLINE,
      status: OrderCheckoutStatus.FINANCIAL_REVIEW_REQUIRED,
      orderTicketId: deliveryOrder.id,
    },
  });
  const paymentIntent = await prisma.paymentIntent.upsert({
    where: { id: 'e2e-payment-intent-fixture' },
    update: {},
    create: {
      id: 'e2e-payment-intent-fixture',
      checkoutId: checkout.id,
      attemptNumber: 1,
      idempotencyKey: 'e2e-payment-intent-v1',
      provider: PaymentIntentProvider.BOLD,
      amount: productPrice + 9000,
      currency: 'COP',
      status: PaymentIntentStatus.UNKNOWN_RESULT,
      providerReference: 'E2E-UNKNOWN-RESULT',
      providerAccountHash: 'b'.repeat(64),
    },
  });
  await prisma.paymentTransition.upsert({
    where: { id: 'e2e-payment-transition-fixture' },
    update: {},
    create: {
      id: 'e2e-payment-transition-fixture',
      paymentIntentId: paymentIntent.id,
      fromStatus: PaymentIntentStatus.PENDING,
      toStatus: PaymentIntentStatus.UNKNOWN_RESULT,
      reasonCode: 'E2E_PROVIDER_OUTCOME_UNCERTAIN',
      idempotencyKey: 'e2e-payment-transition-v1',
      sanitizedMetadata: { fixture: true },
      createdAt: FIXED_TIME,
    },
  });

  const serviceCase = await prisma.customerServiceCase.upsert({
    where: { id: 'e2e-service-case-fixture' },
    update: {},
    create: {
      id: 'e2e-service-case-fixture',
      category: CustomerServiceCaseCategory.PAYMENT_PROBLEM,
      status: CustomerServiceCaseStatus.OPEN,
      source: 'E2E_FIXTURE',
      sourceReference: 'E2E-SERVICE-CASE-0001',
      evidenceHash: 'c'.repeat(64),
      sanitizedSummary: 'Resultado de pago incierto; requiere revisión humana.',
      customerId: crmCustomer.id,
      conversationId: conversation.id,
      orderCheckoutId: checkout.id,
      orderTicketId: deliveryOrder.id,
      paymentIntentId: paymentIntent.id,
      version: 0,
    },
  });
  await prisma.customerServiceCaseEvent.upsert({
    where: { id: 'e2e-service-case-event-fixture' },
    update: {},
    create: {
      id: 'e2e-service-case-event-fixture',
      caseId: serviceCase.id,
      version: 0,
      idempotencyKey: 'e2e-service-case-event-v0',
      action: 'CREATED',
      toStatus: CustomerServiceCaseStatus.OPEN,
      reasonCode: 'E2E_PAYMENT_REVIEW_REQUIRED',
      sanitizedMetadata: { fixture: true },
      createdAt: FIXED_TIME,
    },
  });

  const pipeline = await prisma.crmPipeline.upsert({
    where: { id: 'e2e-crm-pipeline' },
    update: {},
    create: {
      id: 'e2e-crm-pipeline',
      name: 'E2E Commercial Pipeline',
      nameNormalized: 'e2e commercial pipeline',
      description: 'Deterministic Phase 8 pipeline fixture',
      createdById: admin.id,
    },
  });
  const firstStage = await prisma.crmPipelineStage.upsert({
    where: { id: 'e2e-crm-stage-new' },
    update: {},
    create: {
      id: 'e2e-crm-stage-new',
      pipelineId: pipeline.id,
      name: 'Nuevo',
      nameNormalized: 'nuevo',
      position: 0,
    },
  });
  const secondStage = await prisma.crmPipelineStage.upsert({
    where: { id: 'e2e-crm-stage-qualified' },
    update: {},
    create: {
      id: 'e2e-crm-stage-qualified',
      pipelineId: pipeline.id,
      name: 'Calificado',
      nameNormalized: 'calificado',
      position: 1,
    },
  });
  const lead = await prisma.crmLead.upsert({
    where: { id: 'e2e-crm-lead' },
    update: {},
    create: {
      id: 'e2e-crm-lead',
      customerId: crmCustomer.id,
      pipelineId: pipeline.id,
      currentStageId: firstStage.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'E2E-CRM-LEAD-0001',
      title: 'E2E Governed Lead',
      status: CrmLeadStatus.NEW,
      ownerId: admin.id,
    },
  });
  await prisma.crmLeadStageHistory.upsert({
    where: { id: 'e2e-crm-lead-history-v0' },
    update: {},
    create: {
      id: 'e2e-crm-lead-history-v0',
      leadId: lead.id,
      version: 0,
      idempotencyKey: 'e2e-crm-lead-history-v0',
      toStageId: firstStage.id,
      toStatus: CrmLeadStatus.NEW,
      actorId: admin.id,
      reasonCode: 'E2E_FIXTURE_CREATED',
      sanitizedMetadata: { fixture: true },
      createdAt: FIXED_TIME,
    },
  });
  await prisma.crmTask.upsert({
    where: { id: 'e2e-crm-task' },
    update: {},
    create: {
      id: 'e2e-crm-task',
      customerId: crmCustomer.id,
      leadId: lead.id,
      source: 'E2E_FIXTURE',
      sourceReference: 'E2E-CRM-TASK-0001',
      type: CrmTaskType.TASK,
      status: CrmTaskStatus.OPEN,
      priority: CrmTaskPriority.HIGH,
      title: 'E2E Call Customer',
      sanitizedDescription: 'Deterministic task for governed UI transition.',
      assignedToId: admin.id,
      dueAt: new Date(FIXED_TIME.getTime() + 86_400_000),
    },
  });

  void secondStage;

  process.stdout.write(`${JSON.stringify({ status: 'PASS', aliases: ['admin', 'supervisor', 'cashier', 'waiter', 'delivery', 'no-access', 'open-cash', 'closed-cash', 'sale', 'order', 'delivery', 'customer-360', 'conversation', 'payment-unknown', 'service-case', 'crm-pipeline', 'crm-lead', 'crm-task'] })}\n`);
}

void main().finally(() => prisma.$disconnect());
