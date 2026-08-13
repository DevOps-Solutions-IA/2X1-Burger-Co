import type { AuthUser } from '../../common/types/auth-user.type';
import { CustomerServiceController } from './customer-service.controller';
import type { CustomerServiceCaseReadService } from './customer-service-case-read.service';
import type { CustomerServiceCaseService } from './customer-service-case.service';

describe('CustomerServiceController transition replay boundary', () => {
  const actor: AuthUser = {
    sub: 'supervisor-1',
    email: 'supervisor@example.test',
    fullName: 'Supervisor',
    sessionVersion: 1,
    roles: ['supervisor'],
    permissions: [],
  };

  it('forwards the caller-bound source state without a race-prone status reread', async () => {
    const transition = jest.fn().mockResolvedValue({ state: 'DETERMINISTIC_REPLAY' });
    const reads = { current: jest.fn() } as unknown as CustomerServiceCaseReadService;
    const controller = new CustomerServiceController(
      { transition } as unknown as CustomerServiceCaseService,
      reads,
    );
    const dto = {
      expectedVersion: 0,
      fromStatus: 'OPEN' as const,
      toStatus: 'HUMAN_REQUIRED' as const,
      idempotencyKey: 'phase8-ui:case-1:0:OPEN:HUMAN_REQUIRED:REVIEW',
      reasonCode: 'REVIEW',
    };

    await expect(controller.transition('case-1', dto, actor)).resolves.toEqual({
      state: 'DETERMINISTIC_REPLAY',
    });
    expect(reads.current).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-1',
      expectedVersion: 0,
      fromStatus: 'OPEN',
      toStatus: 'HUMAN_REQUIRED',
      actorId: 'supervisor-1',
      idempotencyKey: dto.idempotencyKey,
    }));
  });
});
