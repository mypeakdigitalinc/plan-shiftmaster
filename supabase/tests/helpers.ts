import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432';

export type Sql = postgres.Sql;

/** Drop + recreate a database, apply all migrations (and optionally the seed). */
export async function createTestDatabase(name: string, opts: { seed?: boolean } = {}): Promise<Sql> {
  const admin = postgres(`${baseUrl}/postgres`, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();

  // Single connection for applying files: they may contain their own BEGIN/COMMIT.
  const setup = postgres(`${baseUrl}/${name}`, { max: 1, onnotice: () => {} });
  const migrations = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    await setup.unsafe(readFileSync(join(root, 'migrations', file), 'utf8'));
  }
  if (opts.seed) {
    await setup.unsafe(readFileSync(join(root, 'seed.sql'), 'utf8'));
  }
  await setup.end();
  return postgres(`${baseUrl}/${name}`, { max: 5, onnotice: () => {} });
}

export type Claims = { sub: string; email: string; [k: string]: unknown };

/** Run `fn` inside a transaction as the `authenticated` role with the given JWT claims. */
export async function asUser<T>(sql: Sql, claims: Claims, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', ...claims })}, true)`;
    return fn(tx);
  })) as T;
}

export const seedIds = {
  orgA: '00000000-0000-4000-a000-000000000001',
  orgB: '00000000-0000-4000-a000-000000000002',
  adminA: { sub: '00000000-0000-4000-b000-000000000001', email: 'admin@maplegrove.test' },
  managerA: { sub: '00000000-0000-4000-b000-000000000002', email: 'manager1@maplegrove.test' },
  staffA1: { sub: '00000000-0000-4000-b000-000000000006', email: 'staff1@maplegrove.test' },
  staffA2: { sub: '00000000-0000-4000-b000-000000000007', email: 'staff2@maplegrove.test' },
  adminB: { sub: '00000000-0000-4000-c000-000000000001', email: 'owl1@nightowls.test' },
  owlB2: { sub: '00000000-0000-4000-c000-000000000002', email: 'owl2@nightowls.test' },
  siteA: '00000000-0000-4000-d000-000000000001',
  siteB: '00000000-0000-4000-d000-000000000002',
  areaA1: '00000000-0000-4000-e000-000000000001',
  areaA2: '00000000-0000-4000-e000-000000000002',
  areaB: '00000000-0000-4000-e000-000000000004',
};
