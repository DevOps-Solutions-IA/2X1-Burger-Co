import { Injectable } from '@nestjs/common';
import type { AuditCommandInput, AuditCommandService, AuditTransactionContext } from '../../application/contracts/sofia-domain-contracts';
import type { AuditDatabaseClient } from './audit.types';
import { AuditService } from './audit.service';

@Injectable()
export class AuthoritativeAuditCommandAdapter implements AuditCommandService {
  constructor(private readonly audit: AuditService) {}

  async record(input: AuditCommandInput, transaction?: AuditTransactionContext) {
    const event = await this.audit.log({
      actorId: input.actor.actorId,
      actorRole: input.actor.roles[0] ?? null,
      action: input.action,
      module: 'sofia',
      entity: input.entity,
      entityId: input.entityId,
      result: input.result,
      reasonCode: input.reasonCode,
      before: input.before,
      after: input.after,
      requestId: input.actor.requestId,
      correlationId: input.actor.correlationId,
      source: input.actor.source,
    }, transaction?.auditClient as AuditDatabaseClient | undefined);
    return { auditEventId: event.id, timestamp: event.timestamp.toISOString() };
  }
}
