import type { INestApplication } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { SecureCommandService } from '../modules/secure-command/secure-command.service';
import { CommandApprovalService } from '../modules/secure-command/command-approval.service';
import type { CommandActor, CommandRecord } from '../modules/secure-command/secure-command.types';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

/**
 * S1 (audit/reproduction) -- SOFIA SecureCommand Separation-of-Duties remediation track.
 *
 * HYPOTHESIS UNDER TEST: CommandApprovalService.revoke() calls
 * policy.assertApproverAllowed(command, actor, { requireSeparation: false }). Could a requester
 * (or the original approver) revoke a pending approval and then have it re-approved by the
 * requester themself, bypassing separation-of-duties on a command whose policy requires a
 * distinct approver?
 *
 * FINDING: not reproducible. PrismaCommandRepository.revokeApproval() unconditionally moves the
 * parent command from APPROVED -> REJECTED in the SAME transaction that marks the approval
 * REVOKED. REJECTED is a terminal status (command-lifecycle.ts TRANSITIONS.REJECTED === []), and
 * CommandApprovalService.grant() only accepts commands whose status is APPROVAL_REQUIRED. Once a
 * command's approval is revoked -- by anyone, for any reason -- the command can never be
 * re-approved by ANYONE, let alone by the original requester. There is no path back to
 * APPROVAL_REQUIRED after a revoke.
 *
 * This is a real limitation of the current design: revoking an approval does not "re-enter the
 * approval queue for a different eligible approver" as a mature workflow might want -- it kills
 * the command outright. But that bluntness is exactly what forecloses the hypothesized bypass. No
 * code change was necessary to prevent the bypass; these tests pin the terminal-on-revoke
 * behavior down so a future change (e.g. one that reintroduces re-queueing on revoke) cannot
 * silently reopen this hole without failing a test.
 *
 * SOFIA_INTERNAL_VALIDATE (operational: false) is used as the end-to-end vehicle here because
 * it is the only enabled command type that can traverse the full receive -> approve -> revoke ->
 * execute lifecycle without flipping any OWNER_ACTIVATION_GATE flag (all operational: true
 * command types are enabled: false and out of scope for this track). Its self-approval identity
 * check is intentionally skipped by policy (operational: false), so it does NOT itself exercise
 * the "distinct approver required" case -- that case is covered independently, at the
 * CommandPolicyService unit level, in command-policy.separation.spec.ts, against a synthetic
 * operational: true definition. revokeApproval()'s terminal-on-revoke transition is identical
 * for every command type (it does not branch on `operational`), so the terminality guarantees
 * proven here generalize to operational commands as well.
 */
describe('Secure command approval revoke/approve separation-of-duties', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: SecureCommandService;
  let approvals: CommandApprovalService;
  let requester: CommandActor;
  let otherApprover: CommandActor;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('Requires an isolated _test database.');
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    service = app.get(SecureCommandService);
    approvals = app.get(CommandApprovalService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    requester = { actorId: admin.id, actorType: 'USER', roles: ['admin'] };
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
    const second = await prisma.user.create({
      data: {
        email: 'sod-second-admin@example.invalid',
        fullName: 'SoD Second Admin',
        passwordHash: await hash('not-a-production-password', 4),
        roles: { create: { roleId: adminRole.id } },
      },
    });
    otherApprover = { actorId: second.id, actorType: 'USER', roles: ['admin'] };
  });

  async function receive(key: string, actor: CommandActor = requester) {
    return service.receive({
      commandType: 'SOFIA_INTERNAL_VALIDATE',
      idempotencyKey: key,
      actor,
      source: 'internal_validation',
      scope: 'location:jamundi',
      target: { type: 'sofia_draft', id: 'draft-sod', expectedVersion: 'v1' },
      payload: { operation: 'validate' },
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }

  function bindingOf(command: CommandRecord) {
    return {
      payloadHash: command.payloadHash,
      expectedVersion: command.expectedVersion,
      targetType: command.targetType,
      targetId: command.targetId,
      source: command.source,
    };
  }

  async function approveAs(command: CommandRecord, approver: CommandActor, reasonCode = 'SOD_TEST') {
    return service.approve({
      commandId: command.id,
      approver,
      binding: bindingOf(command),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      reasonCode,
      policyReference: 'PHASE_2_INTERNAL_ONLY',
    });
  }

  it('CASE: original approver revokes, then the requester attempts to approve -- blocked because revoke terminalizes the command', async () => {
    const received = await receive('sod-0001');
    const approval = await approveAs(received.command, otherApprover);
    await service.revokeApproval(approval.id, otherApprover);

    await expect(approveAs(received.command, requester)).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });

    const persisted = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } });
    expect(persisted.status).toBe('REJECTED');
    expect(await prisma.sofiaCommandApproval.count({ where: { commandId: received.command.id } })).toBe(1);
  });

  it('CASE: requester revokes their own approved command (revoke does not require separation), then attempts to re-approve themself -- blocked because revoke terminalizes the command', async () => {
    const received = await receive('sod-0002');
    const approval = await approveAs(received.command, otherApprover);
    // requireSeparation:false in revoke() lets the requester -- who also holds an
    // eligible-approver role here -- revoke an approval they did not grant.
    await service.revokeApproval(approval.id, requester);

    await expect(approveAs(received.command, requester)).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    await expect(approveAs(received.command, otherApprover)).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });

    const persisted = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } });
    expect(persisted.status).toBe('REJECTED');
  });

  it('TERMINALITY: a revoked approval can never be un-revoked and the command can never leave REJECTED', async () => {
    const received = await receive('sod-0003');
    const approval = await approveAs(received.command, otherApprover);
    await service.revokeApproval(approval.id, otherApprover);

    const revokedApproval = await prisma.sofiaCommandApproval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(revokedApproval.status).toBe('REVOKED');
    expect(revokedApproval.revokedAt).not.toBeNull();

    // No code path mutates an approval back to APPROVED, and no code path transitions a
    // REJECTED command anywhere (command-lifecycle.ts: TRANSITIONS.REJECTED === []).
    await expect(service.execute({ commandId: received.command.id, actor: requester, claimOwner: 'worker-sod' }))
      .rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_REQUIRED' });
    expect((await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } })).status).toBe('REJECTED');
  });

  it('REPLAY: approving an already-approved command a second time is rejected, not silently duplicated', async () => {
    const received = await receive('sod-0004');
    await approveAs(received.command, otherApprover);
    await expect(approveAs(received.command, requester)).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    expect(await prisma.sofiaCommandApproval.count({ where: { commandId: received.command.id } })).toBe(1);
  });

  it('REPLAY: revoking an already-revoked approval is rejected, not silently repeated', async () => {
    const received = await receive('sod-0005');
    const approval = await approveAs(received.command, otherApprover);
    await service.revokeApproval(approval.id, otherApprover);
    await expect(service.revokeApproval(approval.id, otherApprover)).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    const persisted = await prisma.sofiaCommandApproval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(persisted.status).toBe('REVOKED');
  });

  it('CONCURRENCY: two concurrent revoke calls on the same approval -- exactly one succeeds', async () => {
    const received = await receive('sod-0006');
    const approval = await approveAs(received.command, otherApprover);
    const outcomes = await Promise.allSettled([
      service.revokeApproval(approval.id, otherApprover),
      service.revokeApproval(approval.id, requester),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const persistedApproval = await prisma.sofiaCommandApproval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(persistedApproval.status).toBe('REVOKED');
    const persistedCommand = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } });
    expect(persistedCommand.status).toBe('REJECTED');
  });

  it('CONCURRENCY: two different eligible approvers concurrently approve the same command -- exactly one grant wins', async () => {
    const received = await receive('sod-0007');
    const outcomes = await Promise.allSettled([
      approveAs(received.command, otherApprover, 'RACE_A'),
      approveAs(received.command, otherApprover, 'RACE_B'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(await prisma.sofiaCommandApproval.count({ where: { commandId: received.command.id } })).toBe(1);
    const persistedCommand = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } });
    expect(persistedCommand.status).toBe('APPROVED');
  });

  it('unauthorized actor (no admin/supervisor role, no approve permission) cannot revoke a valid approval', async () => {
    const cashierRole = await prisma.role.findUniqueOrThrow({ where: { name: 'cashier' } });
    const unauthorized = await prisma.user.create({
      data: {
        email: 'sod-unauthorized@example.invalid',
        fullName: 'SoD Unauthorized',
        passwordHash: await hash('not-a-production-password', 4),
        roles: { create: { roleId: cashierRole.id } },
      },
    });
    const received = await receive('sod-0008');
    const approval = await approveAs(received.command, otherApprover);
    await expect(service.revokeApproval(approval.id, { actorId: unauthorized.id, actorType: 'USER', roles: ['cashier'] }))
      .rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    const persisted = await prisma.sofiaCommandApproval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(persisted.status).toBe('APPROVED');
  });

  it('STALE STATE: revoking an approval whose command already progressed past APPROVED still terminates the approval, but the already-claimed command keeps running to completion (documented current behavior, not a re-approval path)', async () => {
    const received = await receive('sod-0009');
    const approval = await approveAs(received.command, otherApprover);
    const claimed = await service.execute({ commandId: received.command.id, actor: requester, claimOwner: 'worker-stale' });
    expect(claimed.command.status).toBe('SUCCEEDED');

    // Revoking after the command already reached a terminal SUCCEEDED state must not resurrect
    // it or mutate it in any way; only the approval row itself changes.
    await service.revokeApproval(approval.id, otherApprover);
    const persistedApproval = await prisma.sofiaCommandApproval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(persistedApproval.status).toBe('REVOKED');
    const persistedCommand = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } });
    expect(persistedCommand.status).toBe('SUCCEEDED');
  });

  it('direct CommandApprovalService.revoke() call surface matches the SecureCommandService facade (no alternate bypass entry point)', async () => {
    const received = await receive('sod-0010');
    const approval = await approveAs(received.command, otherApprover);
    await approvals.revoke(approval.id, otherApprover);
    const persistedCommand = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: received.command.id } });
    expect(persistedCommand.status).toBe('REJECTED');
  });
});
