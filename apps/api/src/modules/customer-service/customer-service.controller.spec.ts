import { CustomerServiceController } from './customer-service.controller';

describe('CustomerServiceController', () => {
  it('binds a versioned transition to canonical current state and authenticated actor', async () => {
    const reads = {
      current: jest.fn().mockResolvedValue({ id: 'case-1', status: 'HUMAN_REQUIRED', version: 3 }),
    };
    const cases = { transition: jest.fn().mockResolvedValue({ state: 'UPDATED' }) };
    const controller = new CustomerServiceController(cases as never, reads as never);

    await controller.transition('case-1', {
      expectedVersion: 3,
      toStatus: 'HUMAN_TAKEN',
      idempotencyKey: 'case:take:1',
      reasonCode: 'OPERATOR_ACCEPTED_CASE',
    }, {
      sub: 'operator-1',
      email: 'operator@example.test',
      fullName: 'Operador',
      sessionVersion: 1,
      roles: ['supervisor'],
      permissions: [],
    });

    expect(cases.transition).toHaveBeenCalledWith({
      caseId: 'case-1',
      expectedVersion: 3,
      idempotencyKey: 'case:take:1',
      fromStatus: 'HUMAN_REQUIRED',
      toStatus: 'HUMAN_TAKEN',
      reasonCode: 'OPERATOR_ACCEPTED_CASE',
      actorId: 'operator-1',
      resolutionCode: undefined,
      metadata: undefined,
    });
  });
});
