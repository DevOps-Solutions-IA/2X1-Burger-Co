import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { CommandAuditEvidence, CommandRecord } from './secure-command.types';

@Injectable()
export class CommandAuditService {
  constructor(private readonly audit: AuditService) {}

  evidence(
    command: Pick<CommandRecord, 'id' | 'actorId' | 'actorType' | 'actorRoles' | 'source' | 'correlationId' | 'traceId' | 'idempotencyKey' | 'releaseVersion'>,
    action: string,
    result: CommandAuditEvidence['result'],
    reasonCode: string,
    metadata?: Record<string, unknown>,
  ): CommandAuditEvidence {
    return {
      actorId: command.actorId,
      actorType: command.actorType === 'SYSTEM' ? 'SYSTEM' : 'USER',
      actorRole: command.actorRoles[0] ?? null,
      action,
      entityId: command.id || null,
      result,
      reasonCode,
      source: command.source,
      correlationId: command.correlationId,
      traceId: command.traceId,
      idempotencyKey: command.idempotencyKey,
      releaseVersion: command.releaseVersion,
      metadata,
    };
  }

  async record(evidence: CommandAuditEvidence) {
    await this.audit.log({
      actorId: evidence.actorId,
      actorType: evidence.actorType,
      actorRole: evidence.actorRole,
      action: evidence.action,
      module: 'secure_command',
      entity: 'sofia_command',
      entityId: evidence.entityId,
      result: evidence.result,
      reasonCode: evidence.reasonCode,
      source: evidence.source,
      correlationId: evidence.correlationId,
      traceId: evidence.traceId,
      idempotencyKey: evidence.idempotencyKey,
      releaseVersion: evidence.releaseVersion,
      metadata: evidence.metadata,
    });
  }
}
