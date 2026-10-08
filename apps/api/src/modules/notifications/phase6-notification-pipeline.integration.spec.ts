import type { INestApplication } from '@nestjs/common';
import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  DeliveryWorkflowStatus,
  NotificationIntentStatus,
  OrderTicketStatus,
  OrderTicketType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { SecureCommandService } from '../secure-command/secure-command.service';
import { WhatsappOutboundCommandHandler } from '../sofia/whatsapp/production/whatsapp-outbound-command.handler';
import { WhatsappOutboundGateway } from '../sofia/whatsapp/production/whatsapp-outbound.gateway';
import { SofiaRuntimeSafetyService } from '../sofia/runtime-safety/sofia-runtime-safety.service';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { DeliveryWorkflowService } from '../delivery-operations/delivery-workflow.service';
import { DeliveryWorkflowConsequenceWorker } from '../orders/delivery-workflow-consequence.worker';
import {
  type NotificationSecureCommandPort,
  SecureCommandExecutionAdapter,
  SecureCommandNotificationAdapter,
  WhatsappNotificationDispatchPolicyAdapter,
} from './notification-dispatch.ports';
import { NotificationCommandExecutionService } from './notification-command-execution.service';
import { NotificationIntentConsumerService } from './notification-intent-consumer.service';
import { NotificationOutboxWorker } from './notification-outbox.worker';
import { PrismaNotificationOutboundMaterializer } from './notification-outbound-materializer';
import { NotificationOutboxService } from './notification-outbox.service';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

describe('Phase 6 PostgreSQL notification pipeline', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: NotificationOutboxService;
  let materializer: PrismaNotificationOutboundMaterializer;
  let commands: SecureCommandNotificationAdapter;
  let execution: SecureCommandExecutionAdapter;
  let executor: NotificationCommandExecutionService;
  let outboxWorker: NotificationOutboxWorker;
  let secureCommands: SecureCommandService;
  let commandHandler: WhatsappOutboundCommandHandler;
  let gateway: WhatsappOutboundGateway;
  let dispatchPolicy: WhatsappNotificationDispatchPolicyAdapter;
  let runtimeSafety: SofiaRuntimeSafetyService;
  let deliveryWorkflow: DeliveryWorkflowService;
  let deliveryConsequences: DeliveryWorkflowConsequenceWorker;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Notification pipeline integration requires an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    outbox = app.get(NotificationOutboxService);
    materializer = app.get(PrismaNotificationOutboundMaterializer);
    secureCommands = app.get(SecureCommandService);
    commandHandler = app.get(WhatsappOutboundCommandHandler);
    gateway = app.get(WhatsappOutboundGateway);
    dispatchPolicy = app.get(WhatsappNotificationDispatchPolicyAdapter);
    runtimeSafety = app.get(SofiaRuntimeSafetyService);
    deliveryWorkflow = app.get(DeliveryWorkflowService);
    deliveryConsequences = app.get(DeliveryWorkflowConsequenceWorker);
    commands = app.get(SecureCommandNotificationAdapter);
    execution = app.get(SecureCommandExecutionAdapter);
    executor = app.get(NotificationCommandExecutionService);
    outboxWorker = app.get(NotificationOutboxWorker);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);

    jest.spyOn(secureCommands, 'execute');
    jest.spyOn(commandHandler, 'execute');
    jest.spyOn(gateway, 'send');
    jest.spyOn(runtimeSafety, 'getState').mockResolvedValue({
      globalPaused: false,
      killSwitchActive: false,
      effective: { realSendingEnabled: true },
    } as never);
  });

  async function createIntent(
    sourceEventId: string,
    concurrentEnqueue = 1,
    customerId: string | null = null,
  ) {
    const account = await prisma.whatsappProviderAccount.create({
      data: {
        provider: 'qr_gateway',
        externalAccountHash: createHash('sha256').update(`external:${sourceEventId}`).digest('hex'),
        businessIdentityHash: createHash('sha256').update(`business:${sourceEventId}`).digest('hex'),
        sessionOwnerHash: createHash('sha256').update(`session:${sourceEventId}`).digest('hex'),
        status: 'VERIFIED_RECEIVE_ONLY',
      },
    });
    const phone = '+573000000001';
    const conversation = await prisma.whatsappConversation.create({
      data: {
        phone,
        provider: account.provider,
        customerId,
        mode: 'receive_only',
        sofiaEnabled: true,
        humanStatus: 'SOFIA_ACTIVE',
        status: 'ACTIVE',
        handoffVersion: 0,
      },
    });
    const body = 'Tu pedido esta listo para recoger.';
    const input = {
      eventType: 'READY_FOR_PICKUP',
      sourceEventId,
      aggregateType: 'ORDER_TICKET',
      aggregateId: `ticket:${sourceEventId}`,
      aggregateVersion: 1,
      customerId,
      conversationId: conversation.id,
      channel: CustomerConsentChannel.WHATSAPP,
      purpose: CustomerConsentPurpose.SERVICE,
      factEnvelope: {
        conversationId: conversation.id,
        accountId: account.id,
        recipientIdentityHash: createHash('sha256').update(phone).digest('hex'),
        expectedConversationVersion: 0,
        body,
        bodyHash: createHash('sha256').update(body).digest('hex'),
      },
      policyOutcome: 'ALLOWED' as const,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };
    const intents = await Promise.all(
      Array.from({ length: concurrentEnqueue }, () => outbox.enqueue(input)),
    );
    expect(new Set(intents.map(({ id }) => id)).size).toBe(1);
    const intent = intents[0]!;
    await expect(prisma.auditLog.findFirstOrThrow({
      where: {
        actorId: 'notification-outbox',
        module: 'notifications',
        action: 'NOTIFICATION_INTENT_ENQUEUED',
        entityId: intent.id,
      },
    })).resolves.toMatchObject({ actorType: 'SYSTEM', entity: 'notification_intent', result: 'SUCCESS' });
    return intent;
  }

  function consumer(
    commandPort: NotificationSecureCommandPort = commands,
    outboxPort: NotificationOutboxService = outbox,
  ) {
    return new NotificationIntentConsumerService(
      outboxPort,
      dispatchPolicy,
      materializer,
      commandPort,
    );
  }

  async function expectSingleDisabledPipeline(intentId: string) {
    const [intent, outbound, command] = await Promise.all([
      prisma.notificationIntent.findUniqueOrThrow({ where: { id: intentId } }),
      prisma.whatsappOutboundMessage.findFirstOrThrow({ where: { idempotencyKey: `notification:${intentId}` } }),
      prisma.sofiaCommand.findFirstOrThrow({ where: { commandType: 'SOFIA_SEND_WHATSAPP' } }),
    ]);

    expect(intent).toMatchObject({
      status: NotificationIntentStatus.COMMAND_PENDING,
      outboundMessageId: outbound.id,
      secureCommandId: command.id,
    });
    expect(outbound).toMatchObject({
      status: 'APPROVAL_PENDING',
      attempts: 0,
      providerMessageId: null,
      sentAt: null,
      secureCommandId: null,
      unknownResult: false,
    });
    expect(command).toMatchObject({
      commandType: 'SOFIA_SEND_WHATSAPP',
      status: 'APPROVAL_REQUIRED',
      targetType: 'WhatsappOutboundMessage',
      targetId: outbound.id,
    });
    expect(await prisma.notificationIntent.count()).toBe(1);
    expect(await prisma.whatsappOutboundMessage.count()).toBe(1);
    expect(await prisma.sofiaCommand.count()).toBe(1);
    expect(await prisma.sofiaCommandApproval.count()).toBe(0);
    expect(await prisma.sofiaCommandAttempt.count()).toBe(0);
    expect(await prisma.sofiaCommandResult.count()).toBe(0);
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { actorId: 'notification-outbox', module: 'secure_command' },
      orderBy: { timestamp: 'desc' },
    })).resolves.toMatchObject({
      actorType: 'SYSTEM',
      userId: null,
    });
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { actorId: 'notification-outbox', module: 'notifications', action: 'NOTIFICATION_COMMAND_PENDING', entityId: intentId },
    })).resolves.toMatchObject({
      actorType: 'SYSTEM',
      userId: null,
      entity: 'notification_intent',
      result: 'SUCCESS',
    });
    expect(secureCommands.execute).not.toHaveBeenCalled();
    expect(commandHandler.execute).not.toHaveBeenCalled();
    expect(gateway.send).not.toHaveBeenCalled();
  }

  async function candidateOf(intentId: string): Promise<NotificationReconciliationCandidate> {
    const intent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intentId } });
    return {
      id: intent.id,
      status: intent.status as NotificationReconciliationCandidate['status'],
      version: intent.version,
      attempts: intent.attempts,
      secureCommandId: intent.secureCommandId,
      outboundMessageId: intent.outboundMessageId,
    };
  }

  it('allows one concurrent consumer to materialize one outbound and one disabled command', async () => {
    const intent = await createIntent('notification-concurrency-1', 8);
    const service = consumer();
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => service.consume(intent.id, `worker-${index}`, now)),
    );

    expect(results.filter(({ state }) => state === 'COMMAND_PENDING')).toHaveLength(1);
    expect(results.filter(({ state }) => state === 'SKIPPED')).toHaveLength(7);
    await expectSingleDisabledPipeline(intent.id);
  });

  it('recovers after outbound materialization without duplicating the outbound or command', async () => {
    const intent = await createIntent('notification-fault-after-outbound');
    let failOnce = true;
    const faultingCommands: NotificationSecureCommandPort = {
      receive: async (input) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('NOTIFICATION_FAULT_AFTER_OUTBOUND');
        }
        return commands.receive(input);
      },
    };
    const service = consumer(faultingCommands);
    const firstNow = new Date();

    await expect(service.consume(intent.id, 'worker-outbound-1', firstNow)).resolves.toMatchObject({
      state: 'RETRY_SCHEDULED',
      reasonCode: 'NOTIFICATION_FAULT_AFTER_OUTBOUND',
    });
    expect(await prisma.whatsappOutboundMessage.count()).toBe(1);
    expect(await prisma.sofiaCommand.count()).toBe(0);

    await expect(service.consume(
      intent.id,
      'worker-outbound-2',
      new Date(firstNow.getTime() + 5_001),
    )).resolves.toMatchObject({ state: 'COMMAND_PENDING' });
    await expectSingleDisabledPipeline(intent.id);
  });

  it('recovers after command creation without duplicating any durable identity', async () => {
    const intent = await createIntent('notification-fault-after-command');
    let failOnce = true;
    const faultingOutbox = {
      claim: outbox.claim.bind(outbox),
      renewClaim: outbox.renewClaim.bind(outbox),
      markSuppressed: outbox.markSuppressed.bind(outbox),
      markPreDispatchFailure: outbox.markPreDispatchFailure.bind(outbox),
      markCommandPending: async (input: Parameters<NotificationOutboxService['markCommandPending']>[0]) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('NOTIFICATION_FAULT_AFTER_COMMAND');
        }
        return outbox.markCommandPending(input);
      },
    } as NotificationOutboxService;
    const service = consumer(commands, faultingOutbox);
    const firstNow = new Date();

    await expect(service.consume(intent.id, 'worker-command-1', firstNow)).resolves.toMatchObject({
      state: 'RETRY_SCHEDULED',
      reasonCode: 'NOTIFICATION_FAULT_AFTER_COMMAND',
    });
    expect(await prisma.whatsappOutboundMessage.count()).toBe(1);
    expect(await prisma.sofiaCommand.count()).toBe(1);
    expect(await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } })).toMatchObject({
      status: NotificationIntentStatus.PENDING,
      outboundMessageId: null,
      secureCommandId: null,
    });

    await expect(service.consume(
      intent.id,
      'worker-command-2',
      new Date(firstNow.getTime() + 5_001),
    )).resolves.toMatchObject({
      state: 'COMMAND_PENDING',
      reasonCode: 'SECURE_COMMAND_REPLAYED',
    });
    await expectSingleDisabledPipeline(intent.id);
  });

  it('uses real handoff policy to suppress automation before command materialization', async () => {
    const intent = await createIntent('notification-human-taken');
    await prisma.whatsappConversation.update({
      where: { id: intent.conversationId! },
      data: {
        status: 'HUMAN_TAKEN',
        humanStatus: 'HUMAN_TAKEN',
        sofiaEnabled: false,
        handoffVersion: { increment: 1 },
      },
    });

    await expect(consumer().consume(intent.id, 'worker-human', new Date())).resolves.toMatchObject({
      state: 'SUPPRESSED',
      reasonCode: 'HUMAN_HANDOFF_ACTIVE',
    });
    expect(await prisma.whatsappOutboundMessage.count()).toBe(0);
    expect(await prisma.sofiaCommand.count()).toBe(0);
    expect(secureCommands.execute).not.toHaveBeenCalled();
    expect(gateway.send).not.toHaveBeenCalled();
    await expect(prisma.auditLog.findFirstOrThrow({
      where: {
        actorId: 'notification-outbox',
        module: 'notifications',
        action: 'NOTIFICATION_SUPPRESSED',
        entityId: intent.id,
      },
    })).resolves.toMatchObject({ result: 'BLOCKED', reasonCode: 'HUMAN_HANDOFF_ACTIVE' });
  });

  it('uses persisted revoked consent to suppress service automation before command materialization', async () => {
    const customer = await prisma.customer.create({ data: { displayName: 'Consent Test' } });
    await prisma.customerConsent.create({
      data: {
        customerId: customer.id,
        purpose: CustomerConsentPurpose.SERVICE,
        channel: CustomerConsentChannel.WHATSAPP,
        status: 'REVOKED',
        source: 'PHASE6_INTEGRATION_TEST',
        evidenceHash: createHash('sha256').update('revoked-service-consent').digest('hex'),
        version: 1,
        revokedAt: new Date(),
      },
    });
    const intent = await createIntent('notification-consent-revoked', 1, customer.id);

    await expect(consumer().consume(intent.id, 'worker-consent', new Date())).resolves.toMatchObject({
      state: 'SUPPRESSED',
      reasonCode: 'CONSENT_REVOKED',
    });
    expect(await prisma.whatsappOutboundMessage.count()).toBe(0);
    expect(await prisma.sofiaCommand.count()).toBe(0);
    expect(secureCommands.execute).not.toHaveBeenCalled();
    expect(gateway.send).not.toHaveBeenCalled();
    await expect(prisma.auditLog.findFirstOrThrow({
      where: {
        actorId: 'notification-outbox',
        module: 'notifications',
        action: 'NOTIFICATION_SUPPRESSED',
        entityId: intent.id,
      },
    })).resolves.toMatchObject({ result: 'BLOCKED', reasonCode: 'CONSENT_REVOKED' });
  });

  it('materializes a real delivery domain event through policy into a disabled command', async () => {
    const seed = await seedTestData(prisma);
    const account = await prisma.whatsappProviderAccount.create({
      data: {
        provider: 'qr_gateway',
        externalAccountHash: createHash('sha256').update('domain-account').digest('hex'),
        businessIdentityHash: createHash('sha256').update('domain-business').digest('hex'),
        sessionOwnerHash: createHash('sha256').update('domain-session').digest('hex'),
        status: 'VERIFIED_RECEIVE_ONLY',
      },
    });
    const conversation = await prisma.whatsappConversation.create({
      data: {
        phone: '+573000000002',
        provider: 'qr_gateway',
        mode: 'receive_only',
        sofiaEnabled: true,
        humanStatus: 'SOFIA_ACTIVE',
        status: 'ACTIVE',
      },
    });
    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: 'DOMAIN-DELIVERY-001',
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.PENDING_ASSIGNMENT,
        subtotal: 30_000,
      },
    });
    await prisma.whatsappDeliveryOrder.create({
      data: {
        conversationId: conversation.id,
        orderTicketId: order.id,
        itemsSnapshot: [],
        subtotal: 25_000,
        deliveryFee: 5_000,
        total: 30_000,
      },
    });
    const event = await deliveryWorkflow.transition({
      orderTicketId: order.id,
      expectedVersion: 0,
      toStatus: DeliveryWorkflowStatus.ASSIGNED,
      assignedRiderId: seed.deliveryUser.id,
      actorId: seed.adminUser.id,
      reasonCode: 'DOMAIN_EVENT_NOTIFICATION_TEST',
      idempotencyKey: `delivery:notification:${order.id}:1`,
    });

    await deliveryConsequences.runOnce();
    const intent = await prisma.notificationIntent.findFirstOrThrow({
      where: {
        aggregateType: 'DELIVERY_WORKFLOW_EVENT',
        aggregateId: order.id,
        aggregateVersion: event.version,
      },
    });
    expect(intent).toMatchObject({
      eventType: 'DELIVERY_ASSIGNED',
      status: NotificationIntentStatus.PENDING,
      conversationId: conversation.id,
      policyOutcome: 'ALLOWED',
    });

    await expect(consumer().consume(intent.id, 'worker-domain-event', new Date())).resolves.toMatchObject({
      state: 'COMMAND_PENDING',
    });
    await expectSingleDisabledPipeline(intent.id);
    expect(account.status).toBe('VERIFIED_RECEIVE_ONLY');
  });

  describe('dispatch stage: SecureCommand.receive() -> execute() gap closed', () => {
    it('invokes SecureCommandService.execute(), fails closed before the handler, and terminates FAILED with an audit trail', async () => {
      const intent = await createIntent('notification-dispatch-blocked');
      await expect(consumer().consume(intent.id, 'worker-dispatch-1', new Date())).resolves.toMatchObject({
        state: 'COMMAND_PENDING',
      });
      await expectSingleDisabledPipeline(intent.id);

      const candidate = await candidateOf(intent.id);
      await expect(executor.dispatch(candidate, new Date())).resolves.toEqual({
        notificationIntentId: intent.id,
        state: 'FAILED',
        reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
      });

      expect(secureCommands.execute).toHaveBeenCalledTimes(1);
      expect(commandHandler.execute).not.toHaveBeenCalled();
      expect(gateway.send).not.toHaveBeenCalled();

      const [finalIntent, command, outbound] = await Promise.all([
        prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } }),
        prisma.sofiaCommand.findUniqueOrThrow({ where: { id: candidate.secureCommandId! } }),
        prisma.whatsappOutboundMessage.findUniqueOrThrow({ where: { id: candidate.outboundMessageId! } }),
      ]);
      expect(finalIntent).toMatchObject({
        status: NotificationIntentStatus.FAILED,
        lastErrorCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
      });
      expect(finalIntent.completedAt).not.toBeNull();
      // The SecureCommand itself is never mutated by a blocked execute() attempt: it is
      // rejected before ever being claimed, so no attempt/result row is ever created either.
      expect(command).toMatchObject({ status: 'APPROVAL_REQUIRED' });
      expect(outbound).toMatchObject({ status: 'APPROVAL_PENDING', providerMessageId: null, sentAt: null });
      expect(await prisma.sofiaCommandAttempt.count()).toBe(0);
      expect(await prisma.sofiaCommandResult.count()).toBe(0);

      await expect(prisma.auditLog.findFirstOrThrow({
        where: {
          actorId: 'notification-outbox',
          module: 'notifications',
          action: 'NOTIFICATION_RECONCILIATION_FAILED',
          entityId: intent.id,
        },
      })).resolves.toMatchObject({
        actorType: 'SYSTEM',
        result: 'FAILED',
        reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
      });
    });

    it('collapses a concurrently-enqueued duplicate intent into exactly one dispatch outcome', async () => {
      const intent = await createIntent('notification-dispatch-duplicate-intent', 8);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) => consumer().consume(intent.id, `worker-dup-intent-${index}`, new Date())),
      );
      expect(results.filter(({ state }) => state === 'COMMAND_PENDING')).toHaveLength(1);
      await expectSingleDisabledPipeline(intent.id);

      const candidate = await candidateOf(intent.id);
      await expect(executor.dispatch(candidate, new Date())).resolves.toMatchObject({ state: 'FAILED' });

      expect(await prisma.notificationIntent.count()).toBe(1);
      expect(await prisma.sofiaCommand.count()).toBe(1);
      expect(await prisma.whatsappOutboundMessage.count()).toBe(1);
      expect(await prisma.auditLog.count({
        where: { module: 'notifications', action: 'NOTIFICATION_RECONCILIATION_FAILED', entityId: intent.id },
      })).toBe(1);
    });

    it('settles a duplicate worker claim exactly once and skips the other, with zero WhatsApp access', async () => {
      const intent = await createIntent('notification-dispatch-duplicate-claim');
      await consumer().consume(intent.id, 'worker-dup-claim-1', new Date());
      const candidate = await candidateOf(intent.id);
      const now = new Date();

      const results = await Promise.all([
        executor.dispatch(candidate, now),
        executor.dispatch(candidate, now),
      ]);

      expect(results.every((result) => result.notificationIntentId === intent.id)).toBe(true);
      expect(results.filter((result) => result.state === 'FAILED')).toHaveLength(1);
      expect(results.filter((result) => result.state === 'SKIPPED')).toHaveLength(1);
      expect(results.find((result) => result.state === 'SKIPPED')?.reasonCode).toBe('NOTIFICATION_VERSION_CONFLICT');

      // Both concurrent attempts really did call SecureCommandService.execute() -- that call is
      // itself safe to repeat (deterministically blocked, no handler access) -- but only one of
      // the two notification-intent transitions could win the optimistic-concurrency race.
      expect(secureCommands.execute).toHaveBeenCalledTimes(2);
      expect(commandHandler.execute).not.toHaveBeenCalled();
      expect(gateway.send).not.toHaveBeenCalled();

      expect(await prisma.notificationIntent.count()).toBe(1);
      expect(await prisma.sofiaCommand.count()).toBe(1);
      const finalIntent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(finalIntent.status).toBe(NotificationIntentStatus.FAILED);
      expect(await prisma.auditLog.count({
        where: { module: 'notifications', action: 'NOTIFICATION_RECONCILIATION_FAILED', entityId: intent.id },
      })).toBe(1);
    });

    it('recovers from a crash after the execute() result but before persisting the terminal transition, without a second handler attempt', async () => {
      const intent = await createIntent('notification-dispatch-crash-after-execute');
      await consumer().consume(intent.id, 'worker-crash-execute-1', new Date());
      const firstCandidate = await candidateOf(intent.id);

      let failOnce = true;
      const faultingOutbox = {
        markDispatched: outbox.markDispatched.bind(outbox),
        reconcile: async (input: Parameters<NotificationOutboxService['reconcile']>[0]) => {
          if (failOnce) {
            failOnce = false;
            throw new Error('NOTIFICATION_FAULT_AFTER_EXECUTE');
          }
          return outbox.reconcile(input);
        },
      } as NotificationOutboxService;
      const crashProneExecutor = new NotificationCommandExecutionService(faultingOutbox, execution);

      await expect(crashProneExecutor.dispatch(firstCandidate, new Date())).rejects.toThrow('NOTIFICATION_FAULT_AFTER_EXECUTE');
      expect(secureCommands.execute).toHaveBeenCalledTimes(1);
      expect(commandHandler.execute).not.toHaveBeenCalled();
      const midIntent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(midIntent.status).toBe(NotificationIntentStatus.COMMAND_PENDING);

      const retried = await executor.dispatch(await candidateOf(intent.id), new Date());
      expect(retried).toEqual({
        notificationIntentId: intent.id,
        state: 'FAILED',
        reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
      });
      // Re-attempted after the simulated crash; SecureCommand.execute() is itself safe to
      // repeat (still deterministically blocked before the handler), so no double transmission.
      expect(secureCommands.execute).toHaveBeenCalledTimes(2);
      expect(commandHandler.execute).not.toHaveBeenCalled();
      expect(gateway.send).not.toHaveBeenCalled();

      const finalIntent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(finalIntent.status).toBe(NotificationIntentStatus.FAILED);
      expect(await prisma.auditLog.count({
        where: { module: 'notifications', action: 'NOTIFICATION_RECONCILIATION_FAILED', entityId: intent.id },
      })).toBe(1);
    });

    it('stays fail-closed with zero WhatsApp access when a human handoff becomes active between receive and execute', async () => {
      const intent = await createIntent('notification-dispatch-handoff-race');
      await consumer().consume(intent.id, 'worker-handoff-race-1', new Date());
      await prisma.whatsappConversation.update({
        where: { id: intent.conversationId! },
        data: {
          status: 'HUMAN_TAKEN',
          humanStatus: 'HUMAN_TAKEN',
          sofiaEnabled: false,
          handoffVersion: { increment: 1 },
        },
      });

      const candidate = await candidateOf(intent.id);
      await expect(executor.dispatch(candidate, new Date())).resolves.toEqual({
        notificationIntentId: intent.id,
        state: 'FAILED',
        reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
      });

      expect(commandHandler.execute).not.toHaveBeenCalled();
      expect(gateway.send).not.toHaveBeenCalled();
    });

    it('stays fail-closed with zero WhatsApp access when consent is revoked between receive and execute', async () => {
      const customer = await prisma.customer.create({ data: { displayName: 'Consent Race Dispatch Test' } });
      const intent = await createIntent('notification-dispatch-consent-race', 1, customer.id);
      await consumer().consume(intent.id, 'worker-consent-race-1', new Date());

      await prisma.customerConsent.create({
        data: {
          customerId: customer.id,
          purpose: CustomerConsentPurpose.SERVICE,
          channel: CustomerConsentChannel.WHATSAPP,
          status: 'REVOKED',
          source: 'PHASE6_INTEGRATION_TEST_DISPATCH',
          evidenceHash: createHash('sha256').update('revoked-service-consent-dispatch').digest('hex'),
          version: 1,
          revokedAt: new Date(),
        },
      });

      const candidate = await candidateOf(intent.id);
      await expect(executor.dispatch(candidate, new Date())).resolves.toEqual({
        notificationIntentId: intent.id,
        state: 'FAILED',
        reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
      });

      expect(commandHandler.execute).not.toHaveBeenCalled();
      expect(gateway.send).not.toHaveBeenCalled();
    });

    it('the real NotificationOutboxWorker claims, receives and dispatches a fresh intent to a terminal FAILED state in one cycle', async () => {
      const intent = await createIntent('notification-worker-end-to-end');

      await outboxWorker.runOnce(new Date());

      const finalIntent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(finalIntent.status).toBe(NotificationIntentStatus.FAILED);
      expect(finalIntent.lastErrorCode).toBe('SOFIA_COMMAND_APPROVAL_REQUIRED');
      expect(secureCommands.execute).toHaveBeenCalledTimes(1);
      expect(commandHandler.execute).not.toHaveBeenCalled();
      expect(gateway.send).not.toHaveBeenCalled();
      expect(await prisma.sofiaCommand.count()).toBe(1);
      expect(await prisma.whatsappOutboundMessage.count()).toBe(1);
    });
  });
});
