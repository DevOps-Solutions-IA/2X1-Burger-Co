import { CommandPolicyService } from './command-policy.service';
import type { CommandRepository, CommandRuntimeSafety } from './ports/command-repository.port';
import type { CommandPolicyDefinition, CommandRecord } from './secure-command.types';

/**
 * Ported from the historical S1 audit/reproduction track (worktree commit 97bda07,
 * never merged to main: "prove revoke()/approve() separation-of-duties bypass is not
 * reproducible"). command-policy.separation.spec.ts in this module already covers the
 * baseline self-approval rejection and the independently-authorized-approver path; this
 * file adds the coverage that commit introduced and that was never ported: that the
 * self-approval identity check in CommandPolicyService.assertApproverAllowed() cannot be
 * defeated by role/permission overlap, and that `requireSeparation: false` -- the exact
 * flag CommandApprovalService.revoke() passes -- waives ONLY that identity check, never
 * the underlying role/permission eligibility check.
 *
 * Re-verified against apps/api/src/modules/secure-command/command-policy.service.ts on
 * origin/main @ ed25ec2b9d815d47c9d2828134ed742c7f8a91cf before porting: the mechanism
 * (assertApproverAllowed, lines ~100-128) is unchanged from what the historical commit
 * documented.
 */
const operationalDefinition: CommandPolicyDefinition = {
  commandType: 'SOFIA_SEND_WHATSAPP',
  enabled: false,
  operational: true,
  approvalRequired: true,
  allowedSources: ['notification_outbox'],
  allowedRoles: ['system'],
  requiredPermission: 'sofia.command.operational.disabled',
};

function command(definition: CommandPolicyDefinition, actorId: string) {
  return { commandType: definition.commandType, actorId } as CommandRecord;
}

describe('Secure command approval separation of duties -- role/permission overlap cannot bypass identity check', () => {
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
    definition: jest.fn(() => operationalDefinition),
  };
  const policy = new CommandPolicyService(repository, safety, registry as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects self-approval for an operational command even when the actor holds admin AND supervisor roles (role overlap does not override separation)', async () => {
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
    // secure-command-approval.separation-of-duties.spec.ts terminality tests.
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
});
