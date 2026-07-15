import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { AuditRequestContext } from './audit.types';

const ROLE_PRECEDENCE = ['admin', 'supervisor', 'cashier', 'inventory', 'waiter', 'delivery'] as const;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class AuditContextService {
  private readonly storage = new AsyncLocalStorage<AuditRequestContext>();

  run<T>(context: AuditRequestContext, callback: () => T): T {
    return this.storage.run({ ...context, actorRoles: [...context.actorRoles] }, callback);
  }

  runAsSystem<T>(
    input: Partial<Pick<AuditRequestContext, 'source' | 'correlationId' | 'traceId' | 'idempotencyKey'>>,
    callback: () => T,
  ): T {
    const requestId = randomUUID();
    return this.run(
      {
        requestId,
        correlationId: this.safeIdentifier(input.correlationId) ?? requestId,
        traceId: this.safeTraceId(input.traceId) ?? randomBytes(16).toString('hex'),
        idempotencyKey: this.safeIdentifier(input.idempotencyKey),
        actorId: null,
        actorRole: null,
        actorRoles: [],
        source: this.safeIdentifier(input.source) ?? 'internal',
        environment: this.environment(),
        releaseVersion: this.releaseVersion(),
      },
      callback,
    );
  }

  current(): AuditRequestContext | null {
    return this.storage.getStore() ?? null;
  }

  setActor(user: AuthUser | undefined) {
    const context = this.storage.getStore();
    if (!context || !user) return;
    const actorId = this.safeIdentifier(user.sub);
    if (!actorId) {
      throw new Error('Authenticated audit actor has an invalid identifier.');
    }
    const roles = [...new Set(user.roles.filter((role) => this.safeIdentifier(role)))].sort();
    const actorRole = this.effectiveRole(roles) ?? 'no_role';
    if (context.actorId && context.actorId !== actorId) {
      throw new Error('Authenticated audit actor cannot be replaced within a request.');
    }
    if (context.actorRole && context.actorRole !== actorRole) {
      throw new Error('Authenticated audit role cannot be escalated within a request.');
    }
    context.actorId = actorId;
    context.actorRoles = roles;
    context.actorRole = actorRole;
  }

  setSource(source: string) {
    const context = this.storage.getStore();
    if (!context) return;
    const safeSource = this.safeIdentifier(source);
    if (!safeSource) throw new Error('Audit source is invalid.');
    if (context.source !== 'http' && context.source !== safeSource) {
      throw new Error('Audit source cannot be replaced within a request.');
    }
    context.source = safeSource;
  }

  setIdempotencyKey(value: string | null | undefined) {
    const context = this.storage.getStore();
    if (!context) return;
    const key = this.safeIdentifier(value);
    if (context.idempotencyKey && context.idempotencyKey !== key) {
      throw new Error('Audit idempotency key cannot be replaced within a request.');
    }
    context.idempotencyKey = key;
  }

  createHttpContext(input: {
    requestId?: string | null;
    correlationId?: string | null;
    traceId?: string | null;
    idempotencyKey?: string | null;
    source?: string | null;
  }): AuditRequestContext {
    const requestId = this.safeIdentifier(input.requestId) ?? randomUUID();
    return {
      requestId,
      correlationId: this.safeIdentifier(input.correlationId) ?? requestId,
      traceId: this.safeTraceId(input.traceId) ?? randomBytes(16).toString('hex'),
      idempotencyKey: this.safeIdentifier(input.idempotencyKey),
      actorId: null,
      actorRole: null,
      actorRoles: [],
      source: 'http',
      environment: this.environment(),
      releaseVersion: this.releaseVersion(),
    };
  }

  safeIdentifier(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return SAFE_IDENTIFIER.test(trimmed) ? trimmed : null;
  }

  safeTraceId(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{32}$/.test(normalized) ? normalized : null;
  }

  effectiveRole(roles: string[]): string | null {
    return ROLE_PRECEDENCE.find((role) => roles.includes(role)) ?? [...roles].sort()[0] ?? null;
  }

  private environment() {
    return this.safeIdentifier(process.env.NODE_ENV) ?? 'unknown';
  }

  private releaseVersion() {
    return this.safeIdentifier(process.env.RELEASE_BUILD_ID) ?? 'unversioned';
  }
}
