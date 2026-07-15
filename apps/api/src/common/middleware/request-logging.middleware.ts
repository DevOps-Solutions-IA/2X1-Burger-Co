import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AuditContextService } from '../../modules/audit/audit-context.service';
import { ObservabilityService } from '../../modules/health/observability.service';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Http');

  constructor(
    private readonly observability: ObservabilityService,
    private readonly auditContext: AuditContextService,
  ) {}

  use(request: Request, response: Response, next: NextFunction) {
    const startedAt = performance.now();
    const context = this.auditContext.createHttpContext({
      requestId: this.safeHeader(request.headers['x-request-id']),
      correlationId: this.safeHeader(request.headers['x-correlation-id']),
      traceId: this.traceId(request.headers.traceparent),
      idempotencyKey:
        this.safeHeader(request.headers['idempotency-key']) ??
        this.safeHeader(request.headers['x-idempotency-key']),
    });
    const requestId = context.requestId!;
    const correlationId = context.correlationId!;
    const traceId = context.traceId!;
    const spanId = randomBytes(8).toString('hex');

    request.headers['x-request-id'] = requestId;
    request.headers['x-correlation-id'] = correlationId;

    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Correlation-Id', correlationId);
    response.setHeader('X-Trace-Id', traceId);

    response.on('finish', () => {
      if (request.path === '/health/live') {
        return;
      }

      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const authenticatedRequest = request as Request & { user?: { sub?: string } };
      const actorId =
        typeof authenticatedRequest.user === 'object' && authenticatedRequest.user && 'sub' in authenticatedRequest.user
          ? String(authenticatedRequest.user.sub)
          : null;

      this.observability.recordHttp({ durationMs, statusCode: response.statusCode });

      this.logger.log(
        JSON.stringify({
          level: response.statusCode >= 500 ? 'ERROR' : response.statusCode >= 400 ? 'WARN' : 'INFO',
          requestId,
          correlationId,
          traceId,
          spanId,
          module: 'HTTP',
          action: 'HTTP_REQUEST',
          result: response.statusCode >= 500 ? 'ERROR' : response.statusCode >= 400 ? 'REJECTED' : 'SUCCESS',
          method: request.method,
          path: this.safePath(request),
          statusCode: response.statusCode,
          durationMs,
          actorIdHash: actorId ? createHash('sha256').update(actorId).digest('hex').slice(0, 12) : null,
          errorClass: response.statusCode >= 500 ? 'SERVER_ERROR' : response.statusCode >= 400 ? 'CLIENT_ERROR' : null,
        }),
      );
    });

    this.auditContext.run(context, next);
  }

  private safeHeader(value: string | string[] | undefined) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^[A-Za-z0-9._:-]{1,128}$/.test(trimmed) ? trimmed : null;
  }

  private traceId(traceparent: string | string[] | undefined) {
    if (typeof traceparent === 'string') {
      const match = traceparent.match(/^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$/i);
      if (match?.[1]) return match[1].toLowerCase();
    }
    return null;
  }

  private safePath(request: Request) {
    const routePath = (request.route as { path?: string } | undefined)?.path;
    if (routePath) return `${request.baseUrl ?? ''}${routePath}`;
    return request.path.replace(/[A-Za-z0-9_-]{17,}/g, ':id');
  }
}
