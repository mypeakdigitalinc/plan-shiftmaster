import type { Invitation, Organization, Profile } from '@shifthub/shared';

type Row = Record<string, any>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export const toProfile = (r: Row): Profile => ({
  id: r.id,
  organizationId: r.organization_id,
  email: r.email,
  name: r.name,
  phone: r.phone,
  photoUrl: r.photo_url,
  role: r.role,
  position: r.position,
  shareSchedule: r.share_schedule,
  status: r.status,
});

export const toOrganization = (r: Row, canSeeInviteCode: boolean): Organization => ({
  id: r.id,
  name: r.name,
  logoUrl: r.logo_url,
  timezone: r.timezone,
  status: r.status,
  settings: {
    mode: r.mode,
    requireApproval: r.require_approval,
    allowSwaps: r.allow_swaps,
    allowPickup: r.allow_pickup,
    allowSelfScheduling: r.allow_self_scheduling,
    inviteCode: canSeeInviteCode ? r.invite_code : null,
  },
});

export const toInvitation = (r: Row, includeToken = false): Invitation => ({
  id: r.id,
  email: r.email,
  role: r.role,
  position: r.position,
  expiresAt: iso(r.expires_at)!,
  acceptedAt: iso(r.accepted_at),
  ...(includeToken ? { token: r.token } : {}),
});
