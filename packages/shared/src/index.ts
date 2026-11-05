/**
 * Shared schemas and types used by the API, web portal and mobile app.
 * The API turns these into its OpenAPI spec, so they are the single source of truth.
 */
import { z } from 'zod';

export const userRole = z.enum(['employee', 'manager', 'org_admin']);
export const orgMode = z.enum(['facility', 'group']);
export const recordStatus = z.enum(['active', 'inactive']);

export type UserRole = z.infer<typeof userRole>;
export type OrgMode = z.infer<typeof orgMode>;

// ---------- Entities (API response shapes, camelCase) ----------

export const profile = z.object({
  id: z.guid(),
  organizationId: z.guid().nullable(),
  email: z.email(),
  name: z.string(),
  phone: z.string().nullable(),
  photoUrl: z.string().nullable(),
  role: userRole,
  position: z.string().nullable(),
  shareSchedule: z.boolean(),
  status: recordStatus,
});
export type Profile = z.infer<typeof profile>;

export const orgSettings = z.object({
  mode: orgMode,
  requireApproval: z.boolean(),
  allowSwaps: z.boolean(),
  allowPickup: z.boolean(),
  allowSelfScheduling: z.boolean(),
  /** Only returned to managers/admins. */
  inviteCode: z.string().nullable(),
});
export type OrgSettings = z.infer<typeof orgSettings>;

export const organization = z.object({
  id: z.guid(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  timezone: z.string(),
  status: recordStatus,
  settings: orgSettings,
});
export type Organization = z.infer<typeof organization>;

export const me = z.object({
  profile,
  organization: organization.nullable(),
});
export type Me = z.infer<typeof me>;

export const invitation = z.object({
  id: z.guid(),
  email: z.email(),
  role: userRole,
  position: z.string().nullable(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  /** Present only in the create response. */
  token: z.string().optional(),
});
export type Invitation = z.infer<typeof invitation>;

export const apiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiError>;

// ---------- Inputs ----------

export const createOrganizationInput = z.object({
  name: z.string().trim().min(2).max(120),
  mode: orgMode.default('facility'),
  timezone: z.string().default('America/Toronto'),
});
export type CreateOrganizationInput = z.input<typeof createOrganizationInput>;

export const joinOrganizationInput = z.object({
  inviteCode: z.string().trim().min(4).max(32),
});

export const updateMeInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(32).nullable(),
    shareSchedule: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateMeInput = z.input<typeof updateMeInput>;

export const updateOrganizationInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string(),
    logoUrl: z.url().nullable(),
  })
  .partial();

export const updateOrgSettingsInput = z
  .object({
    requireApproval: z.boolean(),
    allowSwaps: z.boolean(),
    allowPickup: z.boolean(),
    allowSelfScheduling: z.boolean(),
  })
  .partial();
export type UpdateOrgSettingsInput = z.input<typeof updateOrgSettingsInput>;

export const updateMemberInput = z
  .object({
    role: userRole,
    status: recordStatus,
    position: z.string().trim().max(60).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateMemberInput = z.input<typeof updateMemberInput>;

export const createInvitationInput = z.object({
  email: z.email(),
  role: userRole.default('employee'),
  position: z.string().trim().max(60).nullable().optional(),
});
export type CreateInvitationInput = z.input<typeof createInvitationInput>;

export const acceptInvitationInput = z.object({ token: z.string().min(16).max(128) });

// =====================================================================
// D2 — Org structure
// =====================================================================

/** "HH:MM" 24h clock. */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
/** "HH:MM", also allows "24:00" for end-of-day. */
export const timeOfDayOrEnd = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use HH:MM (24h) or 24:00');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB');
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const assignment = z.object({
  id: z.guid(),
  areaId: z.guid(),
  name: z.string(),
  code: z.string().nullable(),
  requiredPosition: z.string().nullable(),
  displayOrder: z.number().int(),
  status: recordStatus,
});
export type Assignment = z.infer<typeof assignment>;

export const area = z.object({
  id: z.guid(),
  siteId: z.guid(),
  name: z.string(),
  description: z.string().nullable(),
  status: recordStatus,
});
export type Area = z.infer<typeof area>;

export const site = z.object({
  id: z.guid(),
  name: z.string(),
  code: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string().nullable(),
  status: recordStatus,
});
export type Site = z.infer<typeof site>;

/** Sites → areas → assignments, for the Locations screen and pickers. */
export const locations = z.array(
  site.extend({ areas: z.array(area.extend({ assignments: z.array(assignment) })) }),
);
export type Locations = z.infer<typeof locations>;

export const shiftTemplate = z.object({
  id: z.guid(),
  name: z.string(),
  startTime: timeOfDay,
  endTime: timeOfDay,
  color: z.string(),
  isDefault: z.boolean(),
  active: z.boolean(),
  /** true when the shift ends the next day (e.g. 23:00–07:00). */
  overnight: z.boolean(),
});
export type ShiftTemplate = z.infer<typeof shiftTemplate>;

export const availabilitySlot = z.object({
  weekday: z.number().int().min(0).max(6).describe('0 = Sunday'),
  startTime: timeOfDay,
  endTime: timeOfDayOrEnd,
  note: z.string().max(200).nullable().optional(),
});
export type AvailabilitySlot = z.infer<typeof availabilitySlot>;

// ---------- Inputs ----------

export const createSiteInput = z.object({
  name: z.string().trim().min(1).max(120),
  code: optText(20),
  address: optText(300),
  phone: optText(32),
  timezone: z.string().nullable().optional(),
});
export const updateSiteInput = createSiteInput.partial().extend({ status: recordStatus.optional() });
export type CreateSiteInput = z.input<typeof createSiteInput>;
export type UpdateSiteInput = z.input<typeof updateSiteInput>;

export const createAreaInput = z.object({
  siteId: z.guid(),
  name: z.string().trim().min(1).max(120),
  description: optText(500),
});
export const updateAreaInput = createAreaInput.omit({ siteId: true }).partial().extend({ status: recordStatus.optional() });
export type CreateAreaInput = z.input<typeof createAreaInput>;
export type UpdateAreaInput = z.input<typeof updateAreaInput>;

export const createAssignmentInput = z.object({
  areaId: z.guid(),
  name: z.string().trim().min(1).max(120),
  code: optText(20),
  requiredPosition: optText(60),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
});
export const updateAssignmentInput = createAssignmentInput
  .omit({ areaId: true })
  .partial()
  .extend({ status: recordStatus.optional() });
export type CreateAssignmentInput = z.input<typeof createAssignmentInput>;
export type UpdateAssignmentInput = z.input<typeof updateAssignmentInput>;

export const createShiftTemplateInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    startTime: timeOfDay,
    endTime: timeOfDay,
    color: hexColor.optional(),
  })
  .refine((v) => v.startTime !== v.endTime, 'Start and end cannot be the same');
export const updateShiftTemplateInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    startTime: timeOfDay,
    endTime: timeOfDay,
    color: hexColor,
    active: z.boolean(),
  })
  .partial();
export type CreateShiftTemplateInput = z.input<typeof createShiftTemplateInput>;
export type UpdateShiftTemplateInput = z.input<typeof updateShiftTemplateInput>;

export const setAvailabilityInput = z.object({
  slots: z
    .array(availabilitySlot)
    .max(50)
    .refine((slots) => slots.every((s) => s.startTime < s.endTime), 'Each slot must end after it starts'),
});
export type SetAvailabilityInput = z.input<typeof setAvailabilityInput>;

export const setMemberAreasInput = z.object({ areaIds: z.array(z.guid()).max(200) });
