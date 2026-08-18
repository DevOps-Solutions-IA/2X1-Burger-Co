import { randomUUID } from 'node:crypto';
import { CustomerServiceCaseService } from '../customer-service/customer-service-case.service';
import { PrismaCustomerServiceCaseRepository } from '../customer-service/persistence/prisma-customer-service-case.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { SofiaAgentService } from './sofia-agent.service';

const STOP_AFTER_COMPLAINT = new Error('STOP_AFTER_COMPLAINT_WIRING');

describe('Sofia complaint inbound PostgreSQL wiring', () => {
  let prisma: PrismaService;
  let conversationId: string;
  let findConversation: jest.Mock;
  let agent: SofiaAgentService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Complaint inbound integration requires an isolated _test database.');
    }

    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const suffix = randomUUID();
    const conversation = await prisma.whatsappConversation.create({
      data: {
        phone: `complaint-${suffix}`,
        provider: 'integration_test',
        providerConversationId: `complaint-${suffix}`,
        mode: 'receive_only',
        sofiaEnabled: true,
      },
    });
    conversationId = conversation.id;

    findConversation = jest.fn().mockRejectedValue(STOP_AFTER_COMPLAINT);
    const cases = new CustomerServiceCaseService(new PrismaCustomerServiceCaseRepository(prisma));
    agent = new SofiaAgentService(
      { findConversation } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cases,
      {} as never,
    );
  });

  afterEach(async () => {
    const cases = await prisma.customerServiceCase.findMany({
      where: { conversationId },
      select: { id: true },
    });
    await prisma.customerServiceCaseEvent.deleteMany({
      where: { caseId: { in: cases.map(({ id }) => id) } },
    });
    await prisma.customerServiceCase.deleteMany({ where: { conversationId } });
    await prisma.whatsappConversation.deleteMany({ where: { id: conversationId } });
  });

  async function operationalCounts() {
    const [
      checkouts,
      paymentIntents,
      orderTickets,
      sales,
      inventoryMovements,
      drafts,
      messages,
    ] = await Promise.all([
      prisma.orderCheckout.count(),
      prisma.paymentIntent.count(),
      prisma.orderTicket.count(),
      prisma.sale.count(),
      prisma.inventoryMovement.count(),
      prisma.sofiaOrderDraft.count(),
      prisma.whatsappMessage.count(),
    ]);
    return { checkouts, paymentIntents, orderTickets, sales, inventoryMovements, drafts, messages };
  }

  async function processComplaint(sourceEventId: string) {
    await expect(agent.processInboundMessage(
      {
        conversationId,
        message: 'Mi pedido me llego frio y quiero poner una queja.',
        messageType: 'TEXT',
      },
      'sofia-inbound-integration',
      {
        sourceEventId,
        recordInbound: false,
        recordOutbound: false,
      },
    )).rejects.toBe(STOP_AFTER_COMPLAINT);
  }

  it('deduplicates the same inbound event and preserves a later complaint with identical text', async () => {
    const before = await operationalCounts();

    await processComplaint('provider-event-1');
    await processComplaint('provider-event-1');

    expect(await prisma.customerServiceCase.count({ where: { conversationId } })).toBe(1);

    await processComplaint('provider-event-2');

    const cases = await prisma.customerServiceCase.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { events: { orderBy: { version: 'asc' } } },
    });
    expect(cases).toHaveLength(2);
    expect(new Set(cases.map((serviceCase) => serviceCase.sourceReference)).size).toBe(2);
    expect(cases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'COLD_FOOD',
        status: 'HUMAN_REQUIRED',
        version: 1,
        events: [
          expect.objectContaining({ action: 'CASE_CREATED', version: 0 }),
          expect.objectContaining({ action: 'HUMAN_REVIEW_REQUIRED', version: 1 }),
        ],
      }),
      expect.objectContaining({
        category: 'COLD_FOOD',
        status: 'HUMAN_REQUIRED',
        version: 1,
        events: [
          expect.objectContaining({ action: 'CASE_CREATED', version: 0 }),
          expect.objectContaining({ action: 'HUMAN_REVIEW_REQUIRED', version: 1 }),
        ],
      }),
    ]));
    expect(findConversation).toHaveBeenCalledTimes(3);
    expect(await operationalCounts()).toEqual(before);
  });
});
