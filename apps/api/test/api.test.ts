import { randomUUID } from 'node:crypto';
import { createTestDatabase, seedIds as ids } from '@shifthub/db/testing';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTokenVerifier } from '../src/auth';
import { createDb, type Db } from '../src/db';

const SECRET = 'test-secret-test-secret-test-secret-123';
const DB_NAME = 'shifthub_test_api';
const baseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const setup = await createTestDatabase(DB_NAME, { seed: true });
  await setup.end();
  db = createDb(`${baseUrl}/${DB_NAME}`, { max: 3 });
  app = createApp({ db, verifyToken: createTokenVerifier({ jwtSecret: SECRET, audience: 'authenticated' }) });
});
afterAll(async () => {
  await db?.close();
});

const token = (u: { sub: string; email: string }, secret = SECRET) =>
  new SignJWT({ email: u.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(u.sub)
    .setAudience('authenticated')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));

async function call(method: string, path: string, user?: { sub: string; email: string }, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) headers.authorization = `Bearer ${await token(user)}`;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const newUser = () => {
  const sub = randomUUID();
  return { sub, email: `${sub.slice(0, 8)}@example.test` };
};

describe('auth', () => {
  it('rejects requests without a token', async () => {
    const res = await call('GET', '/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects tokens signed with the wrong secret', async () => {
    const bad = await token(ids.staffA1, 'some-other-secret-some-other-secret-1');
    const res = await app.request('/v1/me', { headers: { authorization: `Bearer ${bad}` } });
    expect(res.status).toBe(401);
  });

  it('health and docs are public', async () => {
    expect((await call('GET', '/health')).body).toEqual({ ok: true });
    const spec = await call('GET', '/openapi.json');
    expect(spec.body.paths['/v1/me']).toBeDefined();
    expect((await app.request('/docs')).status).toBe(200);
  });
});

describe('me', () => {
  it('returns profile and organization for a seeded employee, hiding the facility invite code', async () => {
    const res = await call('GET', '/v1/me', ids.staffA1);
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ email: ids.staffA1.email, role: 'employee', position: 'RN' });
    expect(res.body.organization).toMatchObject({ id: ids.orgA, settings: { mode: 'facility', inviteCode: null } });
  });

  it('shows the invite code to managers, and to everyone in group mode', async () => {
    expect((await call('GET', '/v1/me', ids.managerA)).body.organization.settings.inviteCode).toBe('MAPLE00001');
    expect((await call('GET', '/v1/me', ids.owlB2)).body.organization.settings.inviteCode).toBe('OWLS000002');
  });

  it('a brand-new user gets a profile with no organization', async () => {
    const u = newUser();
    const res = await call('GET', '/v1/me', u);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ profile: { id: u.sub, organizationId: null }, organization: null });
  });

  it('updates own sharing preference and validates input', async () => {
    const ok = await call('PATCH', '/v1/me', ids.staffA2, { shareSchedule: true, name: 'Robin' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ shareSchedule: true, name: 'Robin' });
    expect((await call('PATCH', '/v1/me', ids.staffA2, {})).status).toBe(400);
    expect((await call('PATCH', '/v1/me', ids.staffA2, { shareSchedule: 'yes' })).status).toBe(400);
  });
});

describe('onboarding', () => {
  it('creates a group organization and makes the caller admin', async () => {
    const u = newUser();
    const res = await call('POST', '/v1/organizations', u, { name: 'Weekend Warriors', mode: 'group' });
    expect(res.status).toBe(201);
    expect(res.body.profile).toMatchObject({ role: 'org_admin', shareSchedule: true });
    expect(res.body.organization.settings).toMatchObject({ mode: 'group', requireApproval: false, allowSelfScheduling: true });
    expect(res.body.organization.settings.inviteCode).toMatch(/^[0-9A-F]{10}$/);

    // a second create is rejected
    expect((await call('POST', '/v1/organizations', u, { name: 'Again' })).status).toBe(409);
  });

  it('joins with an invite code', async () => {
    const u = newUser();
    const res = await call('POST', '/v1/organizations/join', u, { inviteCode: 'owls000002' });
    expect(res.status).toBe(200);
    expect(res.body.organization.id).toBe(ids.orgB);
    expect((await call('POST', '/v1/organizations/join', newUser(), { inviteCode: 'WRONGCODE' })).status).toBe(404);
  });

  it('invite by email → accept', async () => {
    const u = newUser();
    const created = await call('POST', '/v1/invitations', ids.managerA, { email: u.email, position: 'PSW' });
    expect(created.status).toBe(201);
    expect(created.body.link).toContain(created.body.token);

    const list = await call('GET', '/v1/invitations', ids.managerA);
    expect(list.body.some((i: { email: string; token?: string }) => i.email === u.email && !i.token)).toBe(true);

    const accepted = await call('POST', '/v1/invitations/accept', u, { token: created.body.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.profile).toMatchObject({ organizationId: ids.orgA, role: 'employee', position: 'PSW' });
  });

  it('accept with a token for another email is forbidden', async () => {
    const res = await call('POST', '/v1/invitations/accept', newUser(), { token: 'dev-invite-token-newhire' });
    expect(res.status).toBe(403);
  });

  it('employees cannot invite or list invitations', async () => {
    expect((await call('POST', '/v1/invitations', ids.staffA1, { email: 'x@example.test' })).status).toBe(403);
    expect((await call('GET', '/v1/invitations', ids.staffA1)).status).toBe(403);
  });

  it('revokes an invitation', async () => {
    const created = await call('POST', '/v1/invitations', ids.managerA, { email: 'revoke-me@example.test' });
    expect((await call('DELETE', `/v1/invitations/${created.body.id}`, ids.managerA)).status).toBe(204);
    expect((await call('DELETE', `/v1/invitations/${created.body.id}`, ids.managerA)).status).toBe(404);
  });
});

describe('organization & members', () => {
  it('user without an organization gets 409 on org endpoints', async () => {
    const u = newUser();
    await call('GET', '/v1/me', u);
    expect((await call('GET', '/v1/members', u)).status).toBe(409);
  });

  it('lists only members of my organization', async () => {
    const res = await call('GET', '/v1/members', ids.adminB);
    expect(res.status).toBe(200);
    expect(res.body.every((p: { organizationId: string }) => p.organizationId === ids.orgB)).toBe(true);
  });

  it('only admins update settings', async () => {
    expect((await call('PATCH', '/v1/organization/settings', ids.staffA1, { allowSwaps: false })).status).toBe(403);
    expect((await call('PATCH', '/v1/organization/settings', ids.managerA, { allowSwaps: false })).status).toBe(403);
    const ok = await call('PATCH', '/v1/organization/settings', ids.adminA, { allowSwaps: false });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.allowSwaps).toBe(false);
  });

  it('validates organization timezone', async () => {
    expect((await call('PATCH', '/v1/organization', ids.adminA, { timezone: 'Nowhere/Land' })).status).toBe(400);
    const ok = await call('PATCH', '/v1/organization', ids.adminA, { timezone: 'America/Halifax' });
    expect(ok.body.timezone).toBe('America/Halifax');
  });

  it('admin changes a member role; employee cannot', async () => {
    const target = '00000000-0000-4000-b000-000000000010';
    expect((await call('PATCH', `/v1/members/${target}`, ids.staffA1, { role: 'manager' })).status).toBe(404);
    const ok = await call('PATCH', `/v1/members/${target}`, ids.adminA, { role: 'manager' });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('manager');
  });

  it('admin of org B cannot edit org A members', async () => {
    const res = await call('PATCH', `/v1/members/${ids.staffA1.sub}`, ids.adminB, { position: 'RN' });
    expect(res.status).toBe(404);
  });

  it('rotates the invite code (admin only)', async () => {
    expect((await call('POST', '/v1/organization/invite-code/rotate', ids.owlB2)).status).toBe(403);
    const res = await call('POST', '/v1/organization/invite-code/rotate', ids.adminB);
    expect(res.status).toBe(200);
    expect(res.body.inviteCode).not.toBe('OWLS000002');
  });
});
