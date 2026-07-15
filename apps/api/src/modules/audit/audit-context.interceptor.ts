import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { Request } from 'express';
import type { AuthUser } from '../../common/types/auth-user.type';
import { AuditContextService } from './audit-context.service';

@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(private readonly context: AuditContextService) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (executionContext.getType() === 'http') {
      const request = executionContext.switchToHttp().getRequest<Request & { user?: AuthUser }>();
      this.context.setActor(request.user);
    }
    return next.handle();
  }
}
