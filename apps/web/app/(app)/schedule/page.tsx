'use client';

import {
  addDays,
  durationHours,
  todayIn,
  weekDates,
  weekStart,
  WEEKDAY_SHORT,
  weekday,
  type Assignment,
  type AvailabilitySlot,
  type Shift,
  type ShiftTemplate,
} from '@shifthub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ShiftModal, type ShiftDraft } from '@/components/schedule/shift-modal';
import { Badge, Button, cn, EmptyState, ErrorText, Modal, PageHeader, Select, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import {
  keys,
  useApiMutation,
  useAreaAvailability,
  useAreaMembers,
  useLocations,
  useShifts,
  useMarketplace,
  useTemplates,
} from '@/lib/hooks';
import { useSession } from '@/lib/session';

type Row = { key: string; template: ShiftTemplate | null; assignment: Assignment | null };

const fmtDay = (d: string) => `${WEEKDAY_SHORT[weekday(d)]} ${Number(d.slice(8))}`;
const fmtRange = (monday: string) => {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
  const a = new Date(`${monday}T12:00:00Z`).toLocaleDateString(undefined, opts);
  const b = new Date(`${addDays(monday, 6)}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, year: 'numeric' });
  return `${a} – ${b}`;
};
const firstName = (name: string | null) => (name ? name.split(' ').slice(0, 2).join(' ') : '');

function ScheduleView() {
  const { me } = useSession();
  const org = me!.organization!;
  const router = useRouter();
  const params = useSearchParams();
  const today = todayIn(org.timezone);
  const monday = weekStart(params.get('week') ?? today);
  const days = weekDates(monday);

  const locations = useLocations();
  const templates = useTemplates();
  const areas = useMemo(
    () => (locations.data ?? []).flatMap((s) => s.areas.map((a) => ({ ...a, site: s }))),
    [locations.data],
  );
  const areaId = params.get('area') ?? areas[0]?.id;
  const area = areas.find((a) => a.id === areaId);
  const timezone = area?.site.timezone ?? org.timezone;

  // Fetch a day either side so overnight / cross-area overlaps are visible to the editor
  const shifts = useShifts(addDays(monday, -1), addDays(monday, 7));
  const market = useMarketplace();
  const offersByShift = useMemo(() => new Map((market.data ?? []).map((o) => [o.shift.id, o])), [market.data]);
  const members = useAreaMembers(areaId);
  const availability = useAreaAvailability(areaId);

  const [editing, setEditing] = useState<{ shift: Shift | null; draft: ShiftDraft } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    router.replace(`/schedule?${next}`);
  };

  const allShifts = shifts.data ?? [];
  const weekShifts = allShifts.filter((s) => s.date >= monday && s.date <= days[6]!);
  const areaShifts = weekShifts.filter((s) => s.areaId === areaId);
  const drafts = areaShifts.filter((s) => s.status === 'draft');
  const open = areaShifts.filter((s) => !s.employeeId && s.status !== 'cancelled');

  const hoursByEmployee = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of weekShifts) {
      if (!s.employeeId || s.status === 'cancelled') continue;
      m.set(s.employeeId, (m.get(s.employeeId) ?? 0) + durationHours(s.startTime, s.endTime));
    }
    return m;
  }, [weekShifts]);

  const availabilityMap = useMemo(
    () => new Map<string, AvailabilitySlot[]>((availability.data ?? []).map((a) => [a.employeeId, a.slots])),
    [availability.data],
  );

  // Rows: each active template × each position; plus catch-alls for custom times / no position
  const activeTemplates = (templates.data ?? []).filter((t) => t.active);
  const assignments = area?.assignments ?? [];
  const templateFor = (s: Shift) =>
    activeTemplates.find((t) => t.id === s.shiftTemplateId) ??
    activeTemplates.find((t) => t.startTime === s.startTime && t.endTime === s.endTime) ??
    null;
  const rows: Row[] = [];
  for (const t of [...activeTemplates, null]) {
    for (const a of [...assignments, null]) {
      const hasShifts = areaShifts.some((s) => templateFor(s)?.id === t?.id && (s.assignmentId ?? null) === (a?.id ?? null));
      if ((t && a) || hasShifts) rows.push({ key: `${t?.id ?? 'custom'}:${a?.id ?? 'none'}`, template: t, assignment: a });
    }
  }
  const cellShifts = (row: Row, date: string) =>
    areaShifts.filter(
      (s) => s.date === date && templateFor(s)?.id === row.template?.id && (s.assignmentId ?? null) === (row.assignment?.id ?? null),
    );

  const openEditor = (shift: Shift | null, row: Row, date: string) =>
    setEditing({
      shift,
      draft: {
        date,
        areaId: areaId!,
        assignmentId: row.assignment?.id ?? null,
        shiftTemplateId: row.template?.id ?? null,
        startTime: row.template?.startTime ?? '09:00',
        endTime: row.template?.endTime ?? '17:00',
      },
    });

  if (locations.isPending || templates.isPending) return <Spinner />;
  if (!areas.length) {
    return (
      <>
        <PageHeader title="Schedule" />
        <EmptyState title="Add a site and an area first">Schedules are built per area. Go to Locations to set them up.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Schedule"
        description={fmtRange(monday)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setCopyOpen(true)}>
              Copy last week
            </Button>
            <Button disabled={!drafts.length} onClick={() => setPublishOpen(true)}>
              Publish{drafts.length ? ` ${drafts.length}` : ''}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Select value={areaId} onChange={(e) => setParam('area', e.target.value)} aria-label="Area">
            {(locations.data ?? []).map((site) => (
              <optgroup key={site.id} label={site.name}>
                {site.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setParam('week', addDays(monday, -7))}>
            ‹
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setParam('week', today)}>
            Today
          </Button>
          <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setParam('week', addDays(monday, 7))}>
            ›
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          <Badge tone="green">{areaShifts.filter((s) => s.status === 'published').length} published</Badge>
          <Badge tone="amber">{drafts.length} draft</Badge>
          <Badge tone="red">{open.length} open</Badge>
        </div>
      </div>

      <ErrorText error={shifts.error ?? members.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="w-44 px-3 py-2 text-left font-medium">Shift / position</th>
              {days.map((d) => (
                <th key={d} className={cn('px-2 py-2 text-left font-medium', d === today && 'text-brand')}>
                  {fmtDay(d)}
                  {d === today && <span className="ml-1 rounded bg-brand px-1 text-[10px] text-white">today</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const groupStart = i === 0 || rows[i - 1]!.template?.id !== row.template?.id;
              return (
                <tr key={row.key} className={cn(groupStart && i > 0 && 'border-t-2 border-slate-200')}>
                  <th scope="row" className="border-b border-slate-100 px-3 py-1.5 text-left align-top font-normal">
                    {groupStart && (
                      <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.template?.color ?? '#94a3b8' }} />
                        {row.template ? `${row.template.name} ${row.template.startTime}–${row.template.endTime}` : 'Other times'}
                      </p>
                    )}
                    <p className="truncate text-xs text-slate-600">
                      {row.assignment?.name ?? 'No position'}
                      {row.assignment?.requiredPosition && (
                        <span className="ml-1 text-slate-400">{row.assignment.requiredPosition}</span>
                      )}
                    </p>
                  </th>
                  {days.map((d) => {
                    const list = cellShifts(row, d);
                    return (
                      <td key={d} className={cn('border-b border-l border-slate-100 p-1 align-top', d === today && 'bg-brand-light/20')}>
                        <div className="flex flex-col gap-1">
                          {list.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => openEditor(s, row, d)}
                              title={`${s.startTime}–${s.endTime}${s.notes ? ` · ${s.notes}` : ''}${offersByShift.has(s.id) ? ' · on the marketplace' : ''}`}
                              className={cn(
                                'truncate rounded border px-1.5 py-1 text-left text-xs',
                                s.status === 'cancelled' && 'border-slate-200 bg-slate-50 text-slate-400 line-through',
                                s.status === 'draft' && 'border-dashed border-amber-400 bg-amber-50 text-amber-900',
                                s.status === 'published' && s.employeeId && 'border-emerald-200 bg-emerald-50 text-emerald-900',
                                s.status === 'published' && !s.employeeId && 'border-red-200 bg-red-50 font-medium text-red-700',
                              )}
                            >
                              {offersByShift.has(s.id) && (
                                <span className="mr-1 text-sky-600" aria-label="on the marketplace">
                                  ↗
                                </span>
                              )}
                              {s.employeeId ? firstName(s.employeeName) : 'Open'}
                              {!row.template && <span className="ml-1 opacity-70">{s.startTime}</span>}
                            </button>
                          ))}
                          {list.length === 0 && (
                            <button
                              onClick={() => openEditor(null, row, d)}
                              aria-label={`Add ${row.template?.name ?? ''} ${row.assignment?.name ?? ''} shift on ${d}`}
                              className="rounded border border-transparent px-1.5 py-1 text-left text-xs text-slate-300 hover:border-slate-200 hover:text-slate-500"
                            >
                              +
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shifts.isFetching && <p className="mt-2 text-xs text-slate-400">Refreshing…</p>}

      <p className="mt-3 text-xs text-slate-500">
        Dashed = draft (staff can’t see it yet) · Green = published · Red = open slot · ↗ = on the marketplace · Times in {timezone}
      </p>

      {editing && area && (
        <ShiftModal
          shift={editing.shift}
          draft={editing.draft}
          assignments={assignments}
          templates={activeTemplates}
          members={members.data ?? []}
          availability={availabilityMap}
          weekShifts={allShifts}
          offer={editing.shift ? offersByShift.get(editing.shift.id) : undefined}
          hoursByEmployee={hoursByEmployee}
          timezone={timezone}
          onClose={() => setEditing(null)}
        />
      )}
      {copyOpen && <CopyWeekModal monday={monday} areaId={areaId!} areaName={area?.name ?? ''} onClose={() => setCopyOpen(false)} />}
      {publishOpen && (
        <PublishModal
          monday={monday}
          areaId={areaId!}
          areaName={area?.name ?? ''}
          count={drafts.length}
          onClose={() => setPublishOpen(false)}
        />
      )}
    </>
  );
}

function CopyWeekModal({ monday, areaId, areaName, onClose }: { monday: string; areaId: string; areaName: string; onClose: () => void }) {
  const [includeEmployees, setIncludeEmployees] = useState(true);
  const copy = useApiMutation(
    () => api.shifts.copyWeek({ sourceWeekStart: addDays(monday, -7), targetWeekStart: monday, areaId, includeEmployees }),
    [keys.shifts],
  );
  return (
    <Modal
      open
      title="Copy last week"
      onClose={onClose}
      footer={
        copy.data ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={copy.isPending} onClick={() => copy.mutate(undefined)}>
              {copy.isPending ? 'Copying…' : 'Copy'}
            </Button>
          </>
        )
      }
    >
      {copy.data ? (
        <p className="text-sm">
          Copied <strong>{copy.data.copied}</strong> shifts as drafts.
          {copy.data.unassigned > 0 && ` ${copy.data.unassigned} were left open to avoid double-booking or eligibility issues.`}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Copies {areaName} shifts from {fmtRange(addDays(monday, -7))} into this week as <strong>drafts</strong>. Existing
            shifts this week are kept.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeEmployees} onChange={(e) => setIncludeEmployees(e.target.checked)} />
            Keep the same people on each shift
          </label>
        </>
      )}
      <ErrorText error={copy.error} />
    </Modal>
  );
}

function PublishModal({
  monday,
  areaId,
  areaName,
  count,
  onClose,
}: {
  monday: string;
  areaId: string;
  areaName: string;
  count: number;
  onClose: () => void;
}) {
  const publish = useApiMutation(() => api.shifts.publish({ from: monday, to: addDays(monday, 6), areaId }), [keys.shifts]);
  return (
    <Modal
      open
      title="Publish schedule"
      onClose={onClose}
      footer={
        publish.data ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={publish.isPending} onClick={() => publish.mutate(undefined)}>
              {publish.isPending ? 'Publishing…' : `Publish ${count} shifts`}
            </Button>
          </>
        )
      }
    >
      {publish.data ? (
        <p className="text-sm">Published {publish.data.published} shifts. Staff can now see them.</p>
      ) : (
        <p className="text-sm text-slate-600">
          Publish {count} draft shifts in {areaName} for {fmtRange(monday)}? Staff will see them in the app. (Notifications
          arrive with phase D5.)
        </p>
      )}
      <ErrorText error={publish.error} />
    </Modal>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ScheduleView />
    </Suspense>
  );
}
