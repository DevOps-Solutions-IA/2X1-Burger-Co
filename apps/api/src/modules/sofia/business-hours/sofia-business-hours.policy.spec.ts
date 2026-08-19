import {
  SOFIA_BUSINESS_CLOSE_HOUR,
  SOFIA_BUSINESS_OPEN_HOUR,
  isWithinSofiaBusinessHours,
} from './sofia-business-hours.policy';

// SOFIA operates 5:00 p.m. (17:00) to 12:00 a.m. (24:00 / 00:00 next day) in
// America/Bogota, which is a fixed UTC-5 offset (no DST). These fixtures are
// expressed as explicit UTC instants so the assertions prove the policy
// actually converts to Bogota local time rather than reading server-local
// time.
describe('sofia-business-hours.policy', () => {
  it('exposes the canonical schedule constants used to gate SOFIA operations', () => {
    expect(SOFIA_BUSINESS_OPEN_HOUR).toBe(17);
    expect(SOFIA_BUSINESS_CLOSE_HOUR).toBe(24);
  });

  it('is closed one minute before the exact opening boundary (16:59 Bogota)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-15T21:59:00.000Z')).toBe(false);
  });

  it('is open at the exact opening boundary (17:00:00.000 Bogota)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-15T22:00:00.000Z')).toBe(true);
  });

  it('is open one minute before the exact closing boundary (23:59 Bogota)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-16T04:59:00.000Z')).toBe(true);
  });

  it('is open at the last instant before closing (23:59:59.999 Bogota)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-16T04:59:59.999Z')).toBe(true);
  });

  it('is closed at the exact closing boundary (00:00:00.000 Bogota, next day)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-16T05:00:00.000Z')).toBe(false);
  });

  it('is closed one minute after the exact closing boundary (00:01 Bogota)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-16T05:01:00.000Z')).toBe(false);
  });

  it('is closed well before opening (10:00 Bogota)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-15T15:00:00.000Z')).toBe(false);
  });

  it('is open mid-window (20:00 Bogota)', () => {
    expect(isWithinSofiaBusinessHours('2026-08-16T01:00:00.000Z')).toBe(true);
  });

  it('applies the America/Bogota (UTC-5) offset rather than raw UTC or server-local hour', () => {
    // 21:30 UTC is 16:30 Bogota -> closed even though the raw UTC hour (21)
    // sits inside the 17-24 numeric window.
    expect(isWithinSofiaBusinessHours('2026-08-15T21:30:00.000Z')).toBe(false);
    // 23:30 UTC is 18:30 Bogota -> open.
    expect(isWithinSofiaBusinessHours('2026-08-15T23:30:00.000Z')).toBe(true);
  });

  it('defaults to the current instant when no input is supplied', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-08-15T23:30:00.000Z')); // 18:30 Bogota
      expect(isWithinSofiaBusinessHours()).toBe(true);
      jest.setSystemTime(new Date('2026-08-15T15:00:00.000Z')); // 10:00 Bogota
      expect(isWithinSofiaBusinessHours()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('accepts a Date instance as well as an ISO string', () => {
    expect(isWithinSofiaBusinessHours(new Date('2026-08-15T22:00:00.000Z'))).toBe(true);
    expect(isWithinSofiaBusinessHours(new Date('2026-08-15T21:59:00.000Z'))).toBe(false);
  });
});
