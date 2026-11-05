import type { Shift } from '@shifthub/shared';
import { WEEKDAY_SHORT, weekday } from '@shifthub/shared';

export const fmtShiftDate = (date: string) =>
  `${WEEKDAY_SHORT[weekday(date)]} ${new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })}`;

/** One-line description of a shift: "Thu Nov 12 · 07:00–15:00 · Birch Unit · Charge Nurse". */
export function ShiftSummary({
  shift,
  areaName,
  positionName,
}: {
  shift: Shift | null;
  areaName?: string;
  positionName?: string;
}) {
  if (!shift) return <span className="text-slate-400">Shift no longer visible</span>;
  return (
    <span>
      <span className="font-medium text-slate-900">{fmtShiftDate(shift.date)}</span>
      <span className="text-slate-600">
        {' '}
        · {shift.startTime}–{shift.endTime}
        {areaName && ` · ${areaName}`}
        {positionName && ` · ${positionName}`}
      </span>
    </span>
  );
}
