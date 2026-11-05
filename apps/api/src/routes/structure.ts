/**
 * D2 routes: locations (sites → areas → assignments), shift templates,
 * member areas and availability.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  area,
  assignment,
  availabilitySlot,
  createAreaInput,
  createAssignmentInput,
  createShiftTemplateInput,
  createSiteInput,
  locations,
  setAvailabilityInput,
  setMemberAreasInput,
  shiftTemplate,
  site,
  updateAreaInput,
  updateAssignmentInput,
  updateShiftTemplateInput,
  updateSiteInput,
} from '@shifthub/shared';
import type { Tx } from '../db';
import { HttpError } from '../errors';
import {
  assertTimezone,
  body,
  errors,
  idParam,
  json,
  notFound,
  requireManager,
  requireOrg,
  secured,
  snake,
  type Api,
  type Run,
} from '../http';
import { toArea, toAssignment, toAvailability, toShiftTemplate, toSite } from '../mappers';

type Row = Record<string, any>;

type ResourceConfig = {
  path: string; // e.g. /v1/sites
  tag: string;
  label: string; // e.g. Site
  table: 'sites' | 'areas' | 'assignments' | 'shift_templates';
  entity: z.ZodType;
  createInput: z.ZodType;
  updateInput: z.ZodType;
  map: (r: Row) => unknown;
  /** Extra columns set on soft delete. */
  onDelete: Record<string, unknown>;
  validate?: (tx: Tx, input: Record<string, any>) => Promise<void>;
  beforeDelete?: (tx: Tx, id: string) => Promise<void>;
};

/** POST / PATCH / DELETE for a manager-owned, soft-deletable table. */
function registerResource(app: Api, run: Run, cfg: ResourceConfig) {
  const table = (tx: Tx) => tx(`app.${cfg.table}`);

  app.openapi(
    createRoute({
      method: 'post',
      path: cfg.path,
      tags: [cfg.tag],
      summary: `Create ${cfg.label.toLowerCase()} (Manager)`,
      security: secured,
      request: body(cfg.createInput),
      responses: { 201: json(cfg.entity, 'Created'), 400: errors[400], 401: errors[401], 403: errors[403], 409: errors[409] },
    }),
    (async (c: any) => {
      const input = c.req.valid('json');
      const row = await run(c, async (tx) => {
        await requireManager(tx);
        await cfg.validate?.(tx, input);
        const [r] = await tx`insert into ${table(tx)} ${tx(snake(input))} returning *`;
        return r!;
      });
      return c.json(cfg.map(row), 201);
    }) as any,
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: `${cfg.path}/{id}`,
      tags: [cfg.tag],
      summary: `Update ${cfg.label.toLowerCase()} (Manager)`,
      security: secured,
      request: { params: idParam, ...body(cfg.updateInput) },
      responses: {
        200: json(cfg.entity, 'Updated'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
        409: errors[409],
      },
    }),
    (async (c: any) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const row = await run(c, async (tx) => {
        await requireManager(tx);
        await cfg.validate?.(tx, input);
        const fields = snake(input);
        const [r] = Object.keys(fields).length
          ? await tx`update ${table(tx)} set ${tx(fields)} where id = ${id} and deleted_at is null returning *`
          : await tx`select * from ${table(tx)} where id = ${id} and deleted_at is null`;
        if (!r) throw notFound(cfg.label);
        return r;
      });
      return c.json(cfg.map(row), 200);
    }) as any,
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: `${cfg.path}/{id}`,
      tags: [cfg.tag],
      summary: `Delete ${cfg.label.toLowerCase()} (Manager, soft delete)`,
      security: secured,
      request: { params: idParam },
      responses: { 204: { description: 'Deleted' }, 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
    }),
    (async (c: any) => {
      const { id } = c.req.valid('param');
      await run(c, async (tx) => {
        await requireManager(tx);
        await cfg.beforeDelete?.(tx, id);
        const rows = await tx`
          update ${table(tx)} set ${tx({ deleted_at: new Date(), ...cfg.onDelete })}
          where id = ${id} and deleted_at is null returning id`;
        if (!rows.length) throw notFound(cfg.label);
      });
      return c.body(null, 204);
    }) as any,
  );
}

const conflict = (message: string) => new HttpError(409, 'conflict', message);

export function registerStructureRoutes(app: Api, run: Run) {
  // ----- locations tree -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/locations',
      tags: ['Locations'],
      summary: 'All sites with their areas and assignments',
      security: secured,
      responses: { 200: json(locations, 'Locations'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const tree = await run(c, async (tx) => {
        await requireOrg(tx);
        const [sites, areas, assignments] = await Promise.all([
          tx`select * from app.sites where deleted_at is null order by name`,
          tx`select * from app.areas where deleted_at is null order by name`,
          tx`select * from app.assignments where deleted_at is null order by display_order, name`,
        ]);
        return sites.map((s) => ({
          ...toSite(s),
          areas: areas
            .filter((a) => a.site_id === s.id)
            .map((a) => ({
              ...toArea(a),
              assignments: assignments.filter((x) => x.area_id === a.id).map(toAssignment),
            })),
        }));
      });
      return c.json(tree, 200);
    },
  );

  registerResource(app, run, {
    path: '/v1/sites',
    tag: 'Locations',
    label: 'Site',
    table: 'sites',
    entity: site,
    createInput: createSiteInput,
    updateInput: updateSiteInput,
    map: toSite,
    onDelete: { status: 'inactive' },
    validate: (tx, input) => assertTimezone(tx, input.timezone),
    beforeDelete: async (tx, id) => {
      const [r] = await tx`select count(*)::int as n from app.areas where site_id = ${id} and deleted_at is null`;
      if (r!.n > 0) throw conflict('Delete or move this site’s areas first');
    },
  });

  registerResource(app, run, {
    path: '/v1/areas',
    tag: 'Locations',
    label: 'Area',
    table: 'areas',
    entity: area,
    createInput: createAreaInput,
    updateInput: updateAreaInput,
    map: toArea,
    onDelete: { status: 'inactive' },
    validate: async (tx, input) => {
      if (!input.siteId) return;
      const [r] = await tx`select 1 from app.sites where id = ${input.siteId} and deleted_at is null`;
      if (!r) throw notFound('Site');
    },
    beforeDelete: async (tx, id) => {
      const [r] = await tx`select count(*)::int as n from app.assignments where area_id = ${id} and deleted_at is null`;
      if (r!.n > 0) throw conflict('Delete this area’s assignments first');
    },
  });

  registerResource(app, run, {
    path: '/v1/assignments',
    tag: 'Locations',
    label: 'Assignment',
    table: 'assignments',
    entity: assignment,
    createInput: createAssignmentInput,
    updateInput: updateAssignmentInput,
    map: toAssignment,
    onDelete: { status: 'inactive' },
    validate: async (tx, input) => {
      if (!input.areaId) return;
      const [r] = await tx`select 1 from app.areas where id = ${input.areaId} and deleted_at is null`;
      if (!r) throw notFound('Area');
    },
  });

  // ----- shift templates -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/shift-templates',
      tags: ['Shift templates'],
      security: secured,
      responses: { 200: json(z.array(shiftTemplate), 'Templates'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const rows = await run(c, async (tx) => {
        await requireOrg(tx);
        return tx`select * from app.shift_templates where deleted_at is null order by start_time, name`;
      });
      return c.json(rows.map(toShiftTemplate), 200);
    },
  );

  registerResource(app, run, {
    path: '/v1/shift-templates',
    tag: 'Shift templates',
    label: 'Shift template',
    table: 'shift_templates',
    entity: shiftTemplate,
    createInput: createShiftTemplateInput,
    updateInput: updateShiftTemplateInput,
    map: toShiftTemplate,
    onDelete: { active: false },
  });

  // ----- member areas -----
  const memberAreas = z.object({ areaIds: z.array(z.guid()) });

  async function assertMember(tx: Tx, id: string) {
    const [r] = await tx`select 1 from app.profiles where id = ${id} and organization_id = app.current_org_id() and deleted_at is null`;
    if (!r) throw notFound('Member');
  }
  const areaIdsOf = async (tx: Tx, id: string) =>
    (await tx`select area_id from app.employee_areas where employee_id = ${id} order by area_id`).map(
      (r) => r.area_id as string,
    );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/members/{id}/areas',
      tags: ['Members'],
      summary: 'Areas a member is allowed to work',
      security: secured,
      request: { params: idParam },
      responses: { 200: json(memberAreas, 'Area ids'), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const areaIds = await run(c, async (tx) => {
        await requireOrg(tx);
        await assertMember(tx, id);
        return areaIdsOf(tx, id);
      });
      return c.json({ areaIds }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/members/{id}/areas',
      tags: ['Members'],
      summary: 'Replace the areas a member is allowed to work (Manager)',
      security: secured,
      request: { params: idParam, ...body(setMemberAreasInput) },
      responses: {
        200: json(memberAreas, 'Area ids'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const wanted = [...new Set(c.req.valid('json').areaIds)];
      const areaIds = await run(c, async (tx) => {
        await requireManager(tx);
        await assertMember(tx, id);
        await tx`delete from app.employee_areas where employee_id = ${id} and not (area_id = any(${wanted}::uuid[]))`;
        if (wanted.length) {
          await tx`
            insert into app.employee_areas (employee_id, area_id)
            select ${id}, unnest(${wanted}::uuid[])
            on conflict (employee_id, area_id) do nothing`;
        }
        return areaIdsOf(tx, id);
      });
      return c.json({ areaIds }, 200);
    },
  );

  // ----- availability -----
  const availabilityList = z.object({ slots: z.array(availabilitySlot) });
  const loadAvailability = (tx: Tx, employeeId: string) =>
    tx`select * from app.availability where employee_id = ${employeeId} order by weekday, start_time`;

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me/availability',
      tags: ['Me'],
      summary: 'My weekly unavailable times',
      security: secured,
      responses: { 200: json(availabilityList, 'Slots'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const me = c.get('user').sub;
      const rows = await run(c, async (tx) => {
        await requireOrg(tx);
        return loadAvailability(tx, me);
      });
      return c.json({ slots: rows.map(toAvailability) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/me/availability',
      tags: ['Me'],
      summary: 'Replace my weekly unavailable times',
      security: secured,
      request: body(setAvailabilityInput),
      responses: { 200: json(availabilityList, 'Slots'), 400: errors[400], 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const me = c.get('user').sub;
      const { slots } = c.req.valid('json');
      const rows = await run(c, async (tx) => {
        await requireOrg(tx);
        await tx`delete from app.availability where employee_id = ${me}`;
        if (slots.length) {
          await tx`insert into app.availability ${tx(
            slots.map((s) => ({ weekday: s.weekday, start_time: s.startTime, end_time: s.endTime, note: s.note ?? null })),
          )}`;
        }
        return loadAvailability(tx, me);
      });
      return c.json({ slots: rows.map(toAvailability) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/members/{id}/availability',
      tags: ['Members'],
      summary: 'A member’s weekly unavailable times (Manager)',
      security: secured,
      request: { params: idParam },
      responses: { 200: json(availabilityList, 'Slots'), 401: errors[401], 403: errors[403], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const rows = await run(c, async (tx) => {
        await requireManager(tx);
        await assertMember(tx, id);
        return loadAvailability(tx, id);
      });
      return c.json({ slots: rows.map(toAvailability) }, 200);
    },
  );
}
