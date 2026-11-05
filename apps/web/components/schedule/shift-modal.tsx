'use client';

import {
  availabilityConflicts,
  localShiftRange,
  rangesOverlap,
  type Assignment,
  type AvailabilitySlot,
  type Offer,
  type Profile,
  type Shift,
  type ShiftTemplate,
} from '@shifthub/shared';
import { useMemo, useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import Link from 'next/link';
import { keys, tradeKeys, useApiMutation } from '@/lib/hooks';

export type ShiftDraft = {
  date: string;
  areaId: string;
  assignmentId: string | null;
  shiftTemplateId: string | null;
  startTime: string;
  endTime: string;
};

type Candidate = {
  member: Profile;
  hours: number;
  busy: Shift | undefined;
  unavailable: AvailabilitySlot[];
  positionMismatch: boolean;
};

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function ShiftModal({
  shift,
  draft,
  assignments,
  templates,
  members,
  availability,
  weekShifts,
  hoursByEmployee,
  timezone,
  offer,
  onClose,
}: {
  /** Existing shift being edited, or null for a new one built from `draft`. */
  shift: Shift | null;
  draft: ShiftDraft;
  assignments: Assignment[];
  templates: ShiftTemplate[];
  members: Profile[];
  availability: Map<string, AvailabilitySlot[]>;
  weekShifts: Shift[];
  hoursByEmployee: Map<string, number>;
  /** Area timezone, for converting local times to instants. */
  timezone: string;
  /** Open marketplace offer for this shift, if any. */
  offer?: Offer;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState<string>(shift?.shiftTemplateId ?? draft.shiftTemplateId ?? '');
  const [startTime, setStartTime] = useState(shift?.startTime ?? draft.startTime);
  const [endTime, setEndTime] = useState(shift?.endTime ?? draft.endTime);
  const [assignmentId, setAssignmentId] = useState<string>(shift?.assignmentId ?? draft.assignmentId ?? '');
  const [employeeId, setEmployeeId] = useState<string>(shift?.employeeId ?? '');
  const [notes, setNotes] = useState(shift?.notes ?? '');
  const date = shift?.date ?? draft.date;

  const template = templates.find((t) => t.id === templateId);
  const effStart = template ? template.startTime : startTime;
  const effEnd = template ? template.endTime : endTime;
  const assignment = assignments.find((a) => a.id === assignmentId);

  const candidates = useMemo<Candidate[]>(() => {
    const probe = localShiftRange(date, effStart, effEnd, timezone);
    return members
      .filter((m) => m.status === 'active')
      .map((m) => ({
        member: m,
        hours: hoursByEmployee.get(m.id) ?? 0,
        busy: weekShifts.find(
          (s) =>
            s.employeeId === m.id &&
            s.id !== shift?.id &&
            s.status !== 'cancelled' &&
            rangesOverlap(s.startsAt, s.endsAt, probe.startsAt, probe.endsAt),
        ),
        unavailable: availabilityConflicts(availability.get(m.id) ?? [], date, effStart, effEnd),
        positionMismatch: !!assignment?.requiredPosition && m.position !== assignment.requiredPosition,
      }))
      .sort(
        (a, b) =>
          Number(a.positionMismatch) - Number(b.positionMismatch) ||
          Number(!!a.busy) - Number(!!b.busy) ||
          Number(a.unavailable.length > 0) - Number(b.unavailable.length > 0) ||
          a.hours - b.hours ||
          a.member.name.localeCompare(b.member.name),
      );
  }, [members, hoursByEmployee, weekShifts, availability, date, effStart, effEnd, timezone, assignment, shift?.id]);

  const selected = candidates.find((c) => c.member.id === employeeId);

  const save = useApiMutation(async () => {
    const times = template ? { shiftTemplateId: template.id } : { shiftTemplateId: null, startTime, endTime };
    const common = { assignmentId: assignmentId || null, employeeId: employeeId || null, notes: notes.trim() || null };
    if (shift) return api.shifts.update(shift.id, { ...common, ...times, date });
    return api.shifts.create({ areaId: draft.areaId, date, ...common, ...times });
  }, tradeKeys);

  const remove = useApiMutation(
    async () => {
      if (shift!.status === 'draft') await api.shifts.remove(shift!.id);
      else await api.shifts.update(shift!.id, { status: 'cancelled' });
    },
    tradeKeys,
  );

  const label = (c: Candidate) => {
    const flags = [
      `${c.hours}h`,
      c.positionMismatch && `${c.member.position ?? 'no position'}`,
      c.busy && `busy ${c.busy.startTime}–${c.busy.endTime}`,
      c.unavailable.length > 0 && 'unavailable',
    ].filter(Boolean);
    return `${c.member.name}${c.member.position ? ` (${c.member.position})` : ''} · ${flags.join(' · ')}`;
  };

  return (
    <Modal
      open
      title={shift ? 'Edit shift' : 'New shift'}
      onClose={onClose}
      footer={
        <>
          {shift && shift.status !== 'cancelled' && (
            <Button
              variant="dangerGhost"
              className="mr-auto"
              disabled={remove.isPending}
              onClick={() =>
                window.confirm(shift.status === 'draft' ? 'Delete this draft shift?' : 'Cancel this published shift?') &&
                remove.mutate(undefined, { onSuccess: onClose })
              }
            >
              {shift.status === 'draft' ? 'Delete' : 'Cancel shift'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">{fmtDate(date)}</p>
        {shift && (
          <Badge tone={shift.status === 'published' ? 'green' : shift.status === 'draft' ? 'amber' : 'red'}>{shift.status}</Badge>
        )}
      </div>

      <Field label="Shift">
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {templates
            .filter((t) => t.active)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.startTime}–{t.endTime})
              </option>
            ))}
          <option value="">Custom times</option>
        </Select>
      </Field>
      {!template && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End" hint={endTime <= startTime ? 'Ends the next day' : undefined}>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
      )}

      <Field label="Position">
        <Select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
          <option value="">No specific position</option>
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.requiredPosition ? ` (${a.requiredPosition})` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Employee" hint="Sorted by eligibility, conflicts, then fewest hours this week.">
        <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Open — not assigned</option>
          {candidates.map((c) => (
            <option key={c.member.id} value={c.member.id} disabled={(!!c.busy || c.positionMismatch) && c.member.id !== shift?.employeeId}>
              {label(c)}
            </option>
          ))}
        </Select>
      </Field>
      {selected && selected.unavailable.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {selected.member.name} marked themselves unavailable:{' '}
          {selected.unavailable.map((s) => `${s.startTime}–${s.endTime}${s.note ? ` (${s.note})` : ''}`).join(', ')}
        </p>
      )}

      {shift && <MarketplaceBox shift={shift} offer={offer} />}

      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </Field>
      <ErrorText error={save.error ?? remove.error} />
    </Modal>
  );
}

function MarketplaceBox({ shift, offer }: { shift: Shift; offer?: Offer }) {
  const post = useApiMutation(() => api.marketplace.offer({ shiftId: shift.id }), tradeKeys);
  const unpost = useApiMutation(() => api.marketplace.cancelOffer(offer!.id), tradeKeys);
  const started = Date.parse(shift.startsAt) <= Date.now();
  if (shift.status !== 'published' || started) return null;

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
      {offer ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sky-900">
            On the marketplace{offer.offeredBy ? ` (offered by ${offer.offeredBy.name})` : ''} ·{' '}
            {offer.pendingRequests} request{offer.pendingRequests === 1 ? '' : 's'}
          </span>
          <span className="flex gap-1">
            {offer.pendingRequests > 0 && (
              <Link href="/approvals" className="rounded px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100">
                Review
              </Link>
            )}
            <Button size="sm" variant="ghost" disabled={unpost.isPending} onClick={() => unpost.mutate(undefined)}>
              Take off
            </Button>
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sky-900">
            {shift.employeeId ? 'Let eligible staff request this shift.' : 'Post this open slot so eligible staff can request it.'}
          </span>
          <Button size="sm" variant="secondary" disabled={post.isPending} onClick={() => post.mutate(undefined)}>
            Post to marketplace
          </Button>
        </div>
      )}
      <ErrorText error={post.error ?? unpost.error} />
    </div>
  );
}
