import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { COMMAND_REPOSITORY, type CommandRepository } from './ports/command-repository.port';
import { CommandAuditService } from './command-audit.service';
import { CommandPolicyService } from './command-policy.service';
import { SecureCommandError } from './secure-command.errors';
import { assertCommandTransition, isTerminalStatus } from './command-lifecycle';
import type { CommandActor, CommandApprovalRecord, CommandRecord } from './secure-command.types';

export type ApprovalBinding = {
  payloadHash: string;
  expectedVersion: string | null;
  targetType: string;
  targetId: string | null;
  source: string;
};

@Injectable()
export class CommandApprovalService {
  constructor(
    @Inject(COMMAND_REPOSITORY) private readonly repository: CommandRepository,
    private readonly audit: CommandAuditService,
    private readonly policy: CommandPolicyService,
  ) {}

  async grant(input: {
    commandId: string;
    approver: CommandActor;
    binding: ApprovalBinding;
    expiresAt: Date;
    reasonCode: string;
    policyReference: string;
  }) {
    const command = await this.requiredCommand(input.commandId);
    if (command.status !== 'APPROVAL_REQUIRED' || input.expiresAt.getTime() <= Date.now() || input.expiresAt > command.expiresAt) {
      throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_INVALID');
    }
    this.assertBinding(command, input.binding);
    const authorization = await this.policy.assertApproverAllowed(command, input.approver);
    assertCommandTransition(command.status, 'APPROVED');
    const auditIdentity = createHash('sha256').update(`${command.id}:${input.approver.actorId}:${randomUUID()}`).digest('hex');
    return this.repository.grantApproval({
      commandId: command.id,
      approverActorId: input.approver.actorId,
      approverRoles: authorization.roles,
      payloadHash: command.payloadHash,
      expectedVersion: command.expectedVersion,
      targetType: command.targetType,
      targetId: command.targetId,
      source: command.source,
      expiresAt: input.expiresAt,
      reasonCode: input.reasonCode.slice(0, 128),
      policyReference: input.policyReference.slice(0, 128),
      auditIdentity,
    }, command.version, {
      ...this.audit.evidence(command, 'SOFIA_COMMAND_APPROVED', 'SUCCESS', 'SOFIA_COMMAND_APPROVED'),
      actorId: input.approver.actorId,
      actorRole: authorization.roles[0] ?? null,
    });
  }

  async revoke(approvalId: string, actor: CommandActor) {
    const approval = await this.repository.findApproval(approvalId);
    if (!approval || approval.status !== 'APPROVED') throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_INVALID');
    const command = await this.requiredCommand(approval.commandId);
    await this.policy.assertApproverAllowed(command, actor);
    return this.repository.revokeApproval({
      approvalId,
      actorId: actor.actorId,
      audit: { ...this.audit.evidence(command, 'SOFIA_COMMAND_APPROVAL_REVOKED', 'SUCCESS', 'SOFIA_COMMAND_APPROVAL_REVOKED'), actorId: actor.actorId },
    });
  }

  async validate(command: CommandRecord, approval: CommandApprovalRecord | null, now = new Date()) {
    if (!approval || isTerminalStatus(command.status) || approval.status !== 'APPROVED' || approval.revokedAt || approval.expiresAt <= now) {
      throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_INVALID');
    }
    this.assertBinding(command, approval);
    await this.policy.assertApproverAllowed(command, {
      actorId: approval.approverActorId,
      actorType: 'USER',
      roles: approval.approverRoles,
    });
    return approval;
  }

  private assertBinding(command: CommandRecord, binding: ApprovalBinding) {
    if (
      binding.payloadHash !== command.payloadHash ||
      binding.expectedVersion !== command.expectedVersion ||
      binding.targetType !== command.targetType ||
      binding.targetId !== command.targetId ||
      binding.source !== command.source
    ) {
      throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_INVALID');
    }
  }

  private async requiredCommand(commandId: string) {
    const command = await this.repository.find(commandId);
    if (!command) throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_INVALID');
    return command;
  }
}
