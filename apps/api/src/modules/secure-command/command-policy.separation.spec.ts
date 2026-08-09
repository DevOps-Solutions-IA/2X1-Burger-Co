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
