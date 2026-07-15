import type { Prisma } from '@prisma/client';

export const AUDIT_EVENT_VERSION = 2;

export const AUDIT_RESULTS = [
  'SUCCESS',
  'REJECTED',
  'FAILED',
  'CONFLICT',
  'BLOCKED',
  'NO_OP',
  'ROLLED_BACK',
] as const;

export type AuditResult = (typeof AUDIT_RESULTS)[number];
export type AuditActorType = 'USER' | 'SYSTEM' | 'PROVIDER';

export interface AuditRequestContext {
  requestId: string | null;
  correlationId: string | null;
  traceId: string | null;
  idempotencyKey: string | null;
  actorId: string | null;
  actorRole: string | null;
  actorRoles: string[];
  source: string;
  environment: string;
  releaseVersion: string;
}

export interface AuditInput {
  userId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType;
  actorRole?: string | null;
  action: string;
  module: string;
  entity: string;
  entityType?: string;
  entityId?: string | null;
  result?: AuditResult;
  reasonCode?: string | null;
  reasonText?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  traceId?: string | null;
  idempotencyKey?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  source?: string;
  environment?: string;
  releaseVersion?: string;
  ipAddress?: string;
  userAgent?: string;
}

export type AuditDatabaseClient = Pick<Prisma.TransactionClient, 'auditLog'>;

export interface AuditPage<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
