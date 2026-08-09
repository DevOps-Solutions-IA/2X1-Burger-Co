import { resolveAuthThrottleLimits } from './auth.controller';

describe('AuthController throttle safety', () => {
  it('uses relaxed limits only when NODE_ENV is exactly test', () => {
    expect(resolveAuthThrottleLimits('test')).toEqual({ login: 500, accessCode: 500 });
    expect(resolveAuthThrottleLimits('production')).toEqual({ login: 5, accessCode: 10 });
    expect(resolveAuthThrottleLimits('development')).toEqual({ login: 5, accessCode: 10 });
    expect(resolveAuthThrottleLimits(undefined)).toEqual({ login: 5, accessCode: 10 });
  });

  it('does not infer test mode from accidental harness variables', () => {
    const previousTestDatabaseUrl = process.env.TEST_DATABASE_URL;
    const previousJestWorkerId = process.env.JEST_WORKER_ID;

    process.env.TEST_DATABASE_URL = 'postgresql://localhost/test';
    process.env.JEST_WORKER_ID = '1';

    try {
      expect(resolveAuthThrottleLimits('production')).toEqual({ login: 5, accessCode: 10 });
    } finally {
      if (previousTestDatabaseUrl === undefined) delete process.env.TEST_DATABASE_URL;
      else process.env.TEST_DATABASE_URL = previousTestDatabaseUrl;
      if (previousJestWorkerId === undefined) delete process.env.JEST_WORKER_ID;
      else process.env.JEST_WORKER_ID = previousJestWorkerId;
    }
  });
});
