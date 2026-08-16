import type {
  ActorAuthorization,
  CommandApprovalRecord,
  CommandAttemptRecord,
  CommandAuditEvidence,
  CommandFailureClass,
  CommandRecord,
  CommandResultRecord,
  SecureCommandStatus,
} from '../secure-command.types';

export const COMMAND_REPOSITORY = Symbol('CommandRepository');

export type NewCommandRecord = Omit<
  CommandRecord,
  | 'status'
  | 'claimOwnerHash'
  | 'leaseExpiresAt'
  | 'claimedAt'
  | 'completedAt'
  | 'failureClass'
  | 'failureCode'
  | 'retryable'
  | 'version'
  | 'result'
>;

export type NewApprovalRecord = {
  commandId: string;
  approverActorId: string;
  approverRoles: string[];
  payloadHash: string;
  expectedVersion: string | null;
  targetType: string;
  targetId: string | null;
  source: string;
  expiresAt: Date;
  reasonCode: string;
  policyReference: string;
  auditIdentity: string;
};

export type CommandListQuery = {
  status?: SecureCommandStatus;
  commandType?: string;
  page: number;
  limit: number;
};

export type CommandListPage = {
  items: CommandRecord[];
  page: number;
  limit: number;
  total: number;
};

export interface CommandRepository {
  receive(input: NewCommandRecord, audit: CommandAuditEvidence): Promise<{ command: CommandRecord; created: boolean }>;
  find(commandId: string): Promise<CommandRecord | null>;
  list(query: CommandListQuery): Promise<CommandListPage>;
  listApprovals(commandId: string): Promise<CommandApprovalRecord[]>;
  findApproval(approvalId: string): Promise<CommandApprovalRecord | null>;
  findValidApproval(commandId: string, now: Date): Promise<CommandApprovalRecord | null>;
  actorAuthorization(actorId: string): Promise<ActorAuthorization>;
  transition(input: {
    commandId: string;
    expectedVersion: number;
    from: SecureCommandStatus[];
    to: SecureCommandStatus;
    retryable?: boolean;
    failureClass?: CommandFailureClass | null;
    failureCode?: string | null;
    completedAt?: Date | null;
    audit: CommandAuditEvidence;
  }): Promise<CommandRecord>;
  grantApproval(input: NewApprovalRecord, expectedCommandVersion: number, audit: CommandAuditEvidence): Promise<CommandApprovalRecord>;
  revokeApproval(input: { approvalId: string; actorId: string; audit: CommandAuditEvidence }): Promise<CommandApprovalRecord>;
  claim(input: {
    commandId: string;
    expectedVersion: number;
    claimOwnerHash: string;
    leaseExpiresAt: Date;
    releaseVersion: string;
    approvalId: string | null;
    audit: CommandAuditEvidence;
  }): Promise<{ command: CommandRecord; attempt: CommandAttemptRecord }>;
  markExecuting(input: {
    commandId: string;
    attemptId: string;
    expectedVersion: number;
    audit: CommandAuditEvidence;
  }): Promise<CommandRecord>;
  succeed(input: {
    commandId: string;
    attemptId: string;
    expectedVersion: number;
    resultCode: string;
    sanitizedPayload: unknown;
    resultHash: string;
    domainReferenceIds: string[];
    retentionUntil: Date;
    audit: CommandAuditEvidence;
  }): Promise<{ command: CommandRecord; result: CommandResultRecord }>;
  fail(input: {
    commandId: string;
    attemptId: string;
    expectedVersion: number;
    failureClass: CommandFailureClass;
    failureCode: string;
    retryable: boolean;
    audit: CommandAuditEvidence;
  }): Promise<CommandRecord>;
  recoverExpiredLease(input: {
    commandId: string;
    expectedVersion: number;
    unknownResult: boolean;
    audit: CommandAuditEvidence;
  }): Promise<CommandRecord>;
}

export const COMMAND_RUNTIME_SAFETY = Symbol('CommandRuntimeSafety');

export interface CommandRuntimeSafety {
  current(): Promise<{ globalPaused: boolean; killSwitchActive: boolean; productionEnabled: boolean }>;
}
