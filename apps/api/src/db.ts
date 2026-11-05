/**
 * Database access. Every request runs in a transaction as the `authenticated`
 * role with the caller's claims set, so Postgres RLS enforces tenant isolation.
 * Works the same on Supabase (pooler) and AWS RDS.
 */
import postgres from 'postgres';
import type { AuthUser } from './auth';

export type Tx = postgres.TransactionSql;
export type Db = {
  asUser<T>(user: AuthUser, fn: (tx: Tx) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

export function createDb(databaseUrl: string, opts: { max?: number } = {}): Db {
  const sql = postgres(databaseUrl, {
    max: opts.max ?? 10,
    prepare: false, // required for Supabase transaction pooler (pgbouncer)
    onnotice: () => {},
  });

  return {
    async asUser(user, fn) {
      const claims = JSON.stringify({ sub: user.sub, email: user.email, role: 'authenticated' });
      return (await sql.begin(async (tx) => {
        await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claims}, true)`;
        return fn(tx);
      })) as Awaited<ReturnType<typeof fn>>;
    },
    async ping() {
      await sql`select 1`;
      return true;
    },
    close: () => sql.end(),
  };
}
