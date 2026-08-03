import { Inject, Injectable } from '@nestjs/common';
import { COMMAND_REPOSITORY, type CommandRepository } from './ports/command-repository.port';
import { CommandApprovalService, type ApprovalBinding } from './command-approval.service';
import { CommandAuditService } from './command-audit.service';
import { CommandConflictResolver } from './command-conflict-resolver';
import { CommandExecutionContext } from './command-execution-context';
import { CommandHandlerRegistry } from './command-handler.registry';
import { CommandIdempotencyService } from './command-idempotency.service';
import { assertCommandTransition } from './command-lifecycle';
import { CommandPolicyService } from './command-policy.service';
import { CommandRedactionService } from './command-redaction.service';
import { CommandResultStore } from './command-result.store';
import { SecureCommandError } from './secure-command.errors';
import type { CommandActor, CommandRecord, ReceiveCommandInput, SecureCommandType } from './secure-command.types';

@Injectable()
export class SecureCommandService {
  constructor(
    @Inject(COMMAND_REPOSITORY) private readonly repository: CommandRepository,
    private readonly contexts: CommandExecutionContext,
    private readonly idempotency: CommandIdempotencyService,
    private readonly approvals: CommandApprovalService,
    private readonly policy: CommandPolicyService,
    private readonly handlers: CommandHandlerRegistry,
    private readonly results: CommandResultStore,
    private readonly conflicts: CommandConflictResolver,
    private readonly audit: CommandAuditService,
    private readonly redaction: CommandRedactionService,
  ) {}

  receive(input: Omit<ReceiveCommandInput, 'context'> & { actor: CommandActor; source: string; scope: string }) {
    return this.idempotency.receive({
      commandType: input.commandType,
      idempotencyKey: input.idempotencyKey,
      target: input.target,
      payload: input.payload,
      expiresAt: input.expiresAt,
      context: this.contexts.create({ actor: input.actor, source: input.source, scope: input.scope }),
    });
  }

  approve(input: {
    commandId: string;
    approver: CommandActor;
    binding: ApprovalBinding;
    expiresAt: Date;
    reasonCode: string;
    policyReference: string;
  }) {
    return this.approvals.grant(input);
  }

  revokeApproval(approvalId: string, actor: CommandActor) {
    return this.approvals.revoke(approvalId, actor);
  }

  async execute(input: { commandId: string; actor: CommandActor; claimOwner: string; leaseSeconds?: number }) {
    let command = await this.requiredCommand(input.commandId);
    if (command.status === 'SUCCEEDED' && command.result) {
      await this.audit.record(this.audit.evidence(command, 'SOFIA_COMMAND_RESULT_REPLAYED', 'NO_OP', 'SOFIA_COMMAND_RESULT_REPLAYED'));
      return { command, result: command.result, replayed: true };
    }
    command = await this.recoverExpiredLease(command);
    if (command.status === 'CLAIMED' || command.status === 'EXECUTING') {
      throw new SecureCommandError('SOFIA_COMMAND_ALREADY_RUNNING');
    }
    if (command.expiresAt <= new Date()) {
      command = await this.expire(command);
      throw new SecureCommandError('SOFIA_COMMAND_EXPIRED');
    }
    if (command.status === 'FAILED' && !command.retryable) throw new SecureCommandError('SOFIA_COMMAND_NOT_RETRYABLE');
    if (!['APPROVED', 'FAILED'].includes(command.status)) throw new SecureCommandError('SOFIA_COMMAND_APPROVAL_REQUIRED');
    await this.policy.assertAllowed({ command, actor: input.actor, stage: 'BEFORE_CLAIM' });
    const approval = await this.approvals.validate(command, await this.repository.findValidApproval(command.id, new Date()));
    const leaseSeconds = Math.min(Math.max(input.leaseSeconds ?? 30, 5), 120);
    const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000);
    assertCommandTransition(command.status, 'CLAIMED', command.retryable);
    const claimed = await this.repository.claim({
      commandId: command.id,
      expectedVersion: command.version,
      claimOwnerHash: this.redaction.hashIdentifier(input.claimOwner),
      leaseExpiresAt,
      releaseVersion: command.releaseVersion,
      approvalId: approval.id,
      audit: this.audit.evidence(command, 'SOFIA_COMMAND_CLAIMED', 'SUCCESS', 'SOFIA_COMMAND_CLAIMED'),
    });
    command = claimed.command;
    try {
      await this.policy.assertAllowed({ command, actor: input.actor, stage: 'BEFORE_HANDLER' });
      assertCommandTransition(command.status, 'EXECUTING');
      command = await this.repository.markExecuting({
        commandId: command.id,
        attemptId: claimed.attempt.id,
        expectedVersion: command.version,
        audit: this.audit.evidence(command, 'SOFIA_COMMAND_EXECUTING', 'SUCCESS', 'SOFIA_COMMAND_EXECUTING'),
      });
      await this.policy.assertAllowed({ command, actor: input.actor, stage: 'BEFORE_HANDLER' });
      const handlerResult = await this.handlers.execute(command);
      const prepared = this.results.prepare(handlerResult);
      assertCommandTransition(command.status, 'SUCCEEDED');
      const succeeded = await this.repository.succeed({
        commandId: command.id,
        attemptId: claimed.attempt.id,
        expectedVersion: command.version,
        ...prepared,
        audit: this.audit.evidence(command, 'SOFIA_COMMAND_SUCCEEDED', 'SUCCESS', prepared.resultCode),
      });
      return { command: succeeded.command, result: succeeded.result, replayed: false };
    } catch (error) {
      const classification = this.conflicts.classify(error);
      try {
        await this.repository.fail({
          commandId: command.id,
          attemptId: claimed.attempt.id,
          expectedVersion: command.version,
          ...classification,
          failureCode: classification.code,
          audit: this.audit.evidence(command, 'SOFIA_COMMAND_FAILED', 'FAILED', classification.code, { retryable: classification.retryable }),
        });
      } catch {
        // A concurrent terminal transition is authoritative; never overwrite it.
      }
      throw error;
    }
  }

  definition(commandType: SecureCommandType) {
    return this.policy.definition(commandType);
  }

  private async recoverExpiredLease(command: CommandRecord) {
    if (!['CLAIMED', 'EXECUTING'].includes(command.status) || !command.leaseExpiresAt || command.leaseExpiresAt > new Date()) return command;
    const unknownResult = command.status === 'EXECUTING';
    const recovered = await this.repository.recoverExpiredLease({
      commandId: command.id,
      expectedVersion: command.version,
      unknownResult,
      audit: this.audit.evidence(command, 'SOFIA_COMMAND_LEASE_RECOVERED', unknownResult ? 'FAILED' : 'SUCCESS', unknownResult ? 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE' : 'SOFIA_COMMAND_EXPIRED'),
    });
    if (unknownResult) throw new SecureCommandError('SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE');
    return recovered;
  }

  private async expire(command: CommandRecord) {
    if (['SUCCEEDED', 'REJECTED', 'EXPIRED'].includes(command.status)) return command;
    assertCommandTransition(command.status, 'EXPIRED', command.retryable);
    return this.repository.transition({
      commandId: command.id,
      expectedVersion: command.version,
      from: [command.status],
      to: 'EXPIRED',
      completedAt: new Date(),
      failureClass: 'POLICY',
      failureCode: 'SOFIA_COMMAND_EXPIRED',
      retryable: false,
      audit: this.audit.evidence(command, 'SOFIA_COMMAND_EXPIRED', 'REJECTED', 'SOFIA_COMMAND_EXPIRED'),
    });
  }

  private async requiredCommand(commandId: string) {
    const command = await this.repository.find(commandId);
    if (!command) throw new SecureCommandError('SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE');
    return command;
  }
}
