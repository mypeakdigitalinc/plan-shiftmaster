import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '@shifthub/db/testing';
import { SignJWT } from 'jose';
import { createApp } from '../src/app';
import { createTokenVerifier } from '../src/auth';
import { createDb } from '../src/db';

export const SECRET = 'test-secret-test-secret-test-secret-123';
const baseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432';

export type TestUser = { sub: string; email: string };

export const signToken = (u: TestUser, secret = SECRET) =>
  new SignJWT({ email: u.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(u.sub)
    .setAudience('authenticated')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));

export const newUser = (): TestUser => {
  const sub = randomUUID();
  return { sub, email: `${sub.slice(0, 8)}@example.test` };
};

/** Fresh seeded database + app; returns a `call` helper. */
export async function setupApi(dbName: string) {
  const setup = await createTestDatabase(dbName, { seed: true });
  await setup.end();
  const db = createDb(`${baseUrl}/${dbName}`, { max: 3 });
  const app = createApp({ db, verifyToken: createTokenVerifier({ jwtSecret: SECRET, audience: 'authenticated' }) });

  async function call(method: string, path: string, user?: TestUser, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user) headers.authorization = `Bearer ${await signToken(user)}`;
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  return { app, call, close: () => db.close() };
}
