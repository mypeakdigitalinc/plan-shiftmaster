/** Pure date/time helpers for scheduling UIs (no timezone math: inputs are local dates/times). */
import type { AvailabilitySlot } from './index';

const DAY_MS = 86_400_000;

/** "2026-11-05" + n days → "YYYY-MM-DD" (calendar math, DST-proof). */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Today's local date in a timezone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Length in hours of a local start/end (end <= start = overnight). */
export function durationHours(startTime: string, endTime: string): number {
  let d = toMinutes(endTime) - toMinutes(startTime);
  if (d <= 0) d += 24 * 60;
  return d / 60;
}

/**
 * Availability slots (times someone can NOT work) that overlap a shift on `date`
 * from startTime to endTime. Overnight shifts are checked against the next day too.
 */
export function availabilityConflicts(
  slots: AvailabilitySlot[],
  date: string,
  startTime: string,
  endTime: string,
): AvailabilitySlot[] {
  const start = toMinutes(startTime);
  let end = toMinutes(endTime);
  if (end <= start) end += 24 * 60;
  const day = weekday(date);
  const next = (day + 1) % 7;

  return slots.filter((s) => {
    const sStart = toMinutes(s.startTime);
    const sEnd = toMinutes(s.endTime);
    const hit = (offset: number) => sStart + offset < end && start < sEnd + offset;
    return (s.weekday === day && hit(0)) || (s.weekday === next && end > 24 * 60 && hit(24 * 60));
  });
}

/** True if two [start, end) ISO timestamp ranges overlap. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Offset (ms) of `timeZone` from UTC at instant `utcMs`. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Local date + "HH:MM" in a timezone → ISO UTC timestamp (handles DST). */
export function localToUtc(date: string, time: string, timeZone: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`);
  let utc = naive - tzOffsetMs(naive, timeZone);
  utc = naive - tzOffsetMs(utc, timeZone); // second pass settles DST edges
  return new Date(utc).toISOString();
}

/** Local shift (end <= start = next day) → UTC [startsAt, endsAt]. */
export function localShiftRange(date: string, startTime: string, endTime: string, timeZone: string) {
  const endDate = toMinutes(endTime) <= toMinutes(startTime) ? addDays(date, 1) : date;
  return { startsAt: localToUtc(date, startTime, timeZone), endsAt: localToUtc(endDate, endTime, timeZone) };
}
