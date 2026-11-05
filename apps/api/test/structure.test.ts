import { seedIds as ids } from '@shifthub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApi } from './helpers';

let api: Awaited<ReturnType<typeof setupApi>>;
const call = (...args: Parameters<typeof api.call>) => api.call(...args);

beforeAll(async () => {
  api = await setupApi('shifthub_test_api_structure');
});
afterAll(async () => {
  await api?.close();
});

describe('locations', () => {
  it('returns the seeded tree for my org only', async () => {
    const res = await call('GET', '/v1/locations', ids.staffA1);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].areas.map((a: { name: string }) => a.name)).toEqual(['Birch Unit', 'Cedar Unit', 'Willow Unit']);
    expect(res.body[0].areas[0].assignments[0]).toMatchObject({ name: 'Charge Nurse', requiredPosition: 'RN' });
  });

  it('manager creates site → area → assignment, then edits and deletes in order', async () => {
    const s = await call('POST', '/v1/sites', ids.managerA, { name: 'North Annex', code: 'NA', timezone: 'America/Toronto' });
    expect(s.status).toBe(201);
    const a = await call('POST', '/v1/areas', ids.managerA, { siteId: s.body.id, name: 'Rehab' });
    expect(a.status).toBe(201);
    const x = await call('POST', '/v1/assignments', ids.managerA, { areaId: a.body.id, name: 'PSW 1', requiredPosition: 'PSW' });
    expect(x.status).toBe(201);
    expect(x.body).toMatchObject({ areaId: a.body.id, displayOrder: 0, status: 'active' });

    const renamed = await call('PATCH', `/v1/areas/${a.body.id}`, ids.managerA, { name: 'Rehab Wing' });
    expect(renamed.body.name).toBe('Rehab Wing');

    // cannot delete parents that still have children
    expect((await call('DELETE', `/v1/sites/${s.body.id}`, ids.managerA)).status).toBe(409);
    expect((await call('DELETE', `/v1/areas/${a.body.id}`, ids.managerA)).status).toBe(409);

    expect((await call('DELETE', `/v1/assignments/${x.body.id}`, ids.managerA)).status).toBe(204);
    expect((await call('DELETE', `/v1/areas/${a.body.id}`, ids.managerA)).status).toBe(204);
    expect((await call('DELETE', `/v1/sites/${s.body.id}`, ids.managerA)).status).toBe(204);
    expect((await call('DELETE', `/v1/sites/${s.body.id}`, ids.managerA)).status).toBe(404);

    const tree = await call('GET', '/v1/locations', ids.managerA);
    expect(tree.body.find((x: { id: string }) => x.id === s.body.id)).toBeUndefined();
  });

  it('employees cannot create or edit locations', async () => {
    expect((await call('POST', '/v1/sites', ids.staffA1, { name: 'Mine' })).status).toBe(403);
    expect((await call('PATCH', `/v1/sites/${ids.siteA}`, ids.staffA1, { name: 'Mine' })).status).toBe(403);
  });

  it('cannot attach an area to another org site, or edit another org site', async () => {
    expect((await call('POST', '/v1/areas', ids.managerA, { siteId: ids.siteB, name: 'X' })).status).toBe(404);
    expect((await call('PATCH', `/v1/sites/${ids.siteB}`, ids.managerA, { name: 'X' })).status).toBe(404);
  });

  it('validates input and duplicate names', async () => {
    expect((await call('POST', '/v1/sites', ids.managerA, { name: '' })).status).toBe(400);
    expect((await call('POST', '/v1/sites', ids.managerA, { name: 'Tz', timezone: 'Bad/Zone' })).status).toBe(400);
    expect((await call('POST', '/v1/areas', ids.managerA, { siteId: ids.siteA, name: 'birch unit' })).status).toBe(409);
  });
});

describe('shift templates', () => {
  it('lists defaults, flags overnight', async () => {
    const res = await call('GET', '/v1/shift-templates', ids.staffA1);
    expect(res.body.map((t: { name: string; overnight: boolean }) => [t.name, t.overnight])).toEqual([
      ['Day', false],
      ['Evening', false],
      ['Night', true],
    ]);
  });

  it('manager creates, updates and deletes a template', async () => {
    const t = await call('POST', '/v1/shift-templates', ids.managerA, {
      name: '12h Day',
      startTime: '07:00',
      endTime: '19:00',
      color: '#22c55e',
    });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ startTime: '07:00', endTime: '19:00', isDefault: false, overnight: false });

    const u = await call('PATCH', `/v1/shift-templates/${t.body.id}`, ids.managerA, { endTime: '07:00', startTime: '19:00' });
    expect(u.body.overnight).toBe(true);

    expect((await call('DELETE', `/v1/shift-templates/${t.body.id}`, ids.managerA)).status).toBe(204);
    const list = await call('GET', '/v1/shift-templates', ids.managerA);
    expect(list.body.some((x: { id: string }) => x.id === t.body.id)).toBe(false);
  });

  it('rejects bad times and employee writes', async () => {
    expect(
      (await call('POST', '/v1/shift-templates', ids.managerA, { name: 'X', startTime: '7am', endTime: '15:00' })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/v1/shift-templates', ids.managerA, { name: 'X', startTime: '08:00', endTime: '08:00' })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/v1/shift-templates', ids.staffA1, { name: 'X', startTime: '08:00', endTime: '12:00' })).status,
    ).toBe(403);
  });
});

describe('member areas', () => {
  const member = '00000000-0000-4000-b000-000000000030';

  it('manager replaces the areas a member can work', async () => {
    const res = await call('PUT', `/v1/members/${member}/areas`, ids.managerA, { areaIds: [ids.areaA1, ids.areaA2] });
    expect(res.status).toBe(200);
    expect(res.body.areaIds.sort()).toEqual([ids.areaA1, ids.areaA2].sort());

    const narrowed = await call('PUT', `/v1/members/${member}/areas`, ids.managerA, { areaIds: [ids.areaA2] });
    expect(narrowed.body.areaIds).toEqual([ids.areaA2]);
    expect((await call('GET', `/v1/members/${member}/areas`, ids.staffA1)).body.areaIds).toEqual([ids.areaA2]);
  });

  it('rejects other-org areas, other-org members and employee callers', async () => {
    expect((await call('PUT', `/v1/members/${member}/areas`, ids.managerA, { areaIds: [ids.areaB] })).status).toBe(400);
    expect((await call('PUT', `/v1/members/${ids.owlB2.sub}/areas`, ids.managerA, { areaIds: [] })).status).toBe(404);
    expect((await call('PUT', `/v1/members/${member}/areas`, ids.staffA1, { areaIds: [] })).status).toBe(403);
  });
});

describe('availability', () => {
  it('reads seeded availability', async () => {
    const res = await call('GET', '/v1/me/availability', ids.staffA1);
    expect(res.body.slots).toEqual([
      { weekday: 0, startTime: '00:00', endTime: '24:00', note: 'Family day' },
      { weekday: 3, startTime: '15:00', endTime: '24:00', note: 'Class' },
    ]);
  });

  it('replaces my availability and managers can read it', async () => {
    const slots = [{ weekday: 5, startTime: '18:00', endTime: '24:00', note: null }];
    const put = await call('PUT', '/v1/me/availability', ids.staffA2, { slots });
    expect(put.body.slots).toEqual(slots);
    const mgr = await call('GET', `/v1/members/${ids.staffA2.sub}/availability`, ids.managerA);
    expect(mgr.body.slots).toEqual(slots);
    expect((await call('GET', `/v1/members/${ids.staffA2.sub}/availability`, ids.staffA1)).status).toBe(403);
  });

  it('rejects invalid slots', async () => {
    const bad = [{ weekday: 7, startTime: '10:00', endTime: '11:00' }];
    expect((await call('PUT', '/v1/me/availability', ids.staffA2, { slots: bad })).status).toBe(400);
    const backwards = [{ weekday: 1, startTime: '12:00', endTime: '11:00' }];
    expect((await call('PUT', '/v1/me/availability', ids.staffA2, { slots: backwards })).status).toBe(400);
  });
});

describe('member privacy', () => {
  it('employees do not see coworker email/phone; managers do', async () => {
    const asStaff = await call('GET', '/v1/members', ids.staffA1);
    const self = asStaff.body.find((p: { id: string }) => p.id === ids.staffA1.sub);
    const other = asStaff.body.find((p: { id: string }) => p.id === ids.staffA2.sub);
    expect(self.email).toBe(ids.staffA1.email);
    expect(other.email).toBeNull();

    const asManager = await call('GET', '/v1/members', ids.managerA);
    expect(asManager.body.find((p: { id: string }) => p.id === ids.staffA2.sub).email).toBe(ids.staffA2.email);
  });
});

describe('schedule helpers', () => {
  it('filters members by area', async () => {
    const res = await call('GET', `/v1/members?areaId=${ids.areaA1}`, ids.managerA);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(5);
    expect(res.body.length).toBeLessThan(100);
    for (const m of res.body.slice(0, 5)) {
      const areas = await call('GET', `/v1/members/${m.id}/areas`, ids.managerA);
      expect(areas.body.areaIds).toContain(ids.areaA1);
    }
  });

  it('returns area availability for managers only', async () => {
    const area = (await call('GET', `/v1/members/${ids.staffA1.sub}/areas`, ids.managerA)).body.areaIds[0];
    const res = await call('GET', `/v1/availability?areaId=${area}`, ids.managerA);
    expect(res.status).toBe(200);
    const mine = res.body.find((r: { employeeId: string }) => r.employeeId === ids.staffA1.sub);
    expect(mine.slots.length).toBeGreaterThan(0);
    expect((await call('GET', `/v1/availability?areaId=${area}`, ids.staffA1)).status).toBe(403);
  });
});
