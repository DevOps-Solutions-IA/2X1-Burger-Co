import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type SofiaCommand as PrismaCommand,
  type SofiaCommandApproval as PrismaApproval,
  type SofiaCommandAttempt as PrismaAttempt,
  type SofiaCommandResult as PrismaResult,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SecureCommandError } from '../secure-command.errors';
import type {
  ActorAuthorization,
  CommandApprovalRecord,
  CommandAttemptRecord,
  CommandAuditEvidence,
  CommandRecord,
  CommandResultRecord,
} from '../secure-command.types';
import type {
  CommandRepository,
  NewApprovalRecord,
  NewCommandRecord,
} from '../ports/command-repository.port';

type CommandWithResult = PrismaCommand & { result: PrismaResult | null };

@Injectable()
export class PrismaCommandRepository implements CommandRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async receive(input: NewCommandRecord, audit: CommandAuditEvidence) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.sofiaCommand.findUnique({
          where: { scope_commandType_idempotencyKey: this.key(input) },
          include: { result: true },
        });
        if (existing) return { command: this.command(existing), created: false };
        const created = await tx.sofiaCommand.create({
          data: {
            id: input.id,
            commandType: input.commandType,
            scope: input.scope,
            idempotencyKey: input.idempotencyKey,
            actorId: input.actorId,
            actorType: input.actorType,
            actorRolesSnapshot: input.actorRoles as Prisma.InputJsonValue,
            source: input.source,
            targetType: input.targetType,
            targetId: input.targetId,
            expectedVersion: input.expectedVersion,
            payloadHash: input.payloadHash,
            policyHash: input.policyHash,
            releaseVersion: input.releaseVersion,
            correlationId: input.correlationId,
            traceId: input.traceId,
            expiresAt: input.expiresAt,
          },
          include: { result: true },
        });
        await this.writeAudit(tx, audit);
        return { command: this.command(created), created: true };
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const existing = await this.prisma.sofiaCommand.findUniqueOrThrow({
        where: { scope_commandType_idempotencyKey: this.key(input) },
        include: { result: true },
      });
      return { command: this.command(existing), created: false };
    }
  }

  async find(commandId: string) {
    const record = await this.prisma.sofiaCommand.findUnique({ where: { id: commandId }, include: { result: true } });
    return record ? this.command(record) : null;
  }

  async list(query: Parameters<CommandRepository['list']>[0]) {
    const where: Prisma.SofiaCommandWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.commandType ? { commandType: query.commandType } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.sofiaCommand.count({ where }),
      this.prisma.sofiaCommand.findMany({
        where,
        include: { result: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: items.map((item) => this.command(item)), page: query.page, limit: query.limit, total };
  }

  async listApprovals(commandId: string) {
    const records = await this.prisma.sofiaCommandApproval.findMany({
      where: { commandId },
      orderBy: { grantedAt: 'desc' },
    });
    return records.map((record) => this.approval(record));
  }

  async findApproval(approvalId: string) {
    const record = await this.prisma.sofiaCommandApproval.findUnique({ where: { id: approvalId } });
    return record ? this.approval(record) : null;
  }

  async findValidApproval(commandId: string, now: Date) {
    const record = await this.prisma.sofiaCommandApproval.findFirst({
      where: { commandId, status: 'APPROVED', expiresAt: { gt: now }, revokedAt: null },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
    });
    return record ? this.approval(record) : null;
  }

  async actorAuthorization(actorId: string): Promise<ActorAuthorization> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        isActive: true,
        roles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
    if (!actor) return { active: false, roles: [], permissions: [] };
    return {
      active: actor.isActive,
      roles: [...new Set(actor.roles.map(({ role }) => role.name))].sort(),
      permissions: [...new Set(actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)))].sort(),
    };
  }

  async transition(input: Parameters<CommandRepository['transition']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.sofiaCommand.updateMany({
        where: { id: input.commandId, version: input.expectedVersion, status: { in: input.from } },
        data: {
          status: input.to,
          retryable: input.retryable,
          failureClass: input.failureClass,
          failureCode: input.failureCode,
          completedAt: input.completedAt,
          version: { increment: 1 },
        },
      });
      this.assertChanged(changed.count);
      await this.writeAudit(tx, input.audit);
      return this.command(await tx.sofiaCommand.findUniqueOrThrow({ where: { id: input.commandId }, include: { result: true } }));
    });
  }

  async grantApproval(input: NewApprovalRecord, expectedCommandVersion: number, audit: CommandAuditEvidence) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.sofiaCommand.updateMany({
        where: { id: input.commandId, version: expectedCommandVersion, status: 'APPROVAL_REQUIRED' },
        data: { status: 'APPROVED', version: { increment: 1 } },
      });
      this.assertChanged(changed.count);
      const approval = await tx.sofiaCommandApproval.create({
        data: {
          commandId: input.commandId,
          approverActorId: input.approverActorId,
          approverRolesSnapshot: input.approverRoles as Prisma.InputJsonValue,
          approvalAction: 'APPROVE',
          payloadHash: input.payloadHash,
          expectedVersion: input.expectedVersion,
          targetType: input.targetType,
          targetId: input.targetId,
          source: input.source,
          expiresAt: input.expiresAt,
          reasonCode: input.reasonCode,
          policyReference: input.policyReference,
          auditIdentity: input.auditIdentity,
        },
      });
      await this.writeAudit(tx, audit);
      return this.approval(approval);
    });
  }

  async revokeApproval(input: Parameters<CommandRepository['revokeApproval']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const approval = await tx.sofiaCommandApproval.findUniqueOrThrow({ where: { id: input.approvalId } });
      const changed = await tx.sofiaCommandApproval.updateMany({
        where: { id: approval.id, status: 'APPROVED', version: approval.version },
        data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } },
      });
      this.assertChanged(changed.count);
      await tx.sofiaCommand.updateMany({
        where: { id: approval.commandId, status: 'APPROVED' },
        data: { status: 'REJECTED', completedAt: new Date(), failureClass: 'POLICY', failureCode: 'SOFIA_COMMAND_APPROVAL_INVALID', version: { increment: 1 } },
      });
      await this.writeAudit(tx, input.audit);
      return this.approval(await tx.sofiaCommandApproval.findUniqueOrThrow({ where: { id: approval.id } }));
    });
  }

  async claim(input: Parameters<CommandRepository['claim']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.sofiaCommand.updateMany({
        where: {
          id: input.commandId,
          version: input.expectedVersion,
          OR: [{ status: 'APPROVED' }, { status: 'FAILED', retryable: true }],
        },
        data: {
          status: 'CLAIMED',
          claimOwnerHash: input.claimOwnerHash,
          claimedAt: new Date(),
          leaseExpiresAt: input.leaseExpiresAt,
          failureClass: null,
          failureCode: null,
          retryable: false,
          version: { increment: 1 },
        },
      });
      this.assertChanged(changed.count, 'SOFIA_COMMAND_ALREADY_RUNNING');
      const attemptNumber = (await tx.sofiaCommandAttempt.count({ where: { commandId: input.commandId } })) + 1;
      const attempt = await tx.sofiaCommandAttempt.create({
        data: {
          commandId: input.commandId,
          approvalId: input.approvalId,
          attemptNumber,
          claimOwnerHash: input.claimOwnerHash,
          leaseExpiresAt: input.leaseExpiresAt,
          releaseVersion: input.releaseVersion,
        },
      });
      await this.writeAudit(tx, input.audit);
      const command = await tx.sofiaCommand.findUniqueOrThrow({ where: { id: input.commandId }, include: { result: true } });
      return { command: this.command(command), attempt: this.attempt(attempt) };
    });
  }

  async markExecuting(input: Parameters<CommandRepository['markExecuting']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.sofiaCommand.updateMany({
        where: { id: input.commandId, version: input.expectedVersion, status: 'CLAIMED' },
        data: { status: 'EXECUTING', version: { increment: 1 } },
      });
      this.assertChanged(changed.count);
      await this.writeAudit(tx, input.audit);
      return this.command(await tx.sofiaCommand.findUniqueOrThrow({ where: { id: input.commandId }, include: { result: true } }));
    });
  }

  async succeed(input: Parameters<CommandRepository['succeed']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.sofiaCommand.updateMany({
        where: { id: input.commandId, version: input.expectedVersion, status: 'EXECUTING' },
        data: { status: 'SUCCEEDED', completedAt: new Date(), leaseExpiresAt: null, retryable: false, version: { increment: 1 } },
      });
      this.assertChanged(changed.count);
      const result = await tx.sofiaCommandResult.create({
        data: {
          commandId: input.commandId,
          resultCode: input.resultCode,
          sanitizedPayload: input.sanitizedPayload as Prisma.InputJsonValue,
          resultHash: input.resultHash,
          domainReferenceIds: input.domainReferenceIds as Prisma.InputJsonValue,
          retentionUntil: input.retentionUntil,
        },
      });
      await tx.sofiaCommandAttempt.update({
        where: { id: input.attemptId },
        data: { outcome: 'SUCCEEDED', finishedAt: new Date() },
      });
      await this.writeAudit(tx, input.audit);
      const command = await tx.sofiaCommand.findUniqueOrThrow({ where: { id: input.commandId }, include: { result: true } });
      return { command: this.command(command), result: this.result(result) };
    });
  }

  async fail(input: Parameters<CommandRepository['fail']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.sofiaCommand.updateMany({
        where: { id: input.commandId, version: input.expectedVersion, status: { in: ['CLAIMED', 'EXECUTING'] } },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          leaseExpiresAt: null,
          failureClass: input.failureClass,
          failureCode: input.failureCode,
          retryable: input.retryable,
          version: { increment: 1 },
        },
      });
      this.assertChanged(changed.count);
      await tx.sofiaCommandAttempt.update({
        where: { id: input.attemptId },
        data: {
          outcome: 'FAILED',
          finishedAt: new Date(),
          failureClass: input.failureClass,
          retryable: input.retryable,
          errorCode: input.failureCode,
        },
      });
      await this.writeAudit(tx, input.audit);
      return this.command(await tx.sofiaCommand.findUniqueOrThrow({ where: { id: input.commandId }, include: { result: true } }));
    });
  }

  async recoverExpiredLease(input: Parameters<CommandRepository['recoverExpiredLease']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.sofiaCommand.findUniqueOrThrow({ where: { id: input.commandId } });
      const expectedStatus = input.unknownResult ? 'EXECUTING' : 'CLAIMED';
      const changed = await tx.sofiaCommand.updateMany({
        where: {
          id: input.commandId,
          version: input.expectedVersion,
          status: expectedStatus,
          leaseExpiresAt: { lte: new Date() },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          leaseExpiresAt: null,
          failureClass: input.unknownResult ? 'UNKNOWN_RESULT' : 'TIMEOUT',
          failureCode: input.unknownResult ? 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE' : 'SOFIA_COMMAND_EXPIRED',
          retryable: !input.unknownResult,
          version: { increment: 1 },
        },
      });
      this.assertChanged(changed.count, 'SOFIA_COMMAND_ALREADY_RUNNING');
      const attempt = await tx.sofiaCommandAttempt.findFirst({
        where: { commandId: command.id, outcome: 'CLAIMED' },
        orderBy: { attemptNumber: 'desc' },
      });
      if (attempt) {
        await tx.sofiaCommandAttempt.update({
          where: { id: attempt.id },
          data: {
            outcome: input.unknownResult ? 'FAILED' : 'EXPIRED',
            finishedAt: new Date(),
            failureClass: input.unknownResult ? 'UNKNOWN_RESULT' : 'TIMEOUT',
            retryable: !input.unknownResult,
            errorCode: input.unknownResult ? 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE' : 'SOFIA_COMMAND_EXPIRED',
          },
        });
      }
      await this.writeAudit(tx, input.audit);
      return this.command(await tx.sofiaCommand.findUniqueOrThrow({ where: { id: input.commandId }, include: { result: true } }));
    });
  }

  private key(input: Pick<NewCommandRecord, 'scope' | 'commandType' | 'idempotencyKey'>) {
    return { scope: input.scope, commandType: input.commandType, idempotencyKey: input.idempotencyKey };
  }

  private async writeAudit(tx: Prisma.TransactionClient, evidence: CommandAuditEvidence) {
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
    }, tx);
  }

  private assertChanged(count: number, code: 'SOFIA_COMMAND_ALREADY_RUNNING' | 'SOFIA_COMMAND_IDEMPOTENCY_CONFLICT' = 'SOFIA_COMMAND_IDEMPOTENCY_CONFLICT') {
    if (count !== 1) throw new SecureCommandError(code);
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private command(record: CommandWithResult): CommandRecord {
    return {
      id: record.id,
      commandType: record.commandType,
      scope: record.scope,
      idempotencyKey: record.idempotencyKey,
      status: record.status,
      actorId: record.actorId,
      actorType: record.actorType,
      actorRoles: this.stringArray(record.actorRolesSnapshot),
      source: record.source,
      targetType: record.targetType,
      targetId: record.targetId,
      expectedVersion: record.expectedVersion,
      payloadHash: record.payloadHash,
      policyHash: record.policyHash,
      releaseVersion: record.releaseVersion,
      correlationId: record.correlationId,
      traceId: record.traceId,
      claimOwnerHash: record.claimOwnerHash,
      leaseExpiresAt: record.leaseExpiresAt,
      expiresAt: record.expiresAt,
      claimedAt: record.claimedAt,
      completedAt: record.completedAt,
      failureClass: record.failureClass,
      failureCode: record.failureCode,
      retryable: record.retryable,
      version: record.version,
      result: record.result ? this.result(record.result) : null,
    };
  }

  private approval(record: PrismaApproval): CommandApprovalRecord {
    return {
      id: record.id,
      commandId: record.commandId,
      approverActorId: record.approverActorId,
      approverRoles: this.stringArray(record.approverRolesSnapshot),
      status: record.status,
      payloadHash: record.payloadHash,
      expectedVersion: record.expectedVersion,
      targetType: record.targetType,
      targetId: record.targetId,
      source: record.source,
      grantedAt: record.grantedAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      reasonCode: record.reasonCode,
      policyReference: record.policyReference,
      auditIdentity: record.auditIdentity,
    };
  }

  private attempt(record: PrismaAttempt): CommandAttemptRecord {
    return {
      id: record.id,
      commandId: record.commandId,
      approvalId: record.approvalId,
      attemptNumber: record.attemptNumber,
      leaseExpiresAt: record.leaseExpiresAt,
      outcome: record.outcome,
    };
  }

  private result(record: PrismaResult): CommandResultRecord {
    return {
      id: record.id,
      commandId: record.commandId,
      resultCode: record.resultCode,
      sanitizedPayload: record.sanitizedPayload,
      resultHash: record.resultHash,
      domainReferenceIds: this.stringArray(record.domainReferenceIds),
      completedAt: record.completedAt,
      redactionVersion: record.redactionVersion,
    };
  }

  private stringArray(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  }
}
