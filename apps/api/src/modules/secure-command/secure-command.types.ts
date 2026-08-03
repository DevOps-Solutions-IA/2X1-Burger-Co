export const COMMAND_TYPES = [
  'SOFIA_INTERNAL_VALIDATE',
  'SOFIA_CREATE_ORDER',
  'SOFIA_SEND_WHATSAPP',
  'SOFIA_MARK_PAYMENT',
  'SOFIA_DEDUCT_STOCK',
  'SOFIA_MUTATE_CASH',
  'SOFIA_CREATE_SALE',
  'SOFIA_ASSIGN_DELIVERY',
  'SOFIA_CUSTOMER_AUTO_RESPONSE',
] as const;

export type SecureCommandType = (typeof COMMAND_TYPES)[number];

export const COMMAND_STATUSES = [
  'RECEIVED',
  'VALIDATED',
  'APPROVAL_REQUIRED',
  'APPROVED',
  'CLAIMED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
  'EXPIRED',
] as const;

export type SecureCommandStatus = (typeof COMMAND_STATUSES)[number];
export type CommandFailureClass =
  | 'VALIDATION'
  | 'POLICY'
  | 'CONFLICT'
  | 'DEPENDENCY'
  | 'TIMEOUT'
  | 'UNKNOWN_RESULT'
  | 'INTERNAL';

export type CommandActor = {
  actorId: string;
  actorType: 'USER' | 'SYSTEM';
  roles: string[];
};

export type CommandTarget = {
  type: string;
  id: string | null;
  expectedVersion: string | null;
};

export type CommandExecutionContextValue = {
  actor: CommandActor;
  source: string;
  scope: string;
  releaseVersion: string;
  requestId: string | null;
  correlationId: string | null;
  traceId: string | null;
};

export type ReceiveCommandInput = {
  commandType: SecureCommandType;
  idempotencyKey: string;
  target: CommandTarget;
  payload: unknown;
  expiresAt: Date;
  context: CommandExecutionContextValue;
};

export type CommandRecord = {
  id: string;
  commandType: string;
  scope: string;
  idempotencyKey: string;
  status: SecureCommandStatus;
  actorId: string;
  actorType: string;
  actorRoles: string[];
  source: string;
  targetType: string;
  targetId: string | null;
  expectedVersion: string | null;
  payloadHash: string;
  policyHash: string;
  releaseVersion: string;
  correlationId: string | null;
  traceId: string | null;
  claimOwnerHash: string | null;
  leaseExpiresAt: Date | null;
  expiresAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  failureClass: CommandFailureClass | null;
  failureCode: string | null;
  retryable: boolean;
  version: number;
  result: CommandResultRecord | null;
};

export type CommandApprovalRecord = {
  id: string;
  commandId: string;
  approverActorId: string;
  approverRoles: string[];
  status: 'APPROVED' | 'REVOKED' | 'EXPIRED';
  payloadHash: string;
  expectedVersion: string | null;
  targetType: string;
  targetId: string | null;
  source: string;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  reasonCode: string;
  policyReference: string;
  auditIdentity: string;
};

export type CommandAttemptRecord = {
  id: string;
  commandId: string;
  approvalId: string | null;
  attemptNumber: number;
  leaseExpiresAt: Date;
  outcome: 'CLAIMED' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
};

export type CommandResultRecord = {
  id: string;
  commandId: string;
  resultCode: string;
  sanitizedPayload: unknown;
  resultHash: string;
  domainReferenceIds: string[];
  completedAt: Date;
  redactionVersion: number;
};

export type CommandView = {
  command: CommandRecord;
  replayed: boolean;
};

export type CommandHandlerResult = {
  resultCode: string;
  payload: unknown;
  domainReferenceIds?: string[];
};

export type ActorAuthorization = {
  active: boolean;
  roles: string[];
  permissions: string[];
};

export type CommandPolicyStage = 'RECEIVE' | 'BEFORE_APPROVAL' | 'BEFORE_CLAIM' | 'BEFORE_HANDLER';

export type CommandPolicyDefinition = {
  commandType: SecureCommandType;
  enabled: boolean;
  operational: boolean;
  approvalRequired: boolean;
  allowedSources: readonly string[];
  allowedRoles: readonly string[];
  requiredPermission: string;
};

export type CommandAuditEvidence = {
  actorId: string;
  actorRole: string | null;
  action: string;
  entityId: string | null;
  result: 'SUCCESS' | 'REJECTED' | 'FAILED' | 'CONFLICT' | 'BLOCKED' | 'NO_OP';
  reasonCode: string;
  source: string;
  correlationId: string | null;
  traceId: string | null;
  idempotencyKey: string;
  releaseVersion: string;
  metadata?: Record<string, unknown>;
};
