/**
 * DEV ONLY: email-only login that mints HS256 tokens, so the web/mobile apps can be
 * used locally before a real auth provider (Supabase/Cognito) is configured.
 * Enabled only when DEV_LOGIN=true, AUTH_JWT_SECRET is set and NODE_ENV !== 'production'.
 */
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Db } from './db';
import { HttpError } from './errors';

/** Stable pseudo-UUID for an email, so the same email always gets the same user id. */
export const devUserId = (email: string) => {
  const h = createHash('sha256').update(`shifthub-dev:${email}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function devLoginRoutes(db: Db, secret: string) {
  const app = new Hono();
  app.post('/dev/token', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, 'bad_request', 'A valid email is required');
    }
    const sub = (await db.findProfileIdByEmail(email)) ?? devUserId(email);
    const token = await new SignJWT({ email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(new TextEncoder().encode(secret));
    return c.json({ accessToken: token, userId: sub, email });
  });
  return app;
}
