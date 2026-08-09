import { SofiaHardeningService } from './sofia-hardening.service';

describe('SofiaHardeningService', () => {
  it('derives sanitization status from executable checks instead of a static PASS', () => {
    const status = new SofiaHardeningService().status();

    expect(status.logSanitizationStatus).toBe('VERIFIED_EXECUTABLE');
    expect(status.safeLoggerAvailable).toBe(true);
    expect(Object.values(status.checks)).toEqual([true, true, true, true]);
    expect(JSON.stringify(status.sample)).not.toContain('573001112222');
    expect(JSON.stringify(status.sample)).not.toContain('qr-secret');
    expect(JSON.stringify(status.sample)).not.toContain('/home/');
  });
});
