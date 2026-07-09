import type { Request } from 'express';

export function extractRequestMeta(request: Request) {
  return {
    ipAddress:
      request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ??
      request.ip,
    userAgent: request.headers['user-agent'] ?? undefined,
  };
}
