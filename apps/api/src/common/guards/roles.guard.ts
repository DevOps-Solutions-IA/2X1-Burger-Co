import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthUser } from '../types/auth-user.type';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditContextService } from '../../modules/audit/audit-context.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly auditContext: AuditContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user) {
      throw new UnauthorizedException('Debes iniciar sesión para continuar.');
    }
    this.auditContext.setActor(request.user);
    const userRoles = request.user?.roles ?? [];
    const userPermissions = request.user?.permissions ?? [];
    const allowed = requiredRoles.some(
      (role) => userRoles.includes(role) || userPermissions.includes(role),
    );

    if (!allowed) {
      await this.auditService.log({
        userId: request.user.sub,
        action: 'RBAC_DENIED',
        module: 'security',
        entity: 'route_access',
        entityId: `${context.getClass().name}.${context.getHandler().name}`,
        result: 'REJECTED',
        reasonCode: 'RBAC_DENIED',
        metadata: {
          requiredRoles,
          effectiveRoles: userRoles,
          permissionCount: userPermissions.length,
        },
      });
      throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }

    return true;
  }
}
