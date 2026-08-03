import { Injectable } from '@nestjs/common';
import { CommandRedactionService } from './command-redaction.service';
import type { CommandHandlerResult } from './secure-command.types';

@Injectable()
export class CommandResultStore {
  constructor(private readonly redaction: CommandRedactionService) {}

  prepare(result: CommandHandlerResult, now = new Date()) {
    const sanitizedPayload = this.redaction.sanitizeResult(result.payload);
    const domainReferenceIds = [...new Set((result.domainReferenceIds ?? []).filter((id) => /^[A-Za-z0-9._:-]{1,128}$/.test(id)))];
    return {
      resultCode: result.resultCode.slice(0, 128),
      sanitizedPayload,
      resultHash: this.redaction.resultHash({ resultCode: result.resultCode, sanitizedPayload, domainReferenceIds }),
      domainReferenceIds,
      retentionUntil: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
    };
  }
}
