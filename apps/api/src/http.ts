/** Shared OpenAPI route helpers. */
import { z } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { apiError } from '@shifthub/shared';
import type { AuthUser } from './auth';
import type { Tx } from './db';
import { HttpError } from './errors';

export type Env = { Variables: { user: AuthUser } };
export type Api = OpenAPIHono<Env>;
export type Run = <T>(c: { get: (k: 'user') => AuthUser }, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
export const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
export const errors = {
  400: json(apiError, 'Invalid input'),
  401: json(apiError, 'Missing or invalid token'),
  403: json(apiError, 'Not allowed'),
  404: json(apiError, 'Not found'),
  409: json(apiError, 'Conflict'),
};
export const secured = [{ bearerAuth: [] }];
export const idParam = z.object({ id: z.guid() });

/** camelCase keys → snake_case, dropping undefined. */
export const snake = (o: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]),
  );

export async function requireOrg(tx: Tx): Promise<string> {
  const [row] = await tx`select app.current_org_id() as org`;
  if (!row?.org) throw new HttpError(409, 'no_organization', 'Create or join an organization first');
  return row.org as string;
}

export async function requireManager(tx: Tx): Promise<string> {
  const org = await requireOrg(tx);
  const [row] = await tx`select app.is_manager() as ok`;
  if (!row?.ok) throw new HttpError(403, 'forbidden', 'Only managers can do this');
  return org;
}

export async function isManager(tx: Tx): Promise<boolean> {
  const [row] = await tx`select app.is_manager() as ok`;
  return Boolean(row?.ok);
}

export async function assertTimezone(tx: Tx, tz: string | null | undefined) {
  if (!tz) return;
  const [row] = await tx`select 1 from pg_timezone_names where name = ${tz}`;
  if (!row) throw new HttpError(400, 'bad_request', `Unknown timezone ${tz}`);
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
