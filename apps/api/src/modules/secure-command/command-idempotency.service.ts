import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { COMMAND_REPOSITORY, type CommandRepository, type NewCommandRecord } from './ports/command-repository.port';
import { CommandAuditService } from './command-audit.service';
import { CommandPolicyService } from './command-policy.service';
import { CommandRedactionService } from './command-redaction.service';
import { SecureCommandError } from './secure-command.errors';
import { assertCommandTransition } from './command-lifecycle';
import type { CommandAuditEvidence, CommandRecord, CommandView, ReceiveCommandInput } from './secure-command.types';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,256}$/;

@Injectable()
export class CommandIdempotencyService {
  constructor(
    @Inject(COMMAND_REPOSITORY) private readonly repository: CommandRepository,
    private readonly audit: CommandAuditService,
    private readonly policy: CommandPolicyService,
    private readonly redaction: CommandRedactionService,
  ) {}

  async receive(input: ReceiveCommandInput): Promise<CommandView> {
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey) || input.expiresAt.getTime() <= Date.now()) {
      throw new SecureCommandError('SOFIA_COMMAND_EXPIRED');
    }
    const definition = this.policy.definition(input.commandType);
    const idempotencyKey = this.redaction.hashIdentifier(input.idempotencyKey);
    const payloadHash = this.redaction.payloadHash(input.payload);
    const record: NewCommandRecord = {
      id: randomUUID(),
      commandType: input.commandType,
      scope: input.context.scope,
      idempotencyKey,
      actorId: input.context.actor.actorId,
      actorType: input.context.actor.actorType,
      actorRoles: input.context.actor.roles,
      source: input.context.source,
      targetType: this.identifier(input.target.type),
      targetId: input.target.id ? this.identifier(input.target.id) : null,
      expectedVersion: input.target.expectedVersion ? this.identifier(input.target.expectedVersion) : null,
      payloadHash,
      policyHash: this.policy.policyHash(definition),
      releaseVersion: input.context.releaseVersion,
      correlationId: input.context.correlationId,
      traceId: input.context.traceId,
      expiresAt: input.expiresAt,
    };
    await this.assertPolicy(record, input.context.actor, input.expiresAt);
    const initialAudit = this.initialAudit(record);
    const received = await this.repository.receive(record, initialAudit);
    if (!received.created) {
      await this.assertSameBinding(received.command, record);
      await this.audit.record(this.audit.evidence(received.command, 'SOFIA_COMMAND_REPLAYED', 'NO_OP', 'SOFIA_COMMAND_REPLAYED', {
        status: received.command.status,
        hasResult: Boolean(received.command.result),
      }));
      return { command: received.command, replayed: true };
    }

    assertCommandTransition(received.command.status, 'VALIDATED');
    const validated = await this.repository.transition({
      commandId: received.command.id,
      expectedVersion: received.command.version,
      from: ['RECEIVED'],
      to: 'VALIDATED',
      audit: this.audit.evidence(received.command, 'SOFIA_COMMAND_VALIDATED', 'SUCCESS', 'SOFIA_COMMAND_VALIDATED'),
    });
    assertCommandTransition(validated.status, 'APPROVAL_REQUIRED');
    const awaitingApproval = await this.repository.transition({
      commandId: validated.id,
      expectedVersion: validated.version,
      from: ['VALIDATED'],
      to: 'APPROVAL_REQUIRED',
      audit: this.audit.evidence(validated, 'SOFIA_COMMAND_APPROVAL_REQUIRED', 'SUCCESS', 'SOFIA_COMMAND_APPROVAL_REQUIRED'),
    });
    return { command: awaitingApproval, replayed: false };
  }

  private async assertPolicy(record: NewCommandRecord, actor: ReceiveCommandInput['context']['actor'], expiresAt: Date) {
    try {
      await this.policy.assertAllowed({ command: { ...record, expiresAt }, actor, stage: 'RECEIVE' });
    } catch (error) {
      const code = error instanceof SecureCommandError ? error.code : 'SOFIA_COMMAND_POLICY_BLOCKED';
      await this.audit.record({ ...this.initialAudit(record), action: 'SOFIA_COMMAND_RECEIVE_BLOCKED', result: 'BLOCKED', reasonCode: code });
      throw error;
    }
  }

  private async assertSameBinding(existing: CommandRecord, incoming: NewCommandRecord) {
    const conflict = existing.actorId !== incoming.actorId || existing.actorType !== incoming.actorType
      ? 'SOFIA_COMMAND_ACTOR_CONFLICT'
      : existing.source !== incoming.source
        ? 'SOFIA_COMMAND_SOURCE_CONFLICT'
        : existing.targetType !== incoming.targetType || existing.targetId !== incoming.targetId || existing.expectedVersion !== incoming.expectedVersion
          ? 'SOFIA_COMMAND_TARGET_CONFLICT'
          : existing.payloadHash !== incoming.payloadHash
            ? 'SOFIA_COMMAND_PAYLOAD_CONFLICT'
            : existing.policyHash !== incoming.policyHash || existing.releaseVersion !== incoming.releaseVersion
              ? 'SOFIA_COMMAND_IDEMPOTENCY_CONFLICT'
              : null;
    if (conflict) {
      await this.audit.record(this.audit.evidence(existing, 'SOFIA_COMMAND_REPLAY_CONFLICT', 'CONFLICT', conflict));
      throw new SecureCommandError(conflict);
    }
  }

  private initialAudit(record: NewCommandRecord): CommandAuditEvidence {
    return {
      actorId: record.actorId,
      actorType: record.actorType === 'SYSTEM' ? 'SYSTEM' : 'USER',
      actorRole: record.actorRoles[0] ?? null,
      action: 'SOFIA_COMMAND_RECEIVED',
      entityId: record.id,
      result: 'SUCCESS',
      reasonCode: 'SOFIA_COMMAND_RECEIVED',
      source: record.source,
      correlationId: record.correlationId,
      traceId: record.traceId,
      idempotencyKey: record.idempotencyKey,
      releaseVersion: record.releaseVersion,
      metadata: { commandType: record.commandType, scope: record.scope, targetType: record.targetType },
    };
  }

  private identifier(value: string) {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) throw new SecureCommandError('SOFIA_COMMAND_TARGET_CONFLICT');
    return normalized;
  }
}
