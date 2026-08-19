/**
 * Canonical SOFIA business-hours authority.
 *
 * This is the single source of truth for the store's open/closed schedule
 * used to gate SOFIA-initiated operational actions. It was extracted
 * unchanged (same timezone, same open/close hour, same comparison) from the
 * pre-existing `SofiaAgentService.isInsideBusinessHours()` private
 * implementation so that both the legacy conversational flow and the
 * commercial checkout flow consume exactly one schedule.
 *
 * Do NOT hardcode a second opening/closing timetable anywhere else in SOFIA
 * -- import from here instead.
 */

export const SOFIA_BUSINESS_HOURS_TIMEZONE = 'America/Bogota';
export const SOFIA_BUSINESS_OPEN_HOUR = 17;
export const SOFIA_BUSINESS_CLOSE_HOUR = 24;
export const SOFIA_BUSINESS_HOURS_SCHEDULE_LABEL = '5:00 p.m. a 12:00 a.m.';

/**
 * Returns true when `nowInput` (or the current instant, when omitted) falls
 * inside SOFIA's operating window in America/Bogota local time.
 *
 * Pure and deterministic given its input: no I/O, no external service call,
 * no hidden state. Safe to call from any SOFIA consumer without introducing
 * a circular dependency.
 */
export function isWithinSofiaBusinessHours(nowInput?: string | Date): boolean {
  const now = nowInput ? new Date(nowInput) : new Date();
  const bogotaHour = new Intl.DateTimeFormat('en-US', {
    timeZone: SOFIA_BUSINESS_HOURS_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hour = Number(bogotaHour);
  return hour >= SOFIA_BUSINESS_OPEN_HOUR && hour < SOFIA_BUSINESS_CLOSE_HOUR;
}
