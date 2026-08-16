import { Module } from '@nestjs/common';
import { SofiaModule } from '../sofia/sofia.module';
import { CommandAdminReadService } from './command-admin-read.service';
import { CommandApprovalService } from './command-approval.service';
import { CommandAuditService } from './command-audit.service';
import { CommandConflictResolver } from './command-conflict-resolver';
import { CommandExecutionContext } from './command-execution-context';
import { CommandHandlerRegistry } from './command-handler.registry';
import { CommandIdempotencyService } from './command-idempotency.service';
import { CommandPolicyService } from './command-policy.service';
import { CommandRedactionService } from './command-redaction.service';
import { CommandResultStore } from './command-result.store';
import { COMMAND_REPOSITORY, COMMAND_RUNTIME_SAFETY } from './ports/command-repository.port';
import { PrismaCommandRepository } from './persistence/prisma-command.repository';
import { SofiaCommandRuntimeSafetyAdapter } from './runtime-safety.adapter';
import { SecureCommandAdminController } from './secure-command-admin.controller';
import { SecureCommandService } from './secure-command.service';

@Module({
  imports: [SofiaModule],
  controllers: [SecureCommandAdminController],
  providers: [
    SecureCommandService,
    CommandAdminReadService,
    CommandApprovalService,
    CommandAuditService,
    CommandConflictResolver,
    CommandExecutionContext,
    CommandHandlerRegistry,
    CommandIdempotencyService,
    CommandPolicyService,
    CommandRedactionService,
    CommandResultStore,
    PrismaCommandRepository,
    SofiaCommandRuntimeSafetyAdapter,
    { provide: COMMAND_REPOSITORY, useExisting: PrismaCommandRepository },
    { provide: COMMAND_RUNTIME_SAFETY, useExisting: SofiaCommandRuntimeSafetyAdapter },
  ],
  exports: [SecureCommandService],
})
export class SecureCommandModule {}
