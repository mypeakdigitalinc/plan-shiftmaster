/**
 * Typed client for the ShiftHub API — the only way web and mobile reach backend data.
 * Swapping the backend (Supabase → AWS) does not change this interface.
 */
import type {
  ApiError,
  CreateInvitationInput,
  CreateOrganizationInput,
  Invitation,
  Me,
  Organization,
  Profile,
  UpdateMeInput,
  UpdateMemberInput,
  UpdateOrgSettingsInput,
} from '@shifthub/shared';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
};

export function createApiClient({ baseUrl, getAccessToken, fetch: f = fetch }: ApiClientOptions) {
  const base = baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getAccessToken();
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (data as ApiError | null)?.error;
      throw new ApiClientError(res.status, err?.code ?? 'http_error', err?.message ?? res.statusText);
    }
    return data as T;
  }

  return {
    health: () => request<{ ok: boolean }>('GET', '/health'),
    me: {
      get: () => request<Me>('GET', '/v1/me'),
      update: (input: UpdateMeInput) => request<Profile>('PATCH', '/v1/me', input),
    },
    onboarding: {
      createOrganization: (input: CreateOrganizationInput) => request<Me>('POST', '/v1/organizations', input),
      join: (inviteCode: string) => request<Me>('POST', '/v1/organizations/join', { inviteCode }),
      acceptInvitation: (token: string) => request<Me>('POST', '/v1/invitations/accept', { token }),
    },
    organization: {
      get: () => request<Organization>('GET', '/v1/organization'),
      update: (input: { name?: string; timezone?: string; logoUrl?: string | null }) =>
        request<Organization>('PATCH', '/v1/organization', input),
      updateSettings: (input: UpdateOrgSettingsInput) =>
        request<Organization>('PATCH', '/v1/organization/settings', input),
      rotateInviteCode: () => request<{ inviteCode: string }>('POST', '/v1/organization/invite-code/rotate'),
    },
    members: {
      list: () => request<Profile[]>('GET', '/v1/members'),
      update: (id: string, input: UpdateMemberInput) => request<Profile>('PATCH', `/v1/members/${id}`, input),
    },
    invitations: {
      list: () => request<Invitation[]>('GET', '/v1/invitations'),
      create: (input: CreateInvitationInput) =>
        request<Invitation & { link: string }>('POST', '/v1/invitations', input),
      revoke: (id: string) => request<void>('DELETE', `/v1/invitations/${id}`),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
