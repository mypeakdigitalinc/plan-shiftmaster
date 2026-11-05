import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Map Postgres SQLSTATE codes raised by our SQL functions/policies to HTTP errors. */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const pg = err as { code?: string; message?: string; name?: string };
  if (pg?.name === 'PostgresError' && pg.code) {
    const msg = pg.message ?? 'Database error';
    switch (pg.code) {
      case '42501':
        return new HttpError(403, 'forbidden', msg);
      case 'P0002':
        return new HttpError(404, 'not_found', msg);
      case '22023':
      case '22P02':
      case '23514':
        return new HttpError(400, 'bad_request', msg);
      case '23505':
        return new HttpError(409, 'conflict', 'Already exists');
      case '55000':
        return new HttpError(409, 'conflict', msg);
    }
  }
  console.error(err);
  return new HttpError(500, 'internal', 'Internal server error');
}
