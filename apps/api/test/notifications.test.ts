import { seedIds as ids } from '@shifthub/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createExpoPushSender, createMemoryPushSender } from '../src/push';
import { setupApi, type TestUser } from './helpers';

const JOBS = 'test-jobs-secret';
const push = createMemoryPushSender();
let api: Awaited<ReturnType<typeof setupApi>>;
const call = (...args: Parameters<typeof api.call>) => api.call(...args);
const runJobs = (secret = JOBS) => api.app.request('/internal/jobs/run', { method: 'POST', headers: { 'x-jobs-secret': secret } });

let area: string;
let rn2: TestUser;
let n = 0;
const nextDate = () => {
  n += 1;
  return new Date(Date.UTC(2032, 5, 1) + n * 86_400_000).toISOString().slice(0, 10);
};

async function publishedShift(employee: string) {
  const tree = (await call('GET', '/v1/locations', ids.managerA)).body;
  const rn = tree[0].areas.find((a: { id: string }) => a.id === area).assignments.find(
    (x: { requiredPosition: string }) => x.requiredPosition === 'RN',
  );
  const res = await call('POST', '/v1/shifts', ids.managerA, {
    areaId: area, assignmentId: rn.id, employeeId: employee, startTime: '07:00', endTime: '15:00', date: nextDate(), status: 'published',
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  api = await setupApi('shifthub_test_api_notifications', { jobsSecret: JOBS, pushSender: push.sender });
  area = (await call('GET', `/v1/members/${ids.staffA1.sub}/areas`, ids.managerA)).body.areaIds[0];
  const members = (await call('GET', `/v1/members?areaId=${area}`, ids.managerA)).body as { id: string; email: string; position: string; role: string }[];
  const r = members.find((m) => m.position === 'RN' && m.role === 'employee' && m.id !== ids.staffA1.sub)!;
  rn2 = { sub: r.id, email: r.email };
});
afterAll(async () => {
  await api?.close();
});

describe('notifications API', () => {
  it('lists my notifications with an unread count and marks them read', async () => {
    const mine = await publishedShift(ids.staffA1.sub);
    const theirs = await publishedShift(rn2.sub);
    await call('POST', '/v1/swaps', ids.staffA1, { myShiftId: mine, theirShiftId: theirs, note: 'pls' });

    const list = await call('GET', '/v1/notifications', rn2);
    expect(list.status).toBe(200);
    const swap = list.body.items.find((x: { type: string }) => x.type === 'swap_requested');
    expect(swap).toMatchObject({ title: 'Swap request', readAt: null });
    expect(list.body.unreadCount).toBeGreaterThanOrEqual(2); // new shift + swap request

    const one = await call('POST', '/v1/notifications/read', rn2, { ids: [swap.id] });
    expect(one.body.updated).toBe(1);
    const all = await call('POST', '/v1/notifications/read', rn2, {});
    expect(all.body.updated).toBe(list.body.unreadCount - 1);
    expect((await call('GET', '/v1/notifications?unreadOnly=true', rn2)).body).toEqual({ items: [], unreadCount: 0 });
  });

  it('registers and unregisters push tokens', async () => {
    expect((await call('POST', '/v1/push-tokens', rn2, { token: 'ExponentPushToken[rn2-phone]', platform: 'android' })).status).toBe(204);
    expect((await call('POST', '/v1/push-tokens', rn2, { token: 'x', platform: 'android' })).status).toBe(400);
    expect((await call('POST', '/v1/push-tokens/unregister', rn2, { token: 'ExponentPushToken[rn2-phone]' })).status).toBe(204);
  });

  it('audit log is for managers', async () => {
    const res = await call('GET', '/v1/audit?entityType=shifts&limit=5', ids.managerA);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ entityType: 'shifts', userName: 'Manager 1' });
    expect((await call('GET', '/v1/audit', rn2)).status).toBe(403);
  });
});

describe('jobs endpoint', () => {
  it('requires the secret', async () => {
    expect((await runJobs('wrong')).status).toBe(401);
  });

  it('delivers pending notifications to registered devices and skips people without one', async () => {
    await call('POST', '/v1/push-tokens', rn2, { token: 'ExponentPushToken[rn2-phone]', platform: 'ios' });
    const s = await publishedShift(ids.staffA1.sub);
    await call('POST', '/v1/offers', ids.staffA1, { shiftId: s, reason: 'trip' }); // notifies eligible RNs incl. rn2
    push.sent.length = 0;

    const res = await runJobs();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { push: { sent: number; skipped: number } };
    expect(body.push.sent).toBeGreaterThanOrEqual(1);
    expect(body.push.skipped).toBeGreaterThanOrEqual(1);
    const msg = push.sent.find((m) => m.to === 'ExponentPushToken[rn2-phone]' && m.title === 'Shift available');
    expect(msg?.body).toMatch(/is giving away/);
    expect(msg?.data.notificationId).toBeDefined();

    // nothing left to send on the next run
    push.sent.length = 0;
    const again = (await (await runJobs()).json()) as { push: { sent: number } };
    expect(again.push.sent).toBe(0);
  });

  it('is not mounted without a secret', async () => {
    const plain = await setupApi('shifthub_test_api_notifications_nojobs');
    expect((await plain.app.request('/internal/jobs/run', { method: 'POST' })).status).toBe(404);
    await plain.close();
  });
});

describe('Expo push sender', () => {
  it('batches by 100 and reports unregistered devices', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const batch = JSON.parse(init.body as string) as unknown[];
      return new Response(
        JSON.stringify({
          data: batch.map((_, i) =>
            i === 0 ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: String(i) },
          ),
        }),
        { status: 200 },
      );
    });
    const send = createExpoPushSender({ fetch: fetchMock as unknown as typeof fetch });
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: `ExponentPushToken[${i}]`, title: 't', body: 'b', data: {} }));
    const results = await send(msgs);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(150);
    expect(results[0]).toMatchObject({ ok: false, unregistered: true });
    expect(results[1]).toMatchObject({ ok: true });
  });

  it('marks a whole batch failed on HTTP errors', async () => {
    const send = createExpoPushSender({ fetch: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch });
    const results = await send([{ to: 'ExponentPushToken[a]', title: 't', body: 'b', data: {} }]);
    expect(results[0]).toMatchObject({ ok: false });
  });
});
