import { seedIds as ids } from '@shifthub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApi } from './helpers';

let api: Awaited<ReturnType<typeof setupApi>>;
const call = (...args: Parameters<typeof api.call>) => api.call(...args);

const TZ = 'America/Toronto';
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => isoDate(new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000));
/** Monday of the current week in Toronto (matches the seed). */
function thisMonday() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -((dow + 6) % 7));
}

let monday: string;
let sunday: string;
let staff1Area: string;
let rnAssignment: string;
let dayTemplate: string;
let nightTemplate: string;

beforeAll(async () => {
  api = await setupApi('shifthub_test_api_shifts');
  monday = thisMonday();
  sunday = addDays(monday, 6);
  staff1Area = (await call('GET', `/v1/members/${ids.staffA1.sub}/areas`, ids.managerA)).body.areaIds[0];
  const tree = (await call('GET', '/v1/locations', ids.managerA)).body;
  const area = tree[0].areas.find((a: { id: string }) => a.id === staff1Area);
  rnAssignment = area.assignments.find((x: { requiredPosition: string }) => x.requiredPosition === 'RN').id;
  const templates = (await call('GET', '/v1/shift-templates', ids.managerA)).body;
  dayTemplate = templates.find((t: { name: string }) => t.name === 'Day').id;
  nightTemplate = templates.find((t: { name: string }) => t.name === 'Night').id;
});
afterAll(async () => {
  await api?.close();
});

describe('listing', () => {
  it('manager sees the full published week with local times', async () => {
    const res = await call('GET', `/v1/shifts?from=${monday}&to=${sunday}`, ids.managerA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(441);
    const night = res.body.find((s: { shiftTemplateId: string }) => s.shiftTemplateId === nightTemplate);
    expect(night).toMatchObject({ startTime: '23:00', endTime: '07:00', timezone: TZ, status: 'published' });
  });

  it('mine=true returns only my shifts', async () => {
    const res = await call('GET', `/v1/shifts?from=${monday}&to=${sunday}&mine=true`, ids.staffA2);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((s: { employeeId: string }) => s.employeeId === ids.staffA2.sub)).toBe(true);
  });

  it('employees only see coworkers who share', async () => {
    const res = await call('GET', `/v1/shifts?from=${monday}&to=${sunday}`, ids.staffA2);
    const members = (await call('GET', '/v1/members', ids.managerA)).body as { id: string; shareSchedule: boolean }[];
    const sharing = new Set(members.filter((m) => m.shareSchedule).map((m) => m.id));
    for (const s of res.body) {
      expect(s.employeeId === ids.staffA2.sub || sharing.has(s.employeeId)).toBe(true);
    }
  });

  it('validates the date range', async () => {
    expect((await call('GET', `/v1/shifts?from=${sunday}&to=${monday}`, ids.managerA)).status).toBe(400);
    expect((await call('GET', `/v1/shifts?from=${monday}&to=${addDays(monday, 90)}`, ids.managerA)).status).toBe(400);
    expect((await call('GET', `/v1/shifts?from=bad&to=${monday}`, ids.managerA)).status).toBe(400);
  });
});

describe('manager scheduling flow', () => {
  const week = () => addDays(monday, 70); // a quiet week in the future

  it('creates a draft from a template, invisible to the employee until published', async () => {
    const created = await call('POST', '/v1/shifts', ids.managerA, {
      areaId: staff1Area,
      assignmentId: rnAssignment,
      employeeId: ids.staffA1.sub,
      shiftTemplateId: nightTemplate,
      date: week(),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'draft', date: week(), startTime: '23:00', endTime: '07:00' });
    expect(Date.parse(created.body.endsAt) - Date.parse(created.body.startsAt)).toBe(8 * 3600_000);

    const hidden = await call('GET', `/v1/shifts?from=${week()}&to=${week()}&mine=true`, ids.staffA1);
    expect(hidden.body).toHaveLength(0);

    const pub = await call('POST', '/v1/shifts/publish', ids.managerA, { from: week(), to: addDays(week(), 6) });
    expect(pub.body.published).toBe(1);

    const visible = await call('GET', `/v1/shifts?from=${week()}&to=${week()}&mine=true`, ids.staffA1);
    expect(visible.body.map((s: { id: string }) => s.id)).toEqual([created.body.id]);
  });

  it('moves a shift to explicit times, then cancels it', async () => {
    const created = await call('POST', '/v1/shifts', ids.managerA, {
      areaId: staff1Area,
      shiftTemplateId: dayTemplate,
      date: addDays(week(), 1),
    });
    const moved = await call('PATCH', `/v1/shifts/${created.body.id}`, ids.managerA, { startTime: '09:00', endTime: '17:00' });
    expect(moved.body).toMatchObject({ startTime: '09:00', endTime: '17:00', shiftTemplateId: null });

    const redated = await call('PATCH', `/v1/shifts/${created.body.id}`, ids.managerA, { date: addDays(week(), 2) });
    expect(redated.body).toMatchObject({ date: addDays(week(), 2), startTime: '09:00' });

    const cancelled = await call('PATCH', `/v1/shifts/${created.body.id}`, ids.managerA, { status: 'cancelled' });
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('returns 409 for double booking and 400 for ineligible employees', async () => {
    const date = addDays(week(), 3);
    const first = await call('POST', '/v1/shifts', ids.managerA, {
      areaId: staff1Area,
      employeeId: ids.staffA1.sub,
      shiftTemplateId: dayTemplate,
      date,
    });
    expect(first.status).toBe(201);
    const clash = await call('POST', '/v1/shifts', ids.managerA, {
      areaId: staff1Area,
      employeeId: ids.staffA1.sub,
      startTime: '12:00',
      endTime: '20:00',
      date,
    });
    expect(clash.status).toBe(409);

    const otherArea = (await call('GET', '/v1/locations', ids.managerA)).body[0].areas.find(
      (a: { id: string }) => a.id !== staff1Area,
    ).id;
    const ineligible = await call('POST', '/v1/shifts', ids.managerA, {
      areaId: otherArea,
      employeeId: ids.staffA1.sub,
      shiftTemplateId: dayTemplate,
      date: addDays(week(), 4),
    });
    expect(ineligible.status).toBe(400);
  });

  it('copies this week into an empty future week', async () => {
    const target = addDays(monday, 21);
    const res = await call('POST', '/v1/shifts/copy-week', ids.managerA, {
      sourceWeekStart: monday,
      targetWeekStart: target,
    });
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(441);

    const drafts = await call('GET', `/v1/shifts?from=${target}&to=${addDays(target, 6)}&status=draft`, ids.managerA);
    expect(drafts.body).toHaveLength(441);
  });

  it('validates create input', async () => {
    expect((await call('POST', '/v1/shifts', ids.managerA, { areaId: staff1Area, date: week() })).status).toBe(400);
    expect(
      (await call('POST', '/v1/shifts', ids.managerA, { areaId: ids.areaB, shiftTemplateId: dayTemplate, date: week() }))
        .status,
    ).toBe(404);
  });
});

describe('employee permissions', () => {
  it('employees cannot create, edit, publish or copy in facility mode', async () => {
    const mine = (await call('GET', `/v1/shifts?from=${monday}&to=${sunday}&mine=true`, ids.staffA1)).body[0];
    expect(
      (await call('POST', '/v1/shifts', ids.staffA1, { areaId: staff1Area, shiftTemplateId: dayTemplate, date: monday }))
        .status,
    ).toBe(403);
    expect((await call('PATCH', `/v1/shifts/${mine.id}`, ids.staffA1, { notes: 'x' })).status).toBe(403);
    expect((await call('DELETE', `/v1/shifts/${mine.id}`, ids.staffA1)).status).toBe(403);
    expect((await call('POST', '/v1/shifts/publish', ids.staffA1, { from: monday, to: sunday })).status).toBe(403);
    expect(
      (await call('POST', '/v1/shifts/copy-week', ids.staffA1, { sourceWeekStart: monday, targetWeekStart: monday }))
        .status,
    ).toBe(403);
  });

  it('employees cannot read a coworker’s non-shared shift by id', async () => {
    const theirs = (await call('GET', `/v1/shifts?from=${monday}&to=${sunday}&employeeId=${ids.staffA2.sub}`, ids.managerA))
      .body[0];
    expect((await call('GET', `/v1/shifts/${theirs.id}`, ids.staffA1)).status).toBe(404);
  });
});

describe('self-scheduling (group mode)', () => {
  it('a member adds, edits and deletes their own shift (published by default)', async () => {
    const date = addDays(monday, 35);
    const created = await call('POST', '/v1/shifts', ids.owlB2, {
      areaId: ids.areaB,
      startTime: '19:00',
      endTime: '07:00',
      date,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ employeeId: ids.owlB2.sub, status: 'published' });

    // coworkers in group mode share by default, so the admin sees it
    const seen = await call('GET', `/v1/shifts?from=${date}&to=${date}`, ids.adminB);
    expect(seen.body.some((s: { id: string }) => s.id === created.body.id)).toBe(true);

    expect((await call('PATCH', `/v1/shifts/${created.body.id}`, ids.owlB2, { notes: 'swap?' })).body.notes).toBe('swap?');
    expect((await call('DELETE', `/v1/shifts/${created.body.id}`, ids.owlB2)).status).toBe(204);
  });

  it('a member cannot add a shift for someone else', async () => {
    const res = await call('POST', '/v1/shifts', ids.owlB2, {
      areaId: ids.areaB,
      employeeId: ids.adminB.sub,
      startTime: '19:00',
      endTime: '07:00',
      date: addDays(monday, 36),
    });
    expect(res.status).toBe(403);
  });
});
