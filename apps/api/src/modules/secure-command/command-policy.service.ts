import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { COMMAND_REPOSITORY, COMMAND_RUNTIME_SAFETY, type CommandRepository, type CommandRuntimeSafety } from './ports/command-repository.port';
import { CommandHandlerRegistry } from './command-handler.registry';
import { SecureCommandError } from './secure-command.errors';
import type { CommandActor, CommandPolicyDefinition, CommandPolicyStage, CommandRecord } from './secure-command.types';

@Injectable()
export class CommandPolicyService {
  constructor(
    @Inject(COMMAND_REPOSITORY) private readonly repository: CommandRepository,
    @Inject(COMMAND_RUNTIME_SAFETY) private readonly safety: CommandRuntimeSafety,
    private readonly registry: CommandHandlerRegistry,
  ) {}

  definition(commandType: string) {
    return this.registry.definition(commandType);
  }

  policyHash(definition: CommandPolicyDefinition) {
    return createHash('sha256').update(JSON.stringify({
      version: 1,
      commandType: definition.commandType,
      enabled: definition.enabled,
      operational: definition.operational,
      approvalRequired: definition.approvalRequired,
      allowedSources: [...definition.allowedSources].sort(),
      allowedRoles: [...definition.allowedRoles].sort(),
      requiredPermission: definition.requiredPermission,
      receiveWhileDisabled: definition.receiveWhileDisabled === true,
    })).digest('hex');
  }

  async assertAllowed(input: {
    command: Pick<CommandRecord, 'commandType' | 'source' | 'expiresAt' | 'releaseVersion' | 'actorId'>;
    actor: CommandActor;
    stage: CommandPolicyStage;
    now?: Date;
  }) {
    const definition = this.definition(input.command.commandType);
    const now = input.now ?? new Date();
    const durableDisabledReceipt = input.stage === 'RECEIVE'
      && definition.receiveWhileDisabled === true
      && !definition.enabled
      && definition.operational;
    if (
      (!durableDisabledReceipt && (!definition.enabled || definition.operational))
      || input.command.expiresAt.getTime() <= now.getTime()
    ) {
      throw new SecureCommandError(input.command.expiresAt.getTime() <= now.getTime() ? 'SOFIA_COMMAND_EXPIRED' : 'SOFIA_COMMAND_POLICY_BLOCKED');
    }
    if (durableDisabledReceipt) {
      const sourceAllowed = definition.allowedSources.includes(input.command.source);
      const roleAllowed = definition.allowedRoles.some((role) => input.actor.roles.includes(role));
      if (
        input.actor.actorType !== 'SYSTEM'
        || input.command.actorId !== input.actor.actorId
        || !sourceAllowed
        || !roleAllowed
      ) {
        throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
      }
      const safety = await this.safety.current();
      if (safety.killSwitchActive || safety.globalPaused) {
        throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
      }
      return {
        definition,
        authorization: { active: true, roles: [...input.actor.roles], permissions: [] },
        safety,
        stage: input.stage,
        receiptOnly: true,
      };
    }
    if (input.actor.actorType !== 'USER' || input.command.actorId !== input.actor.actorId) {
      throw new SecureCommandError('SOFIA_COMMAND_ACTOR_CONFLICT');
    }
    if (!definition.allowedSources.includes(input.command.source)) {
      throw new SecureCommandError('SOFIA_COMMAND_SOURCE_CONFLICT');
    }
    const runtimeRelease = process.env.RELEASE_BUILD_ID?.trim();
    if (runtimeRelease && input.command.releaseVersion !== runtimeRelease) {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    const [authorization, safety] = await Promise.all([
      this.repository.actorAuthorization(input.actor.actorId),
      this.safety.current(),
    ]);
    const roleAllowed = definition.allowedRoles.some((role) => authorization.roles.includes(role));
    const permissionAllowed = authorization.permissions.includes(definition.requiredPermission);
    if (!authorization.active || (!roleAllowed && !permissionAllowed)) {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    if (safety.killSwitchActive || safety.globalPaused) {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    return { definition, authorization, safety, stage: input.stage };
  }

  async assertApproverAllowed(command: CommandRecord, approver: CommandActor) {
    const definition = this.definition(command.commandType);
    if (approver.actorType !== 'USER') throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_INVALID');
    const [authorization, safety] = await Promise.all([
      this.repository.actorAuthorization(approver.actorId),
      this.safety.current(),
    ]);
    const canApprove = authorization.active && (
      authorization.roles.includes('admin') ||
      authorization.roles.includes('supervisor') ||
      authorization.permissions.includes('sofia.command.approve')
    );
    if (!canApprove || safety.killSwitchActive || safety.globalPaused || !definition.approvalRequired) {
      throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_INVALID');
    }
    return authorization;
  }
}
