import { CommandAuditService } from './command-audit.service';
import { CommandPolicyService } from './command-policy.service';
import type { CommandRepository, CommandRuntimeSafety } from './ports/command-repository.port';
import type { CommandPolicyDefinition, CommandRecord } from './secure-command.types';

const operationalDefinition: CommandPolicyDefinition = {
  commandType: 'SOFIA_SEND_WHATSAPP',
  enabled: false,
  operational: true,
  approvalRequired: true,
  allowedSources: ['notification_outbox'],
  allowedRoles: ['system'],
  requiredPermission: 'sofia.command.operational.disabled',
};

const internalDefinition: CommandPolicyDefinition = {
  commandType: 'SOFIA_INTERNAL_VALIDATE',
  enabled: true,
  operational: false,
  approvalRequired: true,
  allowedSources: ['internal_validation'],
  allowedRoles: ['admin'],
  requiredPermission: 'sofia.command.internal_validate',
};

function command(definition: CommandPolicyDefinition, actorId: string) {
  return { commandType: definition.commandType, actorId } as CommandRecord;
}

describe('Secure command approval separation of duties', () => {
  const repository = {
    actorAuthorization: jest.fn().mockResolvedValue({
      active: true,
      roles: ['admin'],
      permissions: ['sofia.command.approve'],
    }),
  } as unknown as CommandRepository;
  const safety = {
    current: jest.fn().mockResolvedValue({ killSwitchActive: false, globalPaused: false }),
  } as CommandRuntimeSafety;
  const registry = {
    definition: jest.fn((commandType: string) => (
      commandType === operationalDefinition.commandType ? operationalDefinition : internalDefinition
    )),
  };
  const policy = new CommandPolicyService(repository, safety, registry as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects self-approval for an operational command before authorization lookup', async () => {
    await expect(policy.assertApproverAllowed(
      command(operationalDefinition, 'requester-1'),
      { actorId: 'requester-1', actorType: 'USER', roles: ['admin'] },
    )).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    expect(repository.actorAuthorization).not.toHaveBeenCalled();
    expect(safety.current).not.toHaveBeenCalled();
  });

  it('allows an independently authorized approver for an operational command', async () => {
    await expect(policy.assertApproverAllowed(
      command(operationalDefinition, 'requester-1'),
      { actorId: 'approver-2', actorType: 'USER', roles: ['admin'] },
    )).resolves.toMatchObject({ active: true, roles: ['admin'] });
  });

  it('preserves non-operational validation policy and permits an authorized same actor', async () => {
    await expect(policy.assertApproverAllowed(
      command(internalDefinition, 'admin-1'),
      { actorId: 'admin-1', actorType: 'USER', roles: ['admin'] },
    )).resolves.toMatchObject({ active: true });
  });

  it('rejects self-approval for an operational command even when the actor holds admin AND supervisor roles (admin/role overlap does not override separation)', async () => {
    // No mockResolvedValueOnce queued here on purpose: the identity check must short-circuit
    // before any role/permission lookup, so holding every eligible-approver role simultaneously
    // cannot substitute for a distinct approver. If this ever started consulting authorization
    // first, the assertion below on `not.toHaveBeenCalled()` would catch it.
    await expect(policy.assertApproverAllowed(
      command(operationalDefinition, 'requester-2'),
      { actorId: 'requester-2', actorType: 'USER', roles: ['admin', 'supervisor'] },
    )).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    expect(repository.actorAuthorization).not.toHaveBeenCalled();
  });

  it('rejects self-approval for an operational command when the actor would otherwise be eligible via a granular permission (not admin/supervisor role)', async () => {
    await expect(policy.assertApproverAllowed(
      command(operationalDefinition, 'requester-3'),
      { actorId: 'requester-3', actorType: 'USER', roles: [] },
    )).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
    expect(repository.actorAuthorization).not.toHaveBeenCalled();
  });

  it('honors requireSeparation:false to intentionally bypass the self-approver identity check (the exact flag revoke() uses)', async () => {
    // This documents, at the unit level, precisely what CommandApprovalService.revoke() relies
    // on: with requireSeparation:false the same-actor identity block is skipped entirely. Safety
    // against this being turned into a separation-of-duties bypass therefore depends on revoke()
    // never re-opening the command for re-approval -- verified independently in the DB-backed
    // command-approval.separation-of-duties.spec.ts terminality tests.
    (repository.actorAuthorization as jest.Mock).mockResolvedValueOnce({
      active: true,
      roles: ['admin'],
      permissions: [],
    });
    await expect(policy.assertApproverAllowed(
      command(operationalDefinition, 'requester-1'),
      { actorId: 'requester-1', actorType: 'USER', roles: ['admin'] },
      { requireSeparation: false },
    )).resolves.toMatchObject({ active: true, roles: ['admin'] });
  });

  it('still requires an eligible role/permission when requireSeparation:false only waives the identity check', async () => {
    (repository.actorAuthorization as jest.Mock).mockResolvedValueOnce({
      active: true,
      roles: ['cashier'],
      permissions: [],
    });
    await expect(policy.assertApproverAllowed(
      command(operationalDefinition, 'requester-1'),
      { actorId: 'requester-1', actorType: 'USER', roles: ['cashier'] },
      { requireSeparation: false },
    )).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_INVALID' });
  });

  it('preserves SYSTEM actor attribution in command audit evidence', () => {
    const audit = new CommandAuditService({} as never);
    const evidence = audit.evidence({
      id: 'command-1',
      actorId: 'sofia-notification-outbox',
      actorType: 'SYSTEM',
      actorRoles: ['system'],
      source: 'notification_outbox',
      correlationId: 'correlation-1',
      traceId: 'trace-1',
      idempotencyKey: 'idempotency-1',
      releaseVersion: 'release-1',
    }, 'SOFIA_COMMAND_RECEIVED', 'SUCCESS', 'SOFIA_COMMAND_RECEIVED');

    expect(evidence).toMatchObject({
      actorId: 'sofia-notification-outbox',
      actorType: 'SYSTEM',
      actorRole: 'system',
    });
  });
});
