import { ForbiddenException } from '@nestjs/common';
import { Phase5RuntimeGate } from './phase5-runtime-gate.service';

describe('Phase5RuntimeGate decisions', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('exposes an immutable disabled decision without throwing', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'false';
    const gate = new Phase5RuntimeGate({ findRuntimeSafetySettings: jest.fn().mockResolvedValue([]) } as never);

    const decision = await gate.decision('KITCHEN');

    expect(decision).toEqual({
      enabled: false,
      capability: 'KITCHEN',
      blockers: ['CAPABILITY_DISABLED'],
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.blockers)).toBe(true);
    await expect(gate.assertEnabled('KITCHEN')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an explicitly authorized test capability only when all safety controls agree', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    const gate = new Phase5RuntimeGate({ findRuntimeSafetySettings: jest.fn().mockResolvedValue([]) } as never);

    await expect(gate.decision('KITCHEN')).resolves.toEqual({
      enabled: true,
      capability: 'KITCHEN',
      blockers: [],
    });
  });
});
