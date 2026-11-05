/**
 * Mint a local dev JWT (HS256) for testing the API without a real auth provider.
 *   pnpm --filter @shifthub/api token admin@maplegrove.test
 * Seeded user ids are looked up from the database; unknown emails get a new random id.
 */
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import postgres from 'postgres';

const email = (process.argv[2] ?? 'admin@maplegrove.test').toLowerCase();
const secret = process.env.AUTH_JWT_SECRET ?? 'local-dev-secret-change-me-at-least-32-chars';
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/shifthub', { max: 1 });
const [row] = await sql`select id from app.profiles where email = ${email}`.catch(() => []);
await sql.end();

const token = await new SignJWT({ email, role: 'authenticated' })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(row?.id ?? randomUUID())
  .setAudience('authenticated')
  .setIssuedAt()
  .setExpirationTime('12h')
  .sign(new TextEncoder().encode(secret));

console.log(token);
