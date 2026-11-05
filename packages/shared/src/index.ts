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
  id: z.uuid(),
  organizationId: z.uuid().nullable(),
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
  id: z.uuid(),
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
  id: z.uuid(),
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
