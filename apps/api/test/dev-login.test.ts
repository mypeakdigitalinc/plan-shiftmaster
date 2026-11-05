import { seedIds as ids } from '@shifthub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTokenVerifier } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { devUserId } from '../src/dev-login';
import { SECRET, setupApi } from './helpers';

let api: Awaited<ReturnType<typeof setupApi>>;
let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  api = await setupApi('shifthub_test_api_devlogin');
  await api.close();
  const base = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432';
  db = createDb(`${base}/shifthub_test_api_devlogin`, { max: 2 });
  app = createApp({ db, verifyToken: createTokenVerifier({ jwtSecret: SECRET }), devLoginSecret: SECRET });
});
afterAll(async () => {
  await db?.close();
});

const login = (email: string) =>
  app.request('/dev/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });

describe('dev login (enabled)', () => {
  it('returns a working token for a seeded user', async () => {
    const res = await login('Admin@MapleGrove.test');
    const { accessToken, userId } = (await res.json()) as { accessToken: string; userId: string };
    expect(userId).toBe(ids.adminA.sub);
    const me = await app.request('/v1/me', { headers: { authorization: `Bearer ${accessToken}` } });
    expect(((await me.json()) as { profile: { role: string } }).profile.role).toBe('org_admin');
  });

  it('gives new emails a stable id', async () => {
    const a = (await (await login('new@example.test')).json()) as { userId: string };
    expect(a.userId).toBe(devUserId('new@example.test'));
  });

  it('rejects invalid emails', async () => {
    expect((await login('nope')).status).toBe(400);
  });
});
