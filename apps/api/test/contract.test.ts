/**
 * Contract tests: every response must match the shared Zod schemas the web and mobile apps rely on.
 * Catches drift between SQL mappers and packages/shared.
 */
import { seedIds as ids } from '@shifthub/db/testing';
import {
  approvals,
  auditEntry,
  invitation,
  locations,
  me,
  myTrades,
  notificationList,
  offer,
  organization,
  profile,
  shift,
  shiftTemplate,
  swap,
} from '@shifthub/shared';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApi, type TestUser } from './helpers';

let api: Awaited<ReturnType<typeof setupApi>>;
const call = (...args: Parameters<typeof api.call>) => api.call(...args);

function expectShape(schema: z.ZodType, body: unknown) {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(z.prettifyError(r.error));
  expect(r.success).toBe(true);
}

let rn2: TestUser;
let area: string;

beforeAll(async () => {
  api = await setupApi('shifthub_test_api_contract');
  area = (await call('GET', `/v1/members/${ids.staffA1.sub}/areas`, ids.managerA)).body.areaIds[0];
  const members = (await call('GET', `/v1/members?areaId=${area}`, ids.managerA)).body as { id: string; email: string; position: string; role: string }[];
  const r = members.find((m) => m.position === 'RN' && m.role === 'employee' && m.id !== ids.staffA1.sub)!;
  rn2 = { sub: r.id, email: r.email };

  // create some trade activity so lists are non-empty
  const mk = async (who: string, date: string) =>
    (await call('POST', '/v1/shifts', ids.managerA, { areaId: area, employeeId: who, startTime: '07:00', endTime: '15:00', date, status: 'published' })).body.id;
  const a = await mk(ids.staffA1.sub, '2033-01-10');
  const b = await mk(rn2.sub, '2033-01-11');
  const c = await mk(rn2.sub, '2033-01-12');
  await call('POST', '/v1/swaps', ids.staffA1, { myShiftId: a, theirShiftId: b });
  const o = await call('POST', '/v1/offers', rn2, { shiftId: c, reason: 'x' });
  await call('POST', `/v1/offers/${o.body.id}/requests`, ids.staffA1, {});
});
afterAll(async () => {
  await api?.close();
});

const membersShape = z.array(profile.extend({ email: z.string().nullable() }));

describe('responses match shared schemas', () => {
  const cases: [string, string, z.ZodType, () => TestUser][] = [
    ['me (employee)', '/v1/me', me, () => ids.staffA1],
    ['me (manager)', '/v1/me', me, () => ids.managerA],
    ['organization', '/v1/organization', organization, () => ids.managerA],
    ['members (employee view)', '/v1/members', membersShape, () => ids.staffA1],
    ['locations', '/v1/locations', locations, () => ids.staffA1],
    ['shift templates', '/v1/shift-templates', z.array(shiftTemplate), () => ids.staffA1],
    ['shifts (manager week)', '/v1/shifts?from=2033-01-10&to=2033-01-16', z.array(shift), () => ids.managerA],
    ['marketplace', '/v1/marketplace', z.array(offer), () => ids.staffA1],
    ['my trades', '/v1/me/trades', myTrades, () => rn2],
    ['swaps', '/v1/swaps', z.array(swap), () => rn2],
    ['approvals', '/v1/approvals', approvals, () => ids.managerA],
    ['invitations', '/v1/invitations', z.array(invitation), () => ids.managerA],
    ['notifications', '/v1/notifications', notificationList, () => rn2],
    ['audit', '/v1/audit?limit=20', z.array(auditEntry), () => ids.managerA],
  ];

  for (const [name, path, schema, user] of cases) {
    it(name, async () => {
      const res = await call('GET', path, user());
      expect(res.status).toBe(200);
      expectShape(schema, res.body);
    });
  }

  it('lists used by the tests are not empty', async () => {
    expect((await call('GET', '/v1/me/trades', rn2)).body.swaps.length).toBeGreaterThan(0);
    expect((await call('GET', '/v1/approvals', ids.managerA)).body.pickups.length).toBeGreaterThan(0);
    expect((await call('GET', '/v1/notifications', rn2)).body.items.length).toBeGreaterThan(0);
  });
});
