import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import {
  acceptInvitationInput,
  createInvitationInput,
  createOrganizationInput,
  invitation,
  joinOrganizationInput,
  me,
  organization,
  profile,
  updateMeInput,
  updateMemberInput,
  updateOrganizationInput,
  updateOrgSettingsInput,
  type Organization,
} from '@shifthub/shared';
import { devLoginRoutes } from './dev-login';
import { AuthError, type AuthUser, type VerifyToken } from './auth';
import type { Db, Tx } from './db';
import { HttpError, toHttpError } from './errors';
import {
  assertTimezone,
  body,
  errors,
  idParam,
  isManager,
  json,
  requireOrg,
  secured,
  snake,
  type Env,
  type Run,
} from './http';
import { toInvitation, toOrganization, toProfile } from './mappers';
import { registerShiftRoutes } from './routes/shifts';
import { registerStructureRoutes } from './routes/structure';

export type AppDeps = {
  db: Db;
  verifyToken: VerifyToken;
  corsOrigins?: string[];
  appUrl?: string;
  /** DEV ONLY — HS256 secret to enable POST /dev/token. Never set in production. */
  devLoginSecret?: string;
};

// ---------- shared queries ----------
async function loadOrganization(tx: Tx): Promise<Organization | null> {
  const [row] = await tx`
    select o.*, s.mode, s.require_approval, s.allow_swaps, s.allow_pickup,
           s.allow_self_scheduling, s.invite_code, app.is_manager() as is_manager
    from app.organizations o
    join app.org_settings s on s.organization_id = o.id
    where o.id = app.current_org_id()`;
  if (!row) return null;
  return toOrganization(row, row.is_manager || row.mode === 'group');
}

async function loadMe(tx: Tx) {
  const [p] = await tx`select * from app.ensure_profile()`;
  return { profile: toProfile(p!), organization: await loadOrganization(tx) };
}

// ---------- app ----------
export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
        return c.json({ error: { code: 'bad_request', message } }, 400);
      }
    },
  });

  app.use('*', cors({ origin: deps.corsOrigins ?? ['http://localhost:3000'], credentials: true }));

  if (deps.devLoginSecret) {
    app.route('/', devLoginRoutes(deps.db, deps.devLoginSecret));
  }

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));

  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json({ error: { code: 'unauthorized', message: err.message } }, 401);
    const e = toHttpError(err);
    return c.json({ error: { code: e.code, message: e.message } }, e.status);
  });

  app.use('/v1/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AuthError('Missing bearer token');
    c.set('user', await deps.verifyToken(token));
    await next();
  });

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  const run: Run = (c, fn) => deps.db.asUser(c.get('user'), fn);

  // ----- health -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/health',
      tags: ['System'],
      responses: { 200: json(z.object({ ok: z.boolean() }), 'Service is healthy') },
    }),
    async (c) => c.json({ ok: await deps.db.ping() }, 200),
  );

  // ----- me -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me',
      tags: ['Me'],
      summary: 'Current user, their organization and settings (creates the profile on first call)',
      security: secured,
      responses: { 200: json(me, 'Current user'), 401: errors[401] },
    }),
    async (c) => c.json(await run(c, loadMe), 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/me',
      tags: ['Me'],
      summary: 'Update own name, phone or schedule-sharing preference',
      security: secured,
      request: body(updateMeInput),
      responses: { 200: json(profile, 'Updated profile'), 400: errors[400], 401: errors[401] },
    }),
    async (c) => {
      const input = snake(c.req.valid('json'));
      const user = c.get('user');
      const row = await run(c, async (tx) => {
        await tx`select app.ensure_profile()`;
        const [r] = await tx`update app.profiles set ${tx(input)} where id = ${user.sub} returning *`;
        return r;
      });
      return c.json(toProfile(row!), 200);
    },
  );

  // ----- organizations (onboarding) -----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/organizations',
      tags: ['Onboarding'],
      summary: 'Create an organization (facility or group); caller becomes Org Admin',
      security: secured,
      request: body(createOrganizationInput),
      responses: { 201: json(me, 'Created'), 400: errors[400], 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const { name, mode, timezone } = c.req.valid('json');
      const result = await run(c, async (tx) => {
        await tx`select app.ensure_profile()`;
        await tx`select app.create_organization(${name}, ${mode}::app.org_mode, ${timezone})`;
        return loadMe(tx);
      });
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/organizations/join',
      tags: ['Onboarding'],
      summary: 'Join an organization with its invite code',
      security: secured,
      request: body(joinOrganizationInput),
      responses: { 200: json(me, 'Joined'), 400: errors[400], 401: errors[401], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const { inviteCode } = c.req.valid('json');
      const result = await run(c, async (tx) => {
        await tx`select app.ensure_profile()`;
        await tx`select app.join_organization(${inviteCode})`;
        return loadMe(tx);
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/invitations/accept',
      tags: ['Onboarding'],
      summary: 'Accept an email invitation',
      security: secured,
      request: body(acceptInvitationInput),
      responses: {
        200: json(me, 'Accepted'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
        409: errors[409],
      },
    }),
    async (c) => {
      const { token } = c.req.valid('json');
      const result = await run(c, async (tx) => {
        await tx`select app.ensure_profile()`;
        await tx`select app.accept_invitation(${token})`;
        return loadMe(tx);
      });
      return c.json(result, 200);
    },
  );

  // ----- organization -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/organization',
      tags: ['Organization'],
      security: secured,
      responses: { 200: json(organization, 'Organization'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const org = await run(c, async (tx) => {
        await requireOrg(tx);
        return loadOrganization(tx);
      });
      return c.json(org!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/organization',
      tags: ['Organization'],
      summary: 'Update organization details (Org Admin)',
      security: secured,
      request: body(updateOrganizationInput),
      responses: { 200: json(organization, 'Updated'), 400: errors[400], 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const input = c.req.valid('json');
      const org = await run(c, async (tx) => {
        const orgId = await requireOrg(tx);
        await assertTimezone(tx, input.timezone);
        const fields = snake(input);
        if (Object.keys(fields).length) {
          const rows = await tx`update app.organizations set ${tx(fields)} where id = ${orgId} returning id`;
          if (!rows.length) throw new HttpError(403, 'forbidden', 'Only an org admin can update the organization');
        }
        return loadOrganization(tx);
      });
      return c.json(org!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/organization/settings',
      tags: ['Organization'],
      summary: 'Update scheduling rules (Org Admin)',
      security: secured,
      request: body(updateOrgSettingsInput),
      responses: { 200: json(organization, 'Updated'), 400: errors[400], 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const fields = snake(c.req.valid('json'));
      const org = await run(c, async (tx) => {
        const orgId = await requireOrg(tx);
        if (Object.keys(fields).length) {
          const rows = await tx`update app.org_settings set ${tx(fields)} where organization_id = ${orgId} returning organization_id`;
          if (!rows.length) throw new HttpError(403, 'forbidden', 'Only an org admin can change settings');
        }
        return loadOrganization(tx);
      });
      return c.json(org!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/organization/invite-code/rotate',
      tags: ['Organization'],
      summary: 'Generate a new invite code (Org Admin)',
      security: secured,
      responses: { 200: json(z.object({ inviteCode: z.string() }), 'New code'), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const [row] = await run(c, (tx) => tx`select app.rotate_invite_code() as code`);
      return c.json({ inviteCode: row!.code as string }, 200);
    },
  );

  // ----- members -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/members',
      tags: ['Members'],
      summary: 'People in my organization (email/phone hidden from employees)',
      security: secured,
      responses: { 200: json(z.array(profile.extend({ email: z.string().nullable() })), 'Members'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const me = c.get('user').sub;
      const { rows, manager } = await run(c, async (tx) => {
        const orgId = await requireOrg(tx);
        return {
          manager: await isManager(tx),
          rows: await tx`select * from app.profiles where organization_id = ${orgId} and deleted_at is null order by name`,
        };
      });
      // Employees don't see coworkers' contact details
      const hide = (p: ReturnType<typeof toProfile>) =>
        manager || p.id === me ? p : { ...p, email: null, phone: null };
      return c.json(rows.map((r) => hide(toProfile(r))), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/members/{id}',
      tags: ['Members'],
      summary: 'Change a member role/status (Org Admin) or position (Manager)',
      security: secured,
      request: { params: idParam, ...body(updateMemberInput) },
      responses: {
        200: json(profile, 'Updated'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const fields = snake(c.req.valid('json'));
      const row = await run(c, async (tx) => {
        const orgId = await requireOrg(tx);
        const [r] = await tx`
          update app.profiles set ${tx(fields)}
          where id = ${id} and organization_id = ${orgId} and deleted_at is null
          returning *`;
        if (!r) throw new HttpError(404, 'not_found', 'Member not found or not editable');
        return r;
      });
      return c.json(toProfile(row), 200);
    },
  );

  // ----- invitations -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/invitations',
      tags: ['Invitations'],
      summary: 'Open invitations (Manager)',
      security: secured,
      responses: { 200: json(z.array(invitation), 'Invitations'), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const rows = await run(c, async (tx) => {
        await requireOrg(tx);
        const [{ ok }] = (await tx`select app.is_manager() as ok`) as any;
        if (!ok) throw new HttpError(403, 'forbidden', 'Only managers can view invitations');
        return tx`
          select * from app.invitations
          where accepted_at is null and revoked_at is null and expires_at > now()
          order by created_at desc`;
      });
      return c.json(rows.map((r) => toInvitation(r)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/invitations',
      tags: ['Invitations'],
      summary: 'Invite someone by email (Manager: employees; Org Admin: any role)',
      security: secured,
      request: body(createInvitationInput),
      responses: {
        201: json(invitation.extend({ link: z.string() }), 'Created — share the link with the invitee'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        409: errors[409],
      },
    }),
    async (c) => {
      const { email, role, position } = c.req.valid('json');
      const [row] = await run(c, async (tx) => {
        await requireOrg(tx);
        return tx`select * from app.create_invitation(${email}, ${role}::app.user_role, ${position ?? null})`;
      });
      const inv = toInvitation(row!, true);
      const link = `${deps.appUrl ?? 'http://localhost:3000'}/invite/${inv.token}`;
      return c.json({ ...inv, link }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/invitations/{id}',
      tags: ['Invitations'],
      summary: 'Revoke an invitation (Manager)',
      security: secured,
      request: { params: idParam },
      responses: { 204: { description: 'Revoked' }, 401: errors[401], 403: errors[403], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await run(c, (tx) => tx`select app.revoke_invitation(${id})`);
      return c.body(null, 204);
    },
  );

  registerStructureRoutes(app, run);
  registerShiftRoutes(app, run);

  // ----- docs -----
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'ShiftHub API', version: '0.1.0', description: 'Workforce scheduling API for ShiftHub.' },
  });
  app.get('/docs', Scalar({ url: '/openapi.json', pageTitle: 'ShiftHub API' }));

  return app;
}

export type App = ReturnType<typeof createApp>;
