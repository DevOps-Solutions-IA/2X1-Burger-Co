import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isObservable, lastValueFrom } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuditService } from '../../modules/audit/audit.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }
    try {
      const result = super.canActivate(context);
      return isObservable(result) ? await lastValueFrom(result) : await result;
    } catch (error) {
      await this.auditService.log({
        actorType: 'SYSTEM',
        actorRole: 'unauthenticated',
        action: 'AUTHENTICATION_DENIED',
        module: 'security',
        entity: 'route_access',
        entityId: `${context.getClass().name}.${context.getHandler().name}`,
        result: 'REJECTED',
        reasonCode: 'AUTHENTICATION_REQUIRED',
        metadata: { authenticated: false },
      });
      throw error;
    }
  }

  override handleRequest<TUser = unknown>(err: unknown, user: TUser | false | null) {
    if (err || !user) {
      throw new UnauthorizedException('Debes iniciar sesión para continuar.');
    }

    return user;
  }
}
