import { AuditContextService } from './audit-context.service';

describe('AuditContextService', () => {
  const service = new AuditContextService();

  it('generates safe request, correlation and trace identifiers', () => {
    const context = service.createHttpContext({
      requestId: 'invalid id with spaces',
      correlationId: 'corr-valid',
      traceId: 'not-a-trace',
      idempotencyKey: 'idem:valid',
    });

    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.correlationId).toBe('corr-valid');
    expect(context.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(context.idempotencyKey).toBe('idem:valid');
  });

  it('isolates concurrent actors and request identifiers', async () => {
    const first = service.createHttpContext({ requestId: 'request-a' });
    const second = service.createHttpContext({ requestId: 'request-b' });

    const [observedFirst, observedSecond] = await Promise.all([
      service.run(first, async () => {
        service.setActor({
          sub: 'actor-a', email: 'a@invalid.local', fullName: 'A', sessionVersion: 1,
          roles: ['cashier'], permissions: [],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        return service.current();
      }),
      service.run(second, async () => {
        service.setActor({
          sub: 'actor-b', email: 'b@invalid.local', fullName: 'B', sessionVersion: 1,
          roles: ['admin'], permissions: [],
        });
        await new Promise((resolve) => setTimeout(resolve, 1));
        return service.current();
      }),
    ]);

    expect(observedFirst).toMatchObject({ requestId: 'request-a', actorId: 'actor-a', actorRole: 'cashier' });
    expect(observedSecond).toMatchObject({ requestId: 'request-b', actorId: 'actor-b', actorRole: 'admin' });
  });

  it('does not allow an authenticated actor or role to be replaced', () => {
    const requestContext = service.createHttpContext({ requestId: 'request-locked' });
    service.run(requestContext, () => {
      service.setActor({
        sub: 'actor-locked', email: 'locked@invalid.local', fullName: 'Locked', sessionVersion: 1,
        roles: ['cashier'], permissions: [],
      });
      expect(() => service.setActor({
        sub: 'actor-attacker', email: 'attacker@invalid.local', fullName: 'Attacker', sessionVersion: 1,
        roles: ['admin'], permissions: [],
      })).toThrow('cannot be replaced');
      expect(service.current()).toMatchObject({ actorId: 'actor-locked', actorRole: 'cashier' });
    });
  });

  it('keeps separate correlations for the same actor and classifies a principal without roles', async () => {
    const user = {
      sub: 'actor-same', email: 'same@invalid.local', fullName: 'Same', sessionVersion: 1,
      roles: [] as string[], permissions: [] as string[],
    };
    const values = await Promise.all(['corr-one', 'corr-two'].map((correlationId) =>
      service.run(service.createHttpContext({ correlationId }), async () => {
        service.setActor(user);
        await Promise.resolve();
        return service.current();
      }),
    ));
    expect(values.map((item) => item?.correlationId)).toEqual(['corr-one', 'corr-two']);
    expect(values.every((item) => item?.actorRole === 'no_role')).toBe(true);
  });

  it('ignores a client-provided source and only accepts controlled source changes', () => {
    const requestContext = service.createHttpContext({ source: 'client-forged-admin' });
    expect(requestContext.source).toBe('http');
    service.run(requestContext, () => {
      service.setSource('internal_gateway');
      expect(service.current()?.source).toBe('internal_gateway');
      expect(() => service.setSource('forged_replacement')).toThrow('cannot be replaced');
    });
  });
});
