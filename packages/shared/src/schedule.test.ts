import { describe, expect, it } from 'vitest';
import {
  addDays,
  availabilityConflicts,
  durationHours,
  localShiftRange,
  localToUtc,
  rangesOverlap,
  todayIn,
  weekDates,
  weekStart,
  weekday,
} from './schedule';

describe('dates', () => {
  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // DST ends in North America
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('finds Monday week starts', () => {
    expect(weekday('2026-11-05')).toBe(4); // Thursday
    expect(weekStart('2026-11-05')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // Sunday belongs to the week before
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekDates('2026-11-02')).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
  });

  it('computes today in a timezone', () => {
    const lateUtc = new Date('2026-11-06T03:00:00Z'); // 22:00 Nov 5 in Toronto
    expect(todayIn('America/Toronto', lateUtc)).toBe('2026-11-05');
    expect(todayIn('UTC', lateUtc)).toBe('2026-11-06');
  });

  it('measures shift length including overnight', () => {
    expect(durationHours('07:00', '15:00')).toBe(8);
    expect(durationHours('23:00', '07:00')).toBe(8);
    expect(durationHours('19:00', '07:00')).toBe(12);
  });
});

describe('availabilityConflicts', () => {
  const wedEvening = { weekday: 3, startTime: '15:00', endTime: '24:00' };
  const sundayAllDay = { weekday: 0, startTime: '00:00', endTime: '24:00' };

  it('flags same-day overlap only', () => {
    // 2026-11-04 is a Wednesday
    expect(availabilityConflicts([wedEvening], '2026-11-04', '15:00', '23:00')).toEqual([wedEvening]);
    expect(availabilityConflicts([wedEvening], '2026-11-04', '07:00', '15:00')).toEqual([]); // ends exactly at 15:00
    expect(availabilityConflicts([wedEvening], '2026-11-05', '15:00', '23:00')).toEqual([]); // Thursday
  });

  it('checks overnight shifts against the next morning', () => {
    // Saturday night 23:00 → Sunday 07:00 collides with Sunday all-day
    expect(availabilityConflicts([sundayAllDay], '2026-11-07', '23:00', '07:00')).toEqual([sundayAllDay]);
    // Saturday day shift does not
    expect(availabilityConflicts([sundayAllDay], '2026-11-07', '07:00', '15:00')).toEqual([]);
  });
});

describe('rangesOverlap', () => {
  it('treats touching ranges as not overlapping', () => {
    expect(rangesOverlap('2026-11-05T07:00Z', '2026-11-05T15:00Z', '2026-11-05T15:00Z', '2026-11-05T23:00Z')).toBe(false);
    expect(rangesOverlap('2026-11-05T07:00Z', '2026-11-05T15:00Z', '2026-11-05T14:00Z', '2026-11-05T23:00Z')).toBe(true);
  });
});

describe('localToUtc', () => {
  it('converts across DST (Toronto)', () => {
    expect(localToUtc('2026-07-01', '07:00', 'America/Toronto')).toBe('2026-07-01T11:00:00.000Z'); // EDT
    expect(localToUtc('2026-12-01', '07:00', 'America/Toronto')).toBe('2026-12-01T12:00:00.000Z'); // EST
  });

  it('builds overnight ranges that span the DST change correctly', () => {
    // Sat 2026-10-31 23:00 EDT → Sun 2026-11-01 07:00 EST = 9 real hours
    const r = localShiftRange('2026-10-31', '23:00', '07:00', 'America/Toronto');
    expect(r.startsAt).toBe('2026-11-01T03:00:00.000Z');
    expect(r.endsAt).toBe('2026-11-01T12:00:00.000Z');
  });
});
