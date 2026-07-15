import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuditContextService } from '../../modules/audit/audit-context.service';
import { AuditService } from '../../modules/audit/audit.service';
import type { AuthUser } from '../types/auth-user.type';
import { RolesGuard } from './roles.guard';

describe('RolesGuard persistent audit context', () => {
  const auditCreate = jest.fn(async ({ data }) => ({ id: 'audit-rbac', createdAt: new Date(), ...data }));
  const prisma = { auditLog: { create: auditCreate } } as unknown as PrismaService;
  const auditContext = new AuditContextService();
  const auditService = new AuditService(prisma, auditContext);
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new RolesGuard(reflector, auditService, auditContext);

  beforeEach(() => {
    jest.clearAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
  });

  function principal(role: string | null): AuthUser {
    return {
      sub: `actor-${role ?? 'none'}`,
      email: `${role ?? 'none'}@invalid.local`,
      fullName: role ?? 'No role',
      sessionVersion: 1,
      roles: role ? [role] : [],
      permissions: [],
    };
  }

  function execution(user: AuthUser, forgedRole?: string): ExecutionContext {
    class SyntheticController {}
    function protectedAction() {}
    return {
      getHandler: () => protectedAction,
      getClass: () => SyntheticController,
      switchToHttp: () => ({
        getRequest: () => ({ user, headers: { 'x-actor-role': forgedRole } }),
      }),
    } as unknown as ExecutionContext;
  }

  async function denied(role: string | null, requestId: string, forgedRole?: string) {
    return auditContext.run(auditContext.createHttpContext({
      requestId,
      correlationId: `correlation-${requestId}`,
      traceId: '0123456789abcdef0123456789abcdef',
      idempotencyKey: `idem-${requestId}`,
    }), async () => {
      await expect(guard.canActivate(execution(principal(role), forgedRole))).rejects.toBeInstanceOf(ForbiddenException);
      return auditCreate.mock.calls.at(-1)?.[0].data;
    });
  }

  it('allows an authenticated admin without writing a denied event', async () => {
    const allowed = await auditContext.run(
      auditContext.createHttpContext({ requestId: 'allowed-admin' }),
      () => guard.canActivate(execution(principal('admin'))),
    );
    expect(allowed).toBe(true);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['cashier', 'cashier'],
    ['waiter', 'waiter'],
    [null, 'no_role'],
  ])('persists trusted actorRole for denied principal %s', async (role, expectedRole) => {
    const data = await denied(role, `denied-${expectedRole}`);
    expect(data).toMatchObject({
      eventVersion: 2,
      actorId: `actor-${role ?? 'none'}`,
      actorRole: expectedRole,
      requestId: `denied-${expectedRole}`,
      correlationId: `correlation-denied-${expectedRole}`,
      traceId: '0123456789abcdef0123456789abcdef',
      idempotencyKey: `idem-denied-${expectedRole}`,
      result: 'REJECTED',
      reasonCode: 'RBAC_DENIED',
    });
  });

  it('does not allow a client header to forge the actor role', async () => {
    const data = await denied('cashier', 'header-spoof', 'admin');
    expect(data.actorRole).toBe('cashier');
    expect(JSON.stringify(data)).not.toContain('x-actor-role');
  });

  it('isolates two simultaneous denied requests with different roles', async () => {
    await Promise.all([
      denied('cashier', 'concurrent-cashier'),
      denied('waiter', 'concurrent-waiter'),
    ]);
    const events = auditCreate.mock.calls.map((call) => call[0].data);
    const cashier = events.find((event) => event.requestId === 'concurrent-cashier');
    const waiter = events.find((event) => event.requestId === 'concurrent-waiter');
    expect(cashier).toMatchObject({ actorRole: 'cashier', requestId: 'concurrent-cashier' });
    expect(waiter).toMatchObject({ actorRole: 'waiter', requestId: 'concurrent-waiter' });
  });
});
