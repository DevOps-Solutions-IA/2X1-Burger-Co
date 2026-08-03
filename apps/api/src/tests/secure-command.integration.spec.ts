import type { INestApplication } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { AuditService } from '../modules/audit/audit.service';
import { SecureCommandService } from '../modules/secure-command/secure-command.service';
import { SofiaRuntimeSafetyService } from '../modules/sofia/runtime-safety/sofia-runtime-safety.service';
import type { CommandActor, CommandRecord } from '../modules/secure-command/secure-command.types';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

describe('Secure command core integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: SecureCommandService;
  let audit: AuditService;
  let runtimeSafety: SofiaRuntimeSafetyService;
  let actor: CommandActor;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('Secure command integration requires an isolated _test database.');
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    service = app.get(SecureCommandService);
    audit = app.get(AuditService);
    runtimeSafety = app.get(SofiaRuntimeSafetyService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    actor = { actorId: admin.id, actorType: 'USER', roles: ['admin'] };
  });

  async function receive(key: string, payload: unknown = { operation: 'validate' }, source = 'internal_validation') {
    return service.receive({
      commandType: 'SOFIA_INTERNAL_VALIDATE',
      idempotencyKey: key,
      actor,
      source,
      scope: 'location:jamundi',
      target: { type: 'sofia_draft', id: 'draft-validation', expectedVersion: 'v1' },
      payload,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }

  async function approve(command: CommandRecord) {
    return service.approve({
      commandId: command.id,
      approver: actor,
      binding: {
        payloadHash: command.payloadHash,
        expectedVersion: command.expectedVersion,
        targetType: command.targetType,
        targetId: command.targetId,
        source: command.source,
      },
      expiresAt: new Date(Date.now() + 5 * 60_000),
      reasonCode: 'HUMAN_INTERNAL_VALIDATION',
      policyReference: 'PHASE_2_INTERNAL_ONLY',
    });
  }

  async function sideEffectCounts() {
    const [orders, deliveryOrders, sales, stock, cash, payments, outbound] = await Promise.all([
      prisma.orderTicket.count(),
      prisma.whatsappDeliveryOrder.count(),
      prisma.sale.count(),
      prisma.inventoryMovement.count(),
      prisma.cashMovement.count(),
      prisma.sofiaPaymentEvent.count(),
      prisma.whatsappOutboundMessage.count(),
    ]);
    return { orders, deliveryOrders, sales, stock, cash, payments, outbound };
  }

  it('persists approval, executes once, replays deterministically, and creates no operational side effects', async () => {
    const before = await sideEffectCounts();
    const received = await receive('phase2-command-0001');
    expect(received.command.status).toBe('APPROVAL_REQUIRED');
    expect(received.replayed).toBe(false);
    await approve(received.command);

    const executed = await service.execute({ commandId: received.command.id, actor, claimOwner: 'worker-a' });
    expect(executed.command.status).toBe('SUCCEEDED');
    expect(executed.result.resultCode).toBe('SOFIA_INTERNAL_VALIDATION_OK');
    expect(executed.replayed).toBe(false);

    const replay = await service.execute({ commandId: received.command.id, actor, claimOwner: 'worker-b' });
    expect(replay.replayed).toBe(true);
    expect(replay.result.resultHash).toBe(executed.result.resultHash);

    const receiveReplay = await receive('phase2-command-0001');
    expect(receiveReplay.replayed).toBe(true);
    expect(receiveReplay.command.result?.resultHash).toBe(executed.result.resultHash);
    expect(await sideEffectCounts()).toEqual(before);
    expect(await prisma.sofiaCommand.count()).toBe(1);
    expect(await prisma.sofiaCommandAttempt.count()).toBe(1);
    expect(await prisma.sofiaCommandApproval.count()).toBe(1);
    expect(await prisma.sofiaCommandResult.count()).toBe(1);
    const auditActions = (await prisma.auditLog.findMany({
      where: { module: 'secure_command', entityId: received.command.id },
      select: { action: true },
    })).map(({ action }) => action);
    expect(auditActions).toEqual(expect.arrayContaining([
      'SOFIA_COMMAND_VALIDATED',
      'SOFIA_COMMAND_APPROVAL_REQUIRED',
      'SOFIA_COMMAND_APPROVED',
      'SOFIA_COMMAND_CLAIMED',
      'SOFIA_COMMAND_EXECUTING',
      'SOFIA_COMMAND_SUCCEEDED',
      'SOFIA_COMMAND_RESULT_REPLAYED',
    ]));
  });

  it('rejects conflicting scoped retries without changing the original command', async () => {
    const original = await receive('phase2-command-0002');
    await expect(receive('phase2-command-0002', { operation: 'changed' })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_PAYLOAD_CONFLICT' });
    await expect(receive('phase2-command-0002', { operation: 'validate' }, 'admin')).rejects.toMatchObject({ code: 'SOFIA_COMMAND_SOURCE_CONFLICT' });
    await expect(service.receive({
      commandType: 'SOFIA_INTERNAL_VALIDATE',
      idempotencyKey: 'phase2-command-0002',
      actor,
      source: 'internal_validation',
      scope: 'location:jamundi',
      target: { type: 'sofia_draft', id: 'other-target', expectedVersion: 'v1' },
      payload: { operation: 'validate' },
      expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_TARGET_CONFLICT' });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
    const secondAdmin = await prisma.user.create({
      data: {
        email: 'phase2-second-admin@example.invalid',
        fullName: 'Phase 2 Second Admin',
        passwordHash: await hash('not-a-production-password', 4),
        roles: { create: { roleId: adminRole.id } },
      },
    });
    await expect(service.receive({
      commandType: 'SOFIA_INTERNAL_VALIDATE',
      idempotencyKey: 'phase2-command-0002',
      actor: { actorId: secondAdmin.id, actorType: 'USER', roles: ['admin'] },
      source: 'internal_validation',
      scope: 'location:jamundi',
      target: { type: 'sofia_draft', id: 'draft-validation', expectedVersion: 'v1' },
      payload: { operation: 'validate' },
      expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_ACTOR_CONFLICT' });
    const persisted = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: original.command.id } });
    expect(persisted.payloadHash).toBe(original.command.payloadHash);
    expect(await prisma.sofiaCommand.count()).toBe(1);
  });

  it('binds approval and rejects payload target source and expired approval mismatches', async () => {
    const received = await receive('phase2-command-0003');
    const base = {
      commandId: received.command.id,
      approver: actor,
      expiresAt: new Date(Date.now() + 60_000),
      reasonCode: 'HUMAN_INTERNAL_VALIDATION',
      policyReference: 'PHASE_2_INTERNAL_ONLY',
    };
    const binding = {
      payloadHash: received.command.payloadHash,
      expectedVersion: received.command.expectedVersion,
      targetType: received.command.targetType,
      targetId: received.command.targetId,
      source: received.command.source,
    };
    for (const changed of [
      { ...binding, payloadHash: '0'.repeat(64) },
      { ...binding, expectedVersion: 'stale' },
      { ...binding, targetId: 'other' },
      { ...binding, source: 'admin' },
    ]) {
      await expect(service.approve({ ...base, binding: changed })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    }
    await expect(service.approve({ ...base, binding, expiresAt: new Date(Date.now() - 1) })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    expect(await prisma.sofiaCommandApproval.count()).toBe(0);
  });

  it('allows only one concurrent claimant', async () => {
    const received = await receive('phase2-command-0004');
    await approve(received.command);
    const outcomes = await Promise.allSettled([
      service.execute({ commandId: received.command.id, actor, claimOwner: 'worker-a' }),
      service.execute({ commandId: received.command.id, actor, claimOwner: 'worker-b' }),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await prisma.sofiaCommandAttempt.count()).toBe(1);
    expect(await prisma.sofiaCommandResult.count()).toBe(1);
  });

  it('blocks governance pause, kill switch and every operational command type', async () => {
    await prisma.setting.upsert({
      where: { key: 'SOFIA_GLOBAL_PAUSED' },
      create: { key: 'SOFIA_GLOBAL_PAUSED', value: { paused: true } },
      update: { value: { paused: true } },
    });
    await expect(receive('phase2-command-0005')).rejects.toMatchObject({ code: 'SOFIA_COMMAND_POLICY_BLOCKED' });
    await prisma.setting.update({ where: { key: 'SOFIA_GLOBAL_PAUSED' }, data: { value: { paused: false } } });
    await prisma.setting.upsert({
      where: { key: 'SOFIA_KILL_SWITCH' },
      create: { key: 'SOFIA_KILL_SWITCH', value: { active: true } },
      update: { value: { active: true } },
    });
    await expect(receive('phase2-command-0006')).rejects.toMatchObject({ code: 'SOFIA_COMMAND_POLICY_BLOCKED' });
    await prisma.setting.update({ where: { key: 'SOFIA_KILL_SWITCH' }, data: { value: { active: false } } });

    for (const commandType of [
      'SOFIA_CREATE_ORDER', 'SOFIA_SEND_WHATSAPP', 'SOFIA_MARK_PAYMENT', 'SOFIA_DEDUCT_STOCK',
      'SOFIA_MUTATE_CASH', 'SOFIA_CREATE_SALE', 'SOFIA_ASSIGN_DELIVERY', 'SOFIA_CUSTOMER_AUTO_RESPONSE',
    ] as const) {
      await expect(service.receive({
        commandType,
        idempotencyKey: `blocked-${commandType.toLowerCase()}`,
        actor,
        source: 'internal_validation',
        scope: 'location:jamundi',
        target: { type: 'blocked_operation', id: null, expectedVersion: null },
        payload: {},
        expiresAt: new Date(Date.now() + 60_000),
      })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_POLICY_BLOCKED' });
    }
    expect(await prisma.sofiaCommand.count()).toBe(0);
  });

  it('rolls back command creation when mandatory audit persistence fails', async () => {
    jest.spyOn(audit, 'log').mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(receive('phase2-command-0007')).rejects.toThrow('audit unavailable');
    expect(await prisma.sofiaCommand.count()).toBe(0);
  });

  it('rejects approval by an inactive or unauthorized actor', async () => {
    const received = await receive('phase2-command-0008');
    const cashierRole = await prisma.role.findUniqueOrThrow({ where: { name: 'cashier' } });
    const unauthorized = await prisma.user.create({
      data: {
        email: 'phase2-unauthorized@example.invalid',
        fullName: 'Phase 2 Unauthorized',
        passwordHash: await hash('not-a-production-password', 4),
        roles: { create: { roleId: cashierRole.id } },
      },
    });
    await expect(service.approve({
      commandId: received.command.id,
      approver: { actorId: unauthorized.id, actorType: 'USER', roles: ['cashier'] },
      binding: {
        payloadHash: received.command.payloadHash,
        expectedVersion: received.command.expectedVersion,
        targetType: received.command.targetType,
        targetId: received.command.targetId,
        source: received.command.source,
      },
      expiresAt: new Date(Date.now() + 60_000),
      reasonCode: 'INVALID_APPROVER',
      policyReference: 'PHASE_2_INTERNAL_ONLY',
    })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
  });

  it('rejects a revoked approval and keeps the command terminal', async () => {
    const received = await receive('phase2-command-0009');
    const approval = await approve(received.command);
    await service.revokeApproval(approval.id, actor);
    await expect(service.execute({ commandId: received.command.id, actor, claimOwner: 'worker-a' })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_REQUIRED' });
    expect((await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } })).status).toBe('REJECTED');
    expect(await prisma.sofiaCommandAttempt.count()).toBe(0);
  });

  it('recovers an expired pre-execution lease once and never retries an unknown execution result', async () => {
    const recoverable = await receive('phase2-command-0010');
    const approval = await approve(recoverable.command);
    await prisma.sofiaCommand.update({
      where: { id: recoverable.command.id },
      data: { status: 'CLAIMED', claimedAt: new Date(Date.now() - 60_000), leaseExpiresAt: new Date(Date.now() - 1_000), version: { increment: 1 } },
    });
    await prisma.sofiaCommandAttempt.create({
      data: {
        commandId: recoverable.command.id,
        approvalId: approval.id,
        attemptNumber: 1,
        claimOwnerHash: 'expired-owner',
        leaseExpiresAt: new Date(Date.now() - 1_000),
        releaseVersion: 'unversioned',
      },
    });
    const recovered = await service.execute({ commandId: recoverable.command.id, actor, claimOwner: 'worker-recovery' });
    expect(recovered.command.status).toBe('SUCCEEDED');
    expect(await prisma.sofiaCommandAttempt.count({ where: { commandId: recoverable.command.id } })).toBe(2);

    const unknown = await receive('phase2-command-0011');
    const unknownApproval = await approve(unknown.command);
    await prisma.sofiaCommand.update({
      where: { id: unknown.command.id },
      data: { status: 'EXECUTING', claimedAt: new Date(Date.now() - 60_000), leaseExpiresAt: new Date(Date.now() - 1_000), version: { increment: 2 } },
    });
    await prisma.sofiaCommandAttempt.create({
      data: {
        commandId: unknown.command.id,
        approvalId: unknownApproval.id,
        attemptNumber: 1,
        claimOwnerHash: 'unknown-owner',
        leaseExpiresAt: new Date(Date.now() - 1_000),
        releaseVersion: 'unversioned',
      },
    });
    await expect(service.execute({ commandId: unknown.command.id, actor, claimOwner: 'worker-recovery' })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE' });
    const persisted = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: unknown.command.id } });
    expect(persisted).toMatchObject({ status: 'FAILED', failureClass: 'UNKNOWN_RESULT', retryable: false });
    await expect(service.execute({ commandId: unknown.command.id, actor, claimOwner: 'worker-retry' })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_NOT_RETRYABLE' });
  });

  it('revalidates runtime safety after claim and before the handler', async () => {
    const received = await receive('phase2-command-0012');
    await approve(received.command);
    const safeState = {
      policy: 'SUPERVISED_PREPRODUCTION' as const,
      declared: { realSendingEnabled: false, autoReplyEnabled: false, autoSafeEnabled: false, productionEnabled: false },
      effective: { realSendingEnabled: false as const, autoReplyEnabled: false as const, autoSafeEnabled: false as const, productionEnabled: false as const, whatsappCanMarkPaid: false as const },
      globalPaused: false,
      killSwitchActive: false,
      automationBlocked: false,
      precedence: ['KILL_SWITCH', 'PAUSE', 'PRODUCTION', 'AUTO_SAFE', 'AUTO_REPLY', 'REAL_SEND'] as const,
    };
    jest.spyOn(runtimeSafety, 'getState')
      .mockResolvedValueOnce(safeState)
      .mockResolvedValueOnce(safeState)
      .mockResolvedValueOnce({ ...safeState, killSwitchActive: true, automationBlocked: true });
    await expect(service.execute({ commandId: received.command.id, actor, claimOwner: 'worker-a' })).rejects.toMatchObject({ code: 'SOFIA_COMMAND_POLICY_BLOCKED' });
    expect(await prisma.sofiaCommandResult.count()).toBe(0);
    expect((await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } })).status).toBe('FAILED');
  });
});
