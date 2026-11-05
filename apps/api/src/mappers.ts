import type {
  Area,
  Assignment,
  AvailabilitySlot,
  Invitation,
  Organization,
  Profile,
  ShiftTemplate,
  Site,
} from '@shifthub/shared';

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

// ---------- D2 ----------

/** Postgres `time` → "HH:MM" ("24:00:00" stays "24:00"). */
export const hhmm = (v: unknown) => String(v).slice(0, 5);

export const toSite = (r: Row): Site => ({
  id: r.id,
  name: r.name,
  code: r.code,
  address: r.address,
  phone: r.phone,
  timezone: r.timezone,
  status: r.status,
});

export const toArea = (r: Row): Area => ({
  id: r.id,
  siteId: r.site_id,
  name: r.name,
  description: r.description,
  status: r.status,
});

export const toAssignment = (r: Row): Assignment => ({
  id: r.id,
  areaId: r.area_id,
  name: r.name,
  code: r.code,
  requiredPosition: r.required_position,
  displayOrder: r.display_order,
  status: r.status,
});

export const toShiftTemplate = (r: Row): ShiftTemplate => ({
  id: r.id,
  name: r.name,
  startTime: hhmm(r.start_time),
  endTime: hhmm(r.end_time),
  color: r.color,
  isDefault: r.is_default,
  active: r.active,
  overnight: hhmm(r.end_time) < hhmm(r.start_time),
});

export const toAvailability = (r: Row): AvailabilitySlot => ({
  weekday: r.weekday,
  startTime: hhmm(r.start_time),
  endTime: hhmm(r.end_time),
  note: r.note,
});
