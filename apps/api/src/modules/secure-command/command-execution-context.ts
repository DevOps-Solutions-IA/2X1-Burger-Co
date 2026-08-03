import { Injectable } from '@nestjs/common';
import { AuditContextService } from '../audit/audit-context.service';
import type { CommandActor, CommandExecutionContextValue } from './secure-command.types';
import { SecureCommandError } from './secure-command.errors';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_SCOPE = /^[A-Za-z0-9._:-]{1,96}$/;

@Injectable()
export class CommandExecutionContext {
  constructor(private readonly auditContext: AuditContextService) {}

  create(input: { actor: CommandActor; source: string; scope: string }): CommandExecutionContextValue {
    const current = this.auditContext.current();
    const actorId = this.identifier(input.actor.actorId);
    const source = this.identifier(input.source);
    const scope = input.scope.trim();
    if (!actorId || !source || !SAFE_SCOPE.test(scope) || input.actor.roles.length === 0) {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    const roles = [...new Set(input.actor.roles.map((role) => this.identifier(role)).filter(Boolean) as string[])].sort();
    if (roles.length === 0) throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    return {
      actor: { actorId, actorType: input.actor.actorType, roles },
      source,
      scope,
      releaseVersion: current?.releaseVersion ?? this.identifier(process.env.RELEASE_BUILD_ID) ?? 'unversioned',
      requestId: current?.requestId ?? null,
      correlationId: current?.correlationId ?? null,
      traceId: current?.traceId ?? null,
    };
  }

  private identifier(value: string | null | undefined) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return SAFE_IDENTIFIER.test(normalized) ? normalized : null;
  }
}
