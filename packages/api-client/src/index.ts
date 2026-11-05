/**
 * Typed client for the ShiftHub API — the only way web and mobile reach backend data.
 * Swapping the backend (Supabase → AWS) does not change this interface.
 */
import type {
  ApiError,
  Approvals,
  CreateOfferInput,
  CreateSwapInput,
  MyTrades,
  Offer,
  OfferRequest,
  Swap,
  Area,
  Assignment,
  AvailabilitySlot,
  CreateAreaInput,
  CreateAssignmentInput,
  CopyWeekInput,
  CreateShiftInput,
  CreateShiftTemplateInput,
  ListShiftsQuery,
  PublishShiftsInput,
  Shift,
  UpdateShiftInput,
  CreateSiteInput,
  Locations,
  ShiftTemplate,
  Site,
  UpdateAreaInput,
  UpdateAssignmentInput,
  UpdateShiftTemplateInput,
  UpdateSiteInput,
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
      availability: () => request<{ slots: AvailabilitySlot[] }>('GET', '/v1/me/availability'),
      setAvailability: (slots: AvailabilitySlot[]) =>
        request<{ slots: AvailabilitySlot[] }>('PUT', '/v1/me/availability', { slots }),
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
      list: (params: { areaId?: string } = {}) =>
        request<Profile[]>('GET', `/v1/members${params.areaId ? `?areaId=${params.areaId}` : ''}`),
      update: (id: string, input: UpdateMemberInput) => request<Profile>('PATCH', `/v1/members/${id}`, input),
      areas: (id: string) => request<{ areaIds: string[] }>('GET', `/v1/members/${id}/areas`),
      setAreas: (id: string, areaIds: string[]) =>
        request<{ areaIds: string[] }>('PUT', `/v1/members/${id}/areas`, { areaIds }),
      availability: (id: string) => request<{ slots: AvailabilitySlot[] }>('GET', `/v1/members/${id}/availability`),
      areaAvailability: (areaId: string) =>
        request<{ employeeId: string; slots: AvailabilitySlot[] }[]>('GET', `/v1/availability?areaId=${areaId}`),
    },
    locations: {
      list: () => request<Locations>('GET', '/v1/locations'),
      createSite: (input: CreateSiteInput) => request<Site>('POST', '/v1/sites', input),
      updateSite: (id: string, input: UpdateSiteInput) => request<Site>('PATCH', `/v1/sites/${id}`, input),
      deleteSite: (id: string) => request<void>('DELETE', `/v1/sites/${id}`),
      createArea: (input: CreateAreaInput) => request<Area>('POST', '/v1/areas', input),
      updateArea: (id: string, input: UpdateAreaInput) => request<Area>('PATCH', `/v1/areas/${id}`, input),
      deleteArea: (id: string) => request<void>('DELETE', `/v1/areas/${id}`),
      createAssignment: (input: CreateAssignmentInput) => request<Assignment>('POST', '/v1/assignments', input),
      updateAssignment: (id: string, input: UpdateAssignmentInput) =>
        request<Assignment>('PATCH', `/v1/assignments/${id}`, input),
      deleteAssignment: (id: string) => request<void>('DELETE', `/v1/assignments/${id}`),
    },
    shifts: {
      list: (query: ListShiftsQuery) => {
        const qs = new URLSearchParams(
          Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][],
        ).toString();
        return request<Shift[]>('GET', `/v1/shifts?${qs}`);
      },
      get: (id: string) => request<Shift>('GET', `/v1/shifts/${id}`),
      create: (input: CreateShiftInput) => request<Shift>('POST', '/v1/shifts', input),
      update: (id: string, input: UpdateShiftInput) => request<Shift>('PATCH', `/v1/shifts/${id}`, input),
      remove: (id: string) => request<void>('DELETE', `/v1/shifts/${id}`),
      publish: (input: PublishShiftsInput) => request<{ published: number }>('POST', '/v1/shifts/publish', input),
      copyWeek: (input: CopyWeekInput) =>
        request<{ copied: number; unassigned: number }>('POST', '/v1/shifts/copy-week', input),
    },
    marketplace: {
      list: (opts: { eligibleOnly?: boolean } = {}) =>
        request<Offer[]>('GET', `/v1/marketplace${opts.eligibleOnly ? '?eligibleOnly=true' : ''}`),
      offer: (input: CreateOfferInput) => request<Offer>('POST', '/v1/offers', input),
      cancelOffer: (offerId: string) => request<void>('DELETE', `/v1/offers/${offerId}`),
      requests: (offerId: string) => request<OfferRequest[]>('GET', `/v1/offers/${offerId}/requests`),
      requestShift: (offerId: string, note?: string) =>
        request<OfferRequest>('POST', `/v1/offers/${offerId}/requests`, { note: note ?? null }),
      withdraw: (requestId: string) => request<void>('DELETE', `/v1/offer-requests/${requestId}`),
      decide: (requestId: string, approve: boolean) =>
        request<OfferRequest>('POST', `/v1/offer-requests/${requestId}/decision`, { approve }),
    },
    swaps: {
      list: (scope: 'mine' | 'org' = 'mine') => request<Swap[]>('GET', `/v1/swaps?scope=${scope}`),
      propose: (input: CreateSwapInput) => request<Swap>('POST', '/v1/swaps', input),
      respond: (swapId: string, accept: boolean) => request<Swap>('POST', `/v1/swaps/${swapId}/response`, { accept }),
      decide: (swapId: string, approve: boolean) => request<Swap>('POST', `/v1/swaps/${swapId}/decision`, { approve }),
      cancel: (swapId: string) => request<void>('DELETE', `/v1/swaps/${swapId}`),
    },
    trades: {
      mine: () => request<MyTrades>('GET', '/v1/me/trades'),
      approvals: () => request<Approvals>('GET', '/v1/approvals'),
    },
    shiftTemplates: {
      list: () => request<ShiftTemplate[]>('GET', '/v1/shift-templates'),
      create: (input: CreateShiftTemplateInput) => request<ShiftTemplate>('POST', '/v1/shift-templates', input),
      update: (id: string, input: UpdateShiftTemplateInput) =>
        request<ShiftTemplate>('PATCH', `/v1/shift-templates/${id}`, input),
      remove: (id: string) => request<void>('DELETE', `/v1/shift-templates/${id}`),
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
