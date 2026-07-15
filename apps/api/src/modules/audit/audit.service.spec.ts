import type { PrismaService } from '../../prisma/prisma.service';
import { AuditContextService } from './audit-context.service';
import { AuditService } from './audit.service';

describe('AuditService contract v2', () => {
  const create = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const transaction = jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
  const prisma = {
    auditLog: { create, findMany, count },
    $transaction: transaction,
  } as unknown as PrismaService;
  const context = new AuditContextService();
  const service = new AuditService(prisma, context);

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockImplementation(async ({ data }) => ({ id: 'audit-v2', createdAt: new Date(), ...data }));
  });

  it('persists actor, role, request, correlation, trace and idempotency context', async () => {
    const requestContext = context.createHttpContext({
      requestId: 'request-v2', correlationId: 'correlation-v2',
      traceId: '0123456789abcdef0123456789abcdef', idempotencyKey: 'idem-v2',
    });

    await context.run(requestContext, async () => {
      context.setActor({
        sub: 'user-v2', email: 'audit@invalid.local', fullName: 'Audit User', sessionVersion: 1,
        roles: ['cashier'], permissions: [],
      });
      await service.log({
        action: 'CREATE', module: 'sales', entity: 'sale', entityId: 'sale-v2',
        before: { status: null }, after: { status: 'PAID', total: 20000 },
      });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventVersion: 2,
        actorId: 'user-v2',
        actorRole: 'cashier',
        requestId: 'request-v2',
        correlationId: 'correlation-v2',
        traceId: '0123456789abcdef0123456789abcdef',
        idempotencyKey: 'idem-v2',
        result: 'SUCCESS',
      }),
    });
  });

  it('redacts secrets and masks phone-like values in all snapshots', async () => {
    await service.log({
      action: 'UPDATE', module: 'users', entity: 'user', entityId: 'user-v2',
      after: {
        password: 'must-not-persist',
        apiToken: 'must-not-persist',
        customerPhone: '573001234567',
        profile: { displayName: 'Synthetic User' },
      },
    });

    const data = create.mock.calls[0][0].data;
    expect(data.after).toEqual({
      password: '[REDACTED]',
      apiToken: '[REDACTED]',
      customerPhone: '***4567',
      profile: { displayName: 'Synthetic User' },
    });
    expect(JSON.stringify(data)).not.toContain('must-not-persist');
    expect(JSON.stringify(data)).not.toContain('573001234567');
  });

  it('preserves an absent phone as null instead of implying a hidden value', async () => {
    await service.log({
      action: 'SEND_SKIPPED',
      module: 'whatsapp',
      entity: 'receipt',
      after: { phoneMasked: null, failureReason: 'CUSTOMER_PHONE_MISSING' },
    });

    expect(create.mock.calls[0][0].data.after).toEqual({
      phoneMasked: null,
      failureReason: 'CUSTOMER_PHONE_MISSING',
    });
  });

  it('fails closed when the transactional audit insert fails', async () => {
    const transactionalCreate = jest.fn().mockRejectedValue(new Error('audit unavailable'));
    await expect(service.log(
      { action: 'CLOSE', module: 'cash-register', entity: 'cash_session' },
      { auditLog: { create: transactionalCreate } } as never,
    )).rejects.toThrow('audit unavailable');
  });

  it('reads legacy events without inventing missing context', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z');
    findMany.mockResolvedValue([{
      id: 'legacy-audit', userId: null, eventVersion: 1, timestamp: createdAt,
      actorId: null, actorType: 'SYSTEM', actorRole: null, action: 'LEGACY_EVENT',
      module: 'legacy', entity: 'legacy_entity', entityType: null, entityId: null,
      result: 'SUCCESS', reasonCode: null, reasonText: null, requestId: null,
      correlationId: null, traceId: null, idempotencyKey: null,
      oldValues: null, newValues: { legacy: true }, before: null, after: null,
      metadata: null, source: 'legacy', environment: null, releaseVersion: null,
      ipAddress: null, userAgent: null, createdAt,
    }]);
    count.mockResolvedValue(1);

    const page = await service.list({ page: 1, limit: 10 });

    expect(page.data[0]).toMatchObject({
      id: 'legacy-audit', eventVersion: 1, legacy: true, contextAvailable: false,
      actorRole: null, requestId: null, correlationId: null,
    });
  });
});
