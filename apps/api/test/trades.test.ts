import { seedIds as ids } from '@shifthub/db/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApi, type TestUser } from './helpers';

let api: Awaited<ReturnType<typeof setupApi>>;
const call = (...args: Parameters<typeof api.call>) => api.call(...args);
const DB = 'shifthub_test_api_trades';
const base = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432';

let area: string;
let rn2: TestUser;
let rn3: TestUser;
let dayTemplate: string;
let n = 0;
const nextDate = () => {
  n += 1;
  return new Date(Date.UTC(2031, 5, 1) + n * 86_400_000).toISOString().slice(0, 10);
};

/** Published RN shift for `employee` on a fresh future day. */
async function publishedShift(employee: string | null) {
  const tree = (await call('GET', '/v1/locations', ids.managerA)).body;
  const rn = tree[0].areas.find((a: { id: string }) => a.id === area).assignments.find(
    (x: { requiredPosition: string }) => x.requiredPosition === 'RN',
  );
  const res = await call('POST', '/v1/shifts', ids.managerA, {
    areaId: area,
    assignmentId: rn.id,
    employeeId: employee,
    shiftTemplateId: dayTemplate,
    date: nextDate(),
    status: 'published',
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  api = await setupApi(DB);
  area = (await call('GET', `/v1/members/${ids.staffA1.sub}/areas`, ids.managerA)).body.areaIds[0];
  const sql = postgres(`${base}/${DB}`, { max: 1 });
  const rns = await sql`
    select p.id as sub, p.email from app.profiles p join app.employee_areas ea on ea.employee_id = p.id
    where ea.area_id = ${area} and p.position = 'RN' and p.role = 'employee' and p.id <> ${ids.staffA1.sub} order by p.id`;
  await sql`update app.profiles set share_schedule = false where id = ${rns[0]!.sub}`;
  await sql.end();
  rn2 = rns[0] as unknown as TestUser;
  rn3 = rns[1] as unknown as TestUser;
  dayTemplate = (await call('GET', '/v1/shift-templates', ids.managerA)).body.find((t: { name: string }) => t.name === 'Day').id;
});
afterAll(async () => {
  await api?.close();
});

describe('marketplace flow', () => {
  it('offer → appears for eligible coworkers → request → manager approves → shift moves', async () => {
    const shiftId = await publishedShift(rn2.sub);
    const offered = await call('POST', '/v1/offers', rn2, { shiftId, reason: 'appointment' });
    expect(offered.status).toBe(201);
    expect(offered.body).toMatchObject({ status: 'open', offeredBy: { id: rn2.sub }, shift: { id: shiftId } });

    const market = await call('GET', '/v1/marketplace?eligibleOnly=true', rn3);
    const listed = market.body.find((o: { id: string }) => o.id === offered.body.id);
    expect(listed).toMatchObject({ eligible: true, conflict: false, myRequest: null, pendingRequests: 0 });

    const psw = await call('GET', '/v1/marketplace?eligibleOnly=true', { sub: '00000000-0000-4000-b000-000000000060', email: 'staff55@maplegrove.test' });
    expect(psw.body.some((o: { id: string }) => o.id === offered.body.id)).toBe(false);

    const req = await call('POST', `/v1/offers/${offered.body.id}/requests`, rn3, { note: 'I can' });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ status: 'pending', employee: { id: rn3.sub, position: 'RN' } });

    const queue = await call('GET', '/v1/approvals', ids.managerA);
    const pending = queue.body.pickups.find((p: { id: string }) => p.id === req.body.id);
    expect(pending.offer.shift.id).toBe(shiftId);
    expect((await call('GET', '/v1/approvals', rn3)).status).toBe(403);

    const decided = await call('POST', `/v1/offer-requests/${req.body.id}/decision`, ids.managerA, { approve: true });
    expect(decided.body.status).toBe('approved');
    expect((await call('GET', `/v1/shifts/${shiftId}`, ids.managerA)).body.employeeId).toBe(rn3.sub);

    // the original owner still sees their (filled) offer in their history
    const mine = await call('GET', '/v1/me/trades', rn2);
    expect(mine.body.offers.find((o: { id: string }) => o.id === offered.body.id).status).toBe('filled');
    const theirs = await call('GET', '/v1/me/trades', rn3);
    expect(theirs.body.requests.find((r: { id: string }) => r.id === req.body.id).status).toBe('approved');
  });

  it('maps business errors to HTTP codes', async () => {
    const shiftId = await publishedShift(rn2.sub);
    expect((await call('POST', '/v1/offers', rn3, { shiftId })).status).toBe(403); // not yours
    const offered = await call('POST', '/v1/offers', rn2, { shiftId });
    expect((await call('POST', '/v1/offers', rn2, { shiftId })).status).toBe(409); // duplicate
    expect((await call('POST', `/v1/offers/${offered.body.id}/requests`, rn2, {})).status).toBe(400); // own shift
    expect((await call('POST', `/v1/offers/${offered.body.id}/requests`, ids.owlB2, {})).status).toBe(404); // other org
    expect((await call('DELETE', `/v1/offers/${offered.body.id}`, rn3)).status).toBe(403);
    expect((await call('DELETE', `/v1/offers/${offered.body.id}`, rn2)).status).toBe(204);
  });

  it('withdraw a request', async () => {
    const shiftId = await publishedShift(rn2.sub);
    const offered = await call('POST', '/v1/offers', rn2, { shiftId });
    const req = await call('POST', `/v1/offers/${offered.body.id}/requests`, rn3, {});
    expect((await call('DELETE', `/v1/offer-requests/${req.body.id}`, rn3)).status).toBe(204);
    const requests = await call('GET', `/v1/offers/${offered.body.id}/requests`, rn2);
    expect(requests.body[0].status).toBe('withdrawn');
  });
});

describe('swap flow', () => {
  it('propose → accept → manager approves; both sides see it', async () => {
    const mine = await publishedShift(ids.staffA1.sub);
    const theirs = await publishedShift(rn2.sub);
    const proposed = await call('POST', '/v1/swaps', ids.staffA1, { myShiftId: mine, theirShiftId: theirs, note: 'please' });
    expect(proposed.status).toBe(201);
    expect(proposed.body).toMatchObject({ status: 'pending_peer', requester: { id: ids.staffA1.sub }, target: { id: rn2.sub } });
    expect(proposed.body.targetShift.id).toBe(theirs);

    const inbox = await call('GET', '/v1/swaps', rn2);
    expect(inbox.body.find((w: { id: string }) => w.id === proposed.body.id).requesterShift.id).toBe(mine);

    const accepted = await call('POST', `/v1/swaps/${proposed.body.id}/response`, rn2, { accept: true });
    expect(accepted.body.status).toBe('pending_manager');
    expect((await call('GET', '/v1/approvals', ids.managerA)).body.swaps.some((w: { id: string }) => w.id === proposed.body.id)).toBe(true);

    const approved = await call('POST', `/v1/swaps/${proposed.body.id}/decision`, ids.managerA, { approve: true });
    expect(approved.body.status).toBe('approved');
    expect((await call('GET', `/v1/shifts/${mine}`, ids.managerA)).body.employeeId).toBe(rn2.sub);
    expect((await call('GET', `/v1/shifts/${theirs}`, ids.managerA)).body.employeeId).toBe(ids.staffA1.sub);
  });

  it('errors: respond to someone else’s swap, cancel twice, employee decision', async () => {
    const mine = await publishedShift(ids.staffA1.sub);
    const theirs = await publishedShift(rn2.sub);
    const w = (await call('POST', '/v1/swaps', ids.staffA1, { myShiftId: mine, theirShiftId: theirs })).body;
    expect((await call('POST', `/v1/swaps/${w.id}/response`, rn3, { accept: true })).status).toBe(404);
    expect((await call('POST', `/v1/swaps/${w.id}/decision`, rn2, { approve: true })).status).toBe(403);
    expect((await call('DELETE', `/v1/swaps/${w.id}`, ids.staffA1)).status).toBe(204);
    expect((await call('DELETE', `/v1/swaps/${w.id}`, ids.staffA1)).status).toBe(404);
  });

  it('managers can list all swaps; employees only theirs', async () => {
    const org = await call('GET', '/v1/swaps?scope=org', ids.managerA);
    expect(org.body.length).toBeGreaterThanOrEqual(2);
    const outsider = await call('GET', '/v1/swaps?scope=org', rn3);
    expect(outsider.body).toHaveLength(0);
  });
});
