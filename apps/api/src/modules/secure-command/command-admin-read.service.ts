import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { COMMAND_REPOSITORY, type CommandListQuery, type CommandRepository } from './ports/command-repository.port';
import { CommandAuditService } from './command-audit.service';
import { assertCommandTransition } from './command-lifecycle';
import { SecureCommandError } from './secure-command.errors';
import type { CommandActor } from './secure-command.types';

const REJECTABLE_FROM_STATUSES = ['RECEIVED', 'VALIDATED', 'APPROVAL_REQUIRED', 'APPROVED'] as const;

/**
 * Superficie de solo lectura + rechazo administrativo sobre SecureCommand.
 * No expone ni reimplementa `receive()` — la creación de comandos sigue
 * siendo responsabilidad exclusiva de los flujos operacionales existentes
 * (ej. notification-dispatch). Aprobar se delega a `CommandApprovalService`,
 * que ya aplica separación de funciones y validación de política.
 */
@Injectable()
export class CommandAdminReadService {
  constructor(
    @Inject(COMMAND_REPOSITORY) private readonly repository: CommandRepository,
    private readonly audit: CommandAuditService,
  ) {}

  list(query: CommandListQuery) {
    return this.repository.list(query);
  }

  async get(commandId: string) {
    const command = await this.repository.find(commandId);
    if (!command) throw new NotFoundException({ code: 'SOFIA_COMMAND_NOT_FOUND' });
    const approvals = await this.repository.listApprovals(commandId);
    return { command, approvals };
  }

  async reject(commandId: string, actor: CommandActor, reasonCode: string) {
    const command = await this.repository.find(commandId);
    if (!command) throw new NotFoundException({ code: 'SOFIA_COMMAND_NOT_FOUND' });
    if (!REJECTABLE_FROM_STATUSES.includes(command.status as (typeof REJECTABLE_FROM_STATUSES)[number])) {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    assertCommandTransition(command.status, 'REJECTED');
    return this.repository.transition({
      commandId: command.id,
      expectedVersion: command.version,
      from: [...REJECTABLE_FROM_STATUSES],
      to: 'REJECTED',
      audit: {
        ...this.audit.evidence(command, 'SOFIA_COMMAND_REJECTED', 'REJECTED', reasonCode.slice(0, 128), {
          rejectionId: randomUUID(),
        }),
        actorId: actor.actorId,
        actorRole: actor.roles[0] ?? null,
      },
    });
  }
}
