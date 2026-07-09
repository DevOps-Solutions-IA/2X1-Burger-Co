import { Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Http');

  use(request: Request, response: Response, next: NextFunction) {
    const startedAt = performance.now();
    const requestId =
      typeof request.headers['x-request-id'] === 'string' && request.headers['x-request-id'].trim()
        ? request.headers['x-request-id']
        : randomUUID();

    response.setHeader('X-Request-Id', requestId);

    response.on('finish', () => {
      if (request.path === '/health') {
        return;
      }

      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const userAgent = request.headers['user-agent'] ?? 'unknown';
      const authenticatedRequest = request as Request & { user?: { sub?: string } };
      const actorId =
        typeof authenticatedRequest.user === 'object' && authenticatedRequest.user && 'sub' in authenticatedRequest.user
          ? String(authenticatedRequest.user.sub)
          : 'anonymous';

      this.logger.log(
        JSON.stringify({
          requestId,
          method: request.method,
          path: request.originalUrl,
          statusCode: response.statusCode,
          durationMs,
          ip: request.ip,
          actorId,
          userAgent,
        }),
      );
    });

    next();
  }
}
