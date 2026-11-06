/** D5 routes: my notifications, read state, push tokens, audit log. */
import { createRoute, z } from '@hono/zod-openapi';
import { auditEntry, markReadInput, notificationList, pushTokenInput } from '@shifthub/shared';
import { body, errors, json, requireManager, requireOrg, secured, type Api, type Run } from '../http';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export function registerNotificationRoutes(app: Api, run: Run) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/notifications',
      tags: ['Notifications'],
      summary: 'My latest notifications and unread count',
      security: secured,
      request: { query: z.object({ unreadOnly: z.enum(['true', 'false']).optional() }) },
      responses: { 200: json(notificationList, 'Notifications'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const { unreadOnly } = c.req.valid('query');
      const result = await run(c, async (tx) => {
        await requireOrg(tx);
        const items = await tx`
          select id, type, title, body, data, read_at, created_at from app.notifications
          where user_id = app.current_user_id() ${unreadOnly === 'true' ? tx`and read_at is null` : tx``}
          order by created_at desc limit 50`;
        const [{ n }] = (await tx`select count(*)::int as n from app.notifications
                                  where user_id = app.current_user_id() and read_at is null`) as unknown as [{ n: number }];
        return {
          items: items.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            body: r.body,
            data: r.data,
            readAt: iso(r.read_at),
            createdAt: iso(r.created_at)!,
          })),
          unreadCount: n,
        };
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/notifications/read',
      tags: ['Notifications'],
      summary: 'Mark notifications read (all when ids is omitted)',
      security: secured,
      request: body(markReadInput),
      responses: { 200: json(z.object({ updated: z.number().int() }), 'Updated'), 400: errors[400], 401: errors[401] },
    }),
    async (c) => {
      const { ids } = c.req.valid('json');
      const [r] = await run(c, (tx) => tx`select app.mark_notifications_read(${ids ?? null}::uuid[]) as n`);
      return c.json({ updated: r!.n as number }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/push-tokens',
      tags: ['Notifications'],
      summary: 'Register this device for push notifications',
      security: secured,
      request: body(pushTokenInput),
      responses: { 204: { description: 'Registered' }, 400: errors[400], 401: errors[401] },
    }),
    async (c) => {
      const { token, platform } = c.req.valid('json');
      await run(c, async (tx) => {
        await requireOrg(tx);
        await tx`select app.register_push_token(${token}, ${platform})`;
      });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/push-tokens/unregister',
      tags: ['Notifications'],
      summary: 'Stop push notifications on this device (call on sign-out)',
      security: secured,
      request: body(pushTokenInput.pick({ token: true })),
      responses: { 204: { description: 'Removed' }, 400: errors[400], 401: errors[401] },
    }),
    async (c) => {
      const { token } = c.req.valid('json');
      await run(c, (tx) => tx`delete from app.push_tokens where token = ${token} and user_id = app.current_user_id()`);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/audit',
      tags: ['Audit'],
      summary: 'Recent changes in my organization (Manager)',
      security: secured,
      request: {
        query: z.object({
          entityType: z.string().max(40).optional(),
          entityId: z.guid().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: { 200: json(z.array(auditEntry), 'Entries'), 400: errors[400], 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const rows = await run(c, async (tx) => {
        await requireManager(tx);
        return tx`
          select a.*, p.name as user_name from app.audit_logs a
          left join app.profiles p on p.id = a.user_id
          where a.organization_id = app.current_org_id()
            ${q.entityType ? tx`and a.entity_type = ${q.entityType}` : tx``}
            ${q.entityId ? tx`and a.entity_id = ${q.entityId}` : tx``}
          order by a.id desc limit ${q.limit ?? 100}`;
      });
      return c.json(
        rows.map((r) => ({
          id: Number(r.id),
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          userId: r.user_id,
          userName: r.user_name,
          details: r.details,
          createdAt: iso(r.created_at)!,
        })),
        200,
      );
    },
  );
}
