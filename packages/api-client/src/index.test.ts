import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient } from './index';

describe('api client', () => {
  it('sends the bearer token and parses JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createApiClient({ baseUrl: 'http://api/', getAccessToken: async () => 'tok', fetch: fetchMock });
    await expect(api.health()).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/health');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('turns API errors into ApiClientError', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'nope' } }), { status: 403 }),
    );
    const api = createApiClient({ baseUrl: 'http://api', getAccessToken: async () => null, fetch: fetchMock });
    const err = await api.members.list().catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 403, code: 'forbidden', message: 'nope' });
  });
});
